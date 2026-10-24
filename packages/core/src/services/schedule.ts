import {
  type AppointmentStatus,
  appointments,
  contacts,
  conversations,
  type Database,
  dealEvents,
  deals,
  pipelineStages,
  scheduleSettings,
  users,
  type WeekHours,
} from "@crm/db";
import { and, asc, desc, eq, gte, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { normalizePhoneInput, phoneVariants } from "../whatsapp/evolution.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";
import { conversationLink, notifyUser } from "./rotation.js";

type ActorU = Actor & { userId: string };
const OFFSET = "-03:00"; // horário de Brasília (sem horário de verão)
const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export const DEFAULT_HOURS: WeekHours = {
  "0": null,
  "1": ["08:00", "18:00"],
  "2": ["08:00", "18:00"],
  "3": ["08:00", "18:00"],
  "4": ["08:00", "18:00"],
  "5": ["08:00", "18:00"],
  "6": ["08:00", "12:00"],
};

export async function getScheduleSettings(db: Database, organizationId: string) {
  const s = await db.query.scheduleSettings.findFirst({
    where: eq(scheduleSettings.organizationId, organizationId),
  });
  return (
    s ?? {
      organizationId,
      aiCanBook: false,
      durationMinutes: 30,
      perSlot: 1,
      hours: DEFAULT_HOURS,
      updatedAt: new Date(),
    }
  );
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (use 08:00).");
export const scheduleInput = z.object({
  aiCanBook: z.boolean(),
  durationMinutes: z.coerce.number().int().min(10).max(240),
  perSlot: z.coerce.number().int().min(1).max(50),
  hours: z.record(z.string().regex(/^[0-6]$/), z.tuple([hhmm, hhmm]).nullable()),
});

export async function saveScheduleSettings(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof scheduleInput>,
) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores configuram a agenda.");
  const input = scheduleInput.parse(raw);
  for (const [d, v] of Object.entries(input.hours))
    if (v && v[0] >= v[1])
      throw new AppError("validation", `Em ${DAY_NAMES[Number(d)]}, o fim precisa ser depois do início.`);
  const values = { ...input, updatedAt: new Date() };
  await db
    .insert(scheduleSettings)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: scheduleSettings.organizationId, set: values });
}

/** "2026-10-25" + "10:00" -> Date (Brasília). */
export function brDateTime(date: string, time: string) {
  const d = new Date(`${date}T${time}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Partes de uma data no horário de Brasília. */
export function brParts(d: Date) {
  const x = new Date(d.getTime() - 3 * 3600_000);
  const date = x.toISOString().slice(0, 10);
  const time = x.toISOString().slice(11, 16);
  return { date, time, weekday: x.getUTCDay() };
}

export function formatBr(d: Date) {
  const p = brParts(d);
  const [y, m, day] = p.date.split("-");
  return `${DAY_NAMES[p.weekday]}, ${day}/${m}/${y} às ${p.time}`;
}

function toMinutes(t: string) {
  const [h = "0", m = "0"] = t.split(":");
  return Number(h) * 60 + Number(m);
}

async function countOverlapping(db: Database, organizationId: string, start: Date, end: Date) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.organizationId, organizationId),
        eq(appointments.status, "scheduled"),
        lt(appointments.startsAt, end),
        sql`${appointments.endsAt} > ${start.toISOString()}::timestamptz`,
      ),
    );
  return Number(r?.n ?? 0);
}

/** Horários livres de um dia (respeita expediente, duração, capacidade e o que já passou). */
export async function freeSlots(db: Database, organizationId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const s = await getScheduleSettings(db, organizationId);
  const base = brDateTime(date, "12:00");
  if (!base) return [];
  const range = s.hours[String(brParts(base).weekday)];
  if (!range) return [];
  const out: string[] = [];
  for (let m = toMinutes(range[0]); m + s.durationMinutes <= toMinutes(range[1]); m += s.durationMinutes) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const start = brDateTime(date, t);
    if (!start || start.getTime() < Date.now() + 30 * 60_000) continue;
    const end = new Date(start.getTime() + s.durationMinutes * 60_000);
    if ((await countOverlapping(db, organizationId, start, end)) < s.perSlot) out.push(t);
  }
  return out;
}

/** Confere se a data/hora cabe no expediente e na capacidade. Devolve erro em texto (para a IA) ou null. */
export async function checkSlot(db: Database, organizationId: string, start: Date) {
  const s = await getScheduleSettings(db, organizationId);
  const p = brParts(start);
  const range = s.hours[String(p.weekday)];
  if (start.getTime() < Date.now() + 30 * 60_000) return "Esse horário já passou ou está em cima da hora.";
  if (!range) return `Não atendemos ${DAY_NAMES[p.weekday]}.`;
  const m = toMinutes(p.time);
  if (m < toMinutes(range[0]) || m + s.durationMinutes > toMinutes(range[1]))
    return `Em ${DAY_NAMES[p.weekday]} atendemos das ${range[0]} às ${range[1]}.`;
  const end = new Date(start.getTime() + s.durationMinutes * 60_000);
  if ((await countOverlapping(db, organizationId, start, end)) >= s.perSlot)
    return "Esse horário já está lotado.";
  return null;
}

export const appointmentInput = z.object({
  contactId: z.string().uuid().optional(),
  phone: z.string().optional(),
  contactName: z.string().trim().max(80).optional(),
  title: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Escolha o horário."),
  durationMinutes: z.coerce.number().int().min(10).max(480).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
});

async function contactForPhone(db: Database, organizationId: string, rawPhone: string, name: string | null) {
  const phone = normalizePhoneInput(rawPhone);
  if (!phone) throw new AppError("validation", "Telefone inválido.");
  const [found] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(eq(contacts.organizationId, organizationId), sql`${contacts.phone} in ${phoneVariants(phone)}`),
    )
    .limit(1);
  if (found) return found.id;
  const [c] = await db
    .insert(contacts)
    .values({ organizationId, waJid: `${phone}@s.whatsapp.net`, phone, name, waVerified: false })
    .returning({ id: contacts.id });
  if (!c) throw new Error("Falha ao criar contato");
  return c.id;
}

async function openDealOf(db: Database, contactId: string) {
  const [d] = await db
    .select({
      id: deals.id,
      pipelineId: deals.pipelineId,
      stageId: deals.stageId,
      assignedUserId: deals.assignedUserId,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(eq(deals.contactId, contactId), sql`${pipelineStages.kind} not in ('won','lost')`))
    .orderBy(desc(deals.updatedAt))
    .limit(1);
  return d ?? null;
}

/** Ao marcar, a negociação aberta vai para a etapa de agendamento do funil (se existir). */
async function moveDealToScheduled(
  db: Database,
  organizationId: string,
  dealId: string,
  actorId: string | null,
  via: string,
) {
  const d = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
  if (!d) return;
  const target = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.pipelineId, d.pipelineId), eq(pipelineStages.kind, "scheduled")),
    orderBy: asc(pipelineStages.position),
  });
  if (!target || target.id === d.stageId) return;
  const from = await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, d.stageId) });
  await db
    .update(deals)
    .set({ stageId: target.id, stageChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(deals.id, d.id));
  await db.insert(dealEvents).values({
    organizationId,
    dealId: d.id,
    actorId,
    type: "stage",
    data: { from: from?.name ?? null, to: target.name, kind: target.kind, via },
  });
}

export async function createAppointment(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof appointmentInput>,
) {
  const input = appointmentInput.parse(raw);
  const contactId =
    input.contactId ??
    (await contactForPhone(db, organizationId, input.phone ?? "", input.contactName ?? null));
  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)),
  });
  if (!contact) throw new AppError("validation", "Contato não encontrado.");
  const s = await getScheduleSettings(db, organizationId);
  const start = brDateTime(input.date, input.time);
  if (!start) throw new AppError("validation", "Data ou hora inválida.");
  const end = new Date(start.getTime() + (input.durationMinutes ?? s.durationMinutes) * 60_000);
  const deal = await openDealOf(db, contactId);
  const assigned = can(actor, "deals.reassign")
    ? (input.assignedUserId ?? deal?.assignedUserId ?? actor.userId)
    : actor.userId;
  const [a] = await db
    .insert(appointments)
    .values({
      organizationId,
      contactId,
      dealId: deal?.id ?? null,
      assignedUserId: actor.isMaster && !input.assignedUserId ? (deal?.assignedUserId ?? null) : assigned,
      title: input.title || `Visita: ${contact.name ?? contact.pushName ?? contact.phone ?? "cliente"}`,
      startsAt: start,
      endsAt: end,
      notes: input.notes?.trim() || null,
      createdByUserId: actor.userId,
    })
    .returning({ id: appointments.id });
  if (!a) throw new Error("Falha ao criar agendamento");
  if (deal) await moveDealToScheduled(db, organizationId, deal.id, actor.userId, "agenda");
  await notifyOrg(db, { o: organizationId, t: "conversation" });
  return a.id;
}

/** Marcação feita pelo agente de IA. Devolve texto para a IA. */
export async function bookByAi(
  db: Database,
  organizationId: string,
  conversationId: string,
  when: string,
  note: string,
) {
  const s = await getScheduleSettings(db, organizationId);
  if (!s.aiCanBook)
    return { ok: false as const, text: "A agenda não está liberada para marcação automática." };
  const m = when.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  const start = m ? brDateTime(m[1] ?? "", m[2] ?? "") : null;
  if (!start) return { ok: false as const, text: "Data inválida. Use o formato AAAA-MM-DD HH:MM." };
  const problem = await checkSlot(db, organizationId, start);
  if (problem) {
    const free = await freeSlots(db, organizationId, brParts(start).date);
    return {
      ok: false as const,
      text: `${problem}${free.length ? ` Horários livres nesse dia: ${free.slice(0, 8).join(", ")}.` : ""}`,
    };
  }
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conv) return { ok: false as const, text: "Conversa não encontrada." };
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
  const deal = await openDealOf(db, conv.contactId);
  const assigned = conv.assignedUserId ?? deal?.assignedUserId ?? null;
  const [a] = await db
    .insert(appointments)
    .values({
      organizationId,
      contactId: conv.contactId,
      dealId: deal?.id ?? null,
      connectionId: conv.connectionId,
      assignedUserId: assigned,
      title: `Visita: ${contact?.name ?? contact?.pushName ?? contact?.phone ?? "cliente"}`,
      startsAt: start,
      endsAt: new Date(start.getTime() + s.durationMinutes * 60_000),
      notes: note.trim().slice(0, 2000) || null,
      createdByAi: true,
    })
    .returning({ id: appointments.id });
  if (deal) {
    await moveDealToScheduled(db, organizationId, deal.id, null, "IA");
    await db.insert(dealEvents).values({
      organizationId,
      dealId: deal.id,
      type: "note",
      data: { text: `IA marcou visita para ${formatBr(start)}${note ? `: ${note}` : ""}` },
    });
  }
  if (assigned) {
    const link = conversationLink(conv.id);
    await notifyUser(
      db,
      organizationId,
      conv.connectionId,
      assigned,
      `📅 VISITA MARCADA PELA IA\nCliente: ${contact?.name ?? contact?.pushName ?? contact?.phone ?? ""}\nQuando: ${formatBr(start)}${note ? `\nObs.: ${note}` : ""}${link ? `\nAbrir conversa: ${link}` : ""}`,
    );
  }
  await notifyOrg(db, { o: organizationId, t: "conversation", c: conv.id });
  return { ok: true as const, id: a?.id, text: `Visita marcada para ${formatBr(start)}.` };
}

export async function listAppointments(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { from: Date; to: Date; mine?: boolean; status?: AppointmentStatus | "all" },
) {
  const conds: (SQL | undefined)[] = [
    eq(appointments.organizationId, organizationId),
    gte(appointments.startsAt, opts.from),
    lt(appointments.startsAt, opts.to),
  ];
  if (!can(actor, "deals.view_all"))
    conds.push(or(eq(appointments.assignedUserId, actor.userId), isNull(appointments.assignedUserId)));
  if (opts.mine) conds.push(eq(appointments.assignedUserId, actor.userId));
  if (opts.status && opts.status !== "all") conds.push(eq(appointments.status, opts.status));
  else conds.push(ne(appointments.status, "canceled"));
  return db
    .select({
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      notes: appointments.notes,
      createdByAi: appointments.createdByAi,
      dealId: appointments.dealId,
      contactId: contacts.id,
      contactName: sql<string | null>`coalesce(${contacts.name}, ${contacts.pushName})`,
      contactPhone: contacts.phone,
      assignedUserId: appointments.assignedUserId,
      assignedUserName: users.name,
      conversationId: sql<
        string | null
      >`(select c.id from ${conversations} c where c.contact_id = ${contacts.id} order by c.last_message_at desc nulls last limit 1)`,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(users, eq(users.id, appointments.assignedUserId))
    .where(and(...conds))
    .orderBy(asc(appointments.startsAt));
}

export async function setAppointmentStatus(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  status: AppointmentStatus,
) {
  const a = await db.query.appointments.findFirst({
    where: and(eq(appointments.id, id), eq(appointments.organizationId, organizationId)),
  });
  if (!a) throw new AppError("not_found", "Agendamento não encontrado.");
  if (!can(actor, "deals.view_all") && a.assignedUserId && a.assignedUserId !== actor.userId)
    throw new AppError("forbidden", "Esse agendamento é de outra pessoa.");
  await db.update(appointments).set({ status, updatedAt: new Date() }).where(eq(appointments.id, id));
  if (a.dealId) {
    const label = {
      scheduled: "reaberta",
      attended: "compareceu",
      no_show: "não compareceu",
      canceled: "cancelada",
    }[status];
    await db.insert(dealEvents).values({
      organizationId,
      dealId: a.dealId,
      actorId: actor.userId,
      type: "note",
      data: { text: `Visita de ${formatBr(a.startsAt)}: ${label}` },
    });
  }
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}
