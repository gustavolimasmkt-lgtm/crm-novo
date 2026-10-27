import {
  auditLog,
  contacts,
  type Database,
  dealEvents,
  dealSources,
  deals,
  dealTags,
  type LeadSummary,
  memberships,
  pipelineStages,
  pipelines,
  type StageKind,
  tags,
  users,
  whatsappConnections,
} from "@crm/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { parseCsv } from "../csv.js";
import { parseBrDate, parseMoneyToCents } from "../money.js";
import { slugify } from "../text.js";
import { normalizePhoneInput, phoneVariants } from "../whatsapp/evolution.js";
import type { AdReferral } from "../whatsapp/parse.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };
type ColKey = keyof typeof COLS;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

const uuidRe = /^[0-9a-f-]{36}$/i;
const CLOSED_KINDS: StageKind[] = ["won", "lost"];

export const DEFAULT_STAGES: { name: string; kind: StageKind; color: string }[] = [
  { name: "Novo lead", kind: "open", color: "#0071e3" },
  { name: "Em atendimento", kind: "open", color: "#5856d6" },
  { name: "Qualificado", kind: "open", color: "#af52de" },
  { name: "Visita agendada", kind: "scheduled", color: "#ff9500" },
  { name: "Proposta", kind: "open", color: "#30b0c7" },
  { name: "Ganho", kind: "won", color: "#34c759" },
  { name: "Perdido", kind: "lost", color: "#8e8e93" },
];

export const DEFAULT_SOURCES = [
  ["Meta Ads", "meta_ads"],
  ["Google Ads", "google_ads"],
  ["Instagram orgânico", "instagram_organico"],
  ["Facebook orgânico", "facebook_organico"],
  ["WhatsApp direto", "whatsapp_direto"],
  ["Site", "site"],
  ["Indicação", "indicacao"],
  ["Marketplace", "marketplace"],
  ["Loja física", "loja_fisica"],
  ["Outros", "outros"],
] as const;

function requireSettings(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores configuram o CRM.");
}

function visibility(actor: ActorU): SQL | undefined {
  if (can(actor, "deals.view_all")) return undefined;
  return or(eq(deals.assignedUserId, actor.userId), isNull(deals.assignedUserId));
}

/** Cria funil padrão e fontes na primeira vez que a empresa usa o CRM. */
export async function ensureCrmDefaults(db: Db, organizationId: string) {
  const existing = await db.query.pipelines.findFirst({
    where: eq(pipelines.organizationId, organizationId),
  });
  if (!existing) await createPipelineWithStages(db, organizationId, "Funil de Vendas", true, DEFAULT_STAGES);
  await db
    .insert(dealSources)
    .values(DEFAULT_SOURCES.map(([name, key]) => ({ organizationId, name, key })))
    .onConflictDoNothing();
}

async function createPipelineWithStages(
  db: Db,
  organizationId: string,
  name: string,
  isDefault: boolean,
  stages: { name: string; kind: StageKind; color: string }[],
) {
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(pipelines)
    .where(eq(pipelines.organizationId, organizationId));
  const [p] = await db
    .insert(pipelines)
    .values({ organizationId, name, isDefault, position: Number(n) })
    .returning();
  if (!p) throw new Error("Falha ao criar funil");
  if (stages.length)
    await db.insert(pipelineStages).values(
      stages.map((s, i) => ({
        organizationId,
        pipelineId: p.id,
        name: s.name,
        kind: s.kind,
        color: s.color,
        position: i,
      })),
    );
  return p;
}

export async function listPipelines(db: Database, organizationId: string) {
  await ensureCrmDefaults(db, organizationId);
  const ps = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.organizationId, organizationId))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.position), asc(pipelines.createdAt));
  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.organizationId, organizationId))
    .orderBy(asc(pipelineStages.position));
  return ps.map((p) => ({ ...p, stages: stages.filter((s) => s.pipelineId === p.id) }));
}

export async function listSources(db: Database, organizationId: string) {
  return db
    .select()
    .from(dealSources)
    .where(eq(dealSources.organizationId, organizationId))
    .orderBy(asc(dealSources.name));
}

export async function listTags(db: Database, organizationId: string) {
  return db.select().from(tags).where(eq(tags.organizationId, organizationId)).orderBy(asc(tags.name));
}

async function nextNumber(tx: Db, organizationId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deals:${organizationId}`}))`);
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`coalesce(max(${deals.number}), 0)::int` })
    .from(deals)
    .where(eq(deals.organizationId, organizationId));
  return Number(n) + 1;
}

async function event(
  db: Db,
  organizationId: string,
  dealId: string,
  actorId: string | null,
  type: string,
  data?: unknown,
) {
  await db.insert(dealEvents).values({ organizationId, dealId, actorId, type, data: data ?? null });
}

async function stageInOrg(db: Db, organizationId: string, stageId: string) {
  if (!uuidRe.test(stageId)) throw new AppError("validation", "Etapa inválida.");
  const s = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, stageId), eq(pipelineStages.organizationId, organizationId)),
  });
  if (!s) throw new AppError("validation", "Etapa inválida.");
  return s;
}

async function firstStage(db: Db, organizationId: string, pipelineId?: string) {
  await ensureCrmDefaults(db, organizationId);
  const p = pipelineId
    ? await db.query.pipelines.findFirst({
        where: and(eq(pipelines.id, pipelineId), eq(pipelines.organizationId, organizationId)),
      })
    : ((await db.query.pipelines.findFirst({
        where: and(eq(pipelines.organizationId, organizationId), eq(pipelines.isDefault, true)),
      })) ?? (await db.query.pipelines.findFirst({ where: eq(pipelines.organizationId, organizationId) })));
  if (!p) throw new AppError("validation", "Funil não encontrado.");
  const s = await db.query.pipelineStages.findFirst({
    where: eq(pipelineStages.pipelineId, p.id),
    orderBy: asc(pipelineStages.position),
  });
  if (!s) throw new AppError("validation", "Esse funil não tem etapas.");
  return s;
}

async function validUser(db: Db, organizationId: string, userId: string | null | undefined) {
  if (!userId) return null;
  if (!uuidRe.test(userId)) throw new AppError("validation", "Responsável inválido.");
  const m = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.organizationId, organizationId),
      eq(memberships.userId, userId),
      eq(memberships.active, true),
    ),
  });
  if (!m) throw new AppError("validation", "Essa pessoa não faz parte da equipe.");
  return userId;
}

export const dealInput = z.object({
  contactId: z.string().uuid().optional(),
  phone: z.string().optional(),
  contactName: z.string().trim().max(80).optional(),
  title: z.string().trim().max(120).optional(),
  valueCents: z.number().int().min(0).max(1e13).default(0),
  stageId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  connectionId: z.string().uuid().nullable().optional(),
  description: z.string().max(4000).optional(),
});

export async function createDeal(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof dealInput>,
): Promise<string> {
  const input = dealInput.parse(raw);
  const id = await db.transaction(async (tx) => {
    let contactId = input.contactId;
    if (contactId) {
      const c = await tx.query.contacts.findFirst({
        where: and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)),
      });
      if (!c) throw new AppError("validation", "Contato não encontrado.");
    } else {
      const phone = normalizePhoneInput(input.phone ?? "");
      if (!phone) throw new AppError("validation", "Escolha um contato ou digite o telefone com DDD.");
      contactId = await upsertContactByPhone(tx, organizationId, phone, input.contactName ?? null, null);
    }
    const contact = await tx.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
    const stage = input.stageId
      ? await stageInOrg(tx, organizationId, input.stageId)
      : await firstStage(tx, organizationId);
    // Vendedor/atendente que cria fica como responsável.
    const assigned =
      input.assignedUserId !== undefined
        ? can(actor, "deals.reassign") || input.assignedUserId === actor.userId
          ? await validUser(tx, organizationId, input.assignedUserId)
          : actor.userId
        : actor.isMaster
          ? null
          : actor.userId;
    const number = await nextNumber(tx, organizationId);
    const [d] = await tx
      .insert(deals)
      .values({
        organizationId,
        number,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        contactId,
        title: input.title || contact?.name || contact?.pushName || contact?.phone || "Negociação",
        valueCents: can(actor, "deals.view_values") ? input.valueCents : 0,
        assignedUserId: assigned,
        sourceId: input.sourceId ?? null,
        connectionId: input.connectionId ?? null,
        description: input.description || null,
        closedAt: CLOSED_KINDS.includes(stage.kind) ? new Date() : null,
      })
      .returning({ id: deals.id });
    if (!d) throw new Error("Falha ao criar negociação");
    await event(tx, organizationId, d.id, actor.userId, "created", { stage: stage.name });
    return d.id;
  });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
  return id;
}

async function upsertContactByPhone(
  db: Db,
  organizationId: string,
  phone: string,
  name: string | null,
  email: string | null,
) {
  const [found] = await db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.phone, phoneVariants(phone))))
    .limit(1);
  if (found) {
    if ((!found.name && name) || (!found.email && email))
      await db
        .update(contacts)
        .set({ ...(!found.name && name ? { name } : {}), ...(!found.email && email ? { email } : {}) })
        .where(eq(contacts.id, found.id));
    return found.id;
  }
  const [c] = await db
    .insert(contacts)
    .values({ organizationId, waJid: `${phone}@s.whatsapp.net`, phone, name, email, waVerified: false })
    .onConflictDoUpdate({ target: [contacts.organizationId, contacts.waJid], set: { updatedAt: new Date() } })
    .returning({ id: contacts.id });
  if (!c) throw new Error("Falha ao gravar contato");
  return c.id;
}

/**
 * Lead automático: quem escreve pela primeira vez (sem negociação aberta) entra no funil padrão.
 * Chamado ao receber mensagem.
 */
export async function autoCreateDeal(
  db: Database,
  organizationId: string,
  contactId: string,
  connectionId: string,
  ad: AdReferral | null = null,
) {
  const adFields = ad
    ? { adId: ad.id, adTitle: ad.title, adUrl: ad.url, adApp: ad.app, ctwaClid: ad.ctwaClid }
    : {};
  const open = await db
    .select({ id: deals.id })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(eq(deals.contactId, contactId), notInArray(pipelineStages.kind, CLOSED_KINDS)))
    .limit(1);
  if (open.length) {
    // Cliente já em negociação clicou num anúncio: guarda o anúncio se ainda não tinha.
    if (ad)
      await db
        .update(deals)
        .set(adFields)
        .where(and(eq(deals.id, open[0]?.id ?? ""), isNull(deals.adId), isNull(deals.ctwaClid)));
    return null;
  }
  const any = await db.query.deals.findFirst({ where: eq(deals.contactId, contactId) });
  if (any) return null; // já negociou antes (ganho/perdido): não cria sozinho
  return db.transaction(async (tx) => {
    const stage = await firstStage(tx, organizationId);
    const contact = await tx.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
    const src = await tx.query.dealSources.findFirst({
      where: and(
        eq(dealSources.organizationId, organizationId),
        eq(dealSources.key, ad ? "meta_ads" : "whatsapp_direto"),
      ),
    });
    const number = await nextNumber(tx, organizationId);
    const [d] = await tx
      .insert(deals)
      .values({
        organizationId,
        number,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        contactId,
        title: contact?.name || contact?.pushName || contact?.phone || "Novo lead",
        sourceId: src?.id ?? null,
        connectionId,
        ...adFields,
      })
      .returning({ id: deals.id });
    if (d)
      await event(tx, organizationId, d.id, null, "created", {
        stage: stage.name,
        auto: true,
        ...(ad ? { ad: ad.title ?? ad.id ?? "anúncio" } : {}),
      });
    return d?.id ?? null;
  });
}

/** Quando a conversa ganha responsável, a negociação aberta sem responsável acompanha. */
export async function syncDealAssignee(
  db: Database,
  organizationId: string,
  contactId: string,
  userId: string | null,
) {
  if (!userId) return;
  const rows = await db
    .update(deals)
    .set({ assignedUserId: userId, updatedAt: new Date() })
    .where(
      and(
        eq(deals.organizationId, organizationId),
        eq(deals.contactId, contactId),
        isNull(deals.assignedUserId),
      ),
    )
    .returning({ id: deals.id });
  for (const r of rows) await event(db, organizationId, r.id, null, "assigned", { userId, via: "conversa" });
}

export type BoardDeal = {
  id: string;
  number: number;
  title: string;
  valueCents: number | null;
  stageId: string;
  contactId: string;
  contactPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  updatedAt: Date;
  createdAt: Date;
  tagIds: string[];
};

export async function getBoard(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { pipelineId?: string; q?: string; assignedUserId?: string; tagId?: string } = {},
) {
  const all = await listPipelines(db, organizationId);
  const pipeline = all.find((p) => p.id === opts.pipelineId) ?? all.find((p) => p.isDefault) ?? all[0];
  if (!pipeline) throw new AppError("not_found", "Nenhum funil.");
  const conds: (SQL | undefined)[] = [eq(deals.pipelineId, pipeline.id), visibility(actor)];
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(deals.title, `%${q}%`),
        ilike(contacts.name, `%${q}%`),
        digits.length >= 3 ? ilike(contacts.phone, `%${digits}%`) : undefined,
        /^\d+$/.test(q) ? eq(deals.number, Number(q)) : undefined,
      ),
    );
  }
  if (opts.assignedUserId === "none") conds.push(isNull(deals.assignedUserId));
  else if (opts.assignedUserId && uuidRe.test(opts.assignedUserId))
    conds.push(eq(deals.assignedUserId, opts.assignedUserId));
  if (opts.tagId && uuidRe.test(opts.tagId))
    conds.push(
      sql`exists (select 1 from ${dealTags} dt where dt.deal_id = ${deals.id} and dt.tag_id = ${opts.tagId})`,
    );
  const rows = await db
    .select({
      id: deals.id,
      number: deals.number,
      title: deals.title,
      valueCents: deals.valueCents,
      stageId: deals.stageId,
      contactId: deals.contactId,
      contactPhone: contacts.phone,
      assignedUserId: deals.assignedUserId,
      assignedUserName: users.name,
      updatedAt: deals.updatedAt,
      createdAt: deals.createdAt,
      tagIds: sql<
        string[]
      >`coalesce((select array_agg(dt.tag_id) from ${dealTags} dt where dt.deal_id = ${deals.id}), '{}')`,
    })
    .from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(users, eq(users.id, deals.assignedUserId))
    .where(and(...conds))
    .orderBy(desc(deals.stageChangedAt))
    .limit(2000);
  const showValues = can(actor, "deals.view_values");
  const items: BoardDeal[] = rows.map((r) => ({
    ...r,
    valueCents: showValues ? Number(r.valueCents) : null,
  }));
  return {
    pipelines: all.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })),
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: pipeline.stages.map((s) => {
      const ds = items.filter((d) => d.stageId === s.id);
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        kind: s.kind,
        count: ds.length,
        totalCents: showValues ? ds.reduce((a, d) => a + (d.valueCents ?? 0), 0) : null,
        deals: ds,
      };
    }),
    showValues,
  };
}

async function loadDeal(db: Db, actor: ActorU, organizationId: string, id: string) {
  if (!uuidRe.test(id)) throw new AppError("not_found", "Negociação não encontrada.");
  const [d] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.organizationId, organizationId), visibility(actor)))
    .limit(1);
  if (!d) throw new AppError("not_found", "Negociação não encontrada.");
  return d;
}

export async function getDeal(db: Database, actor: ActorU, organizationId: string, id: string) {
  const d = await loadDeal(db, actor, organizationId, id);
  const [contact, stage, tagRows, evs, conv] = await Promise.all([
    db.query.contacts.findFirst({ where: eq(contacts.id, d.contactId) }),
    db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, d.stageId) }),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(dealTags)
      .innerJoin(tags, eq(tags.id, dealTags.tagId))
      .where(eq(dealTags.dealId, d.id)),
    db
      .select({
        id: dealEvents.id,
        type: dealEvents.type,
        data: dealEvents.data,
        createdAt: dealEvents.createdAt,
        actorName: users.name,
      })
      .from(dealEvents)
      .leftJoin(users, eq(users.id, dealEvents.actorId))
      .where(eq(dealEvents.dealId, d.id))
      .orderBy(desc(dealEvents.createdAt))
      .limit(100),
    db.execute<{ id: string; ai_summary: LeadSummary | null; ai_summary_at: string | null }>(
      sql`select c.id, c.ai_summary, c.ai_summary_at from conversations c where c.contact_id = ${d.contactId} order by (c.connection_id = ${d.connectionId}) desc nulls last, c.last_message_at desc nulls last limit 1`,
    ),
  ]);
  const showValues = can(actor, "deals.view_values");
  return {
    ...d,
    valueCents: showValues ? Number(d.valueCents) : null,
    setupCents: showValues ? d.setupCents : null,
    monthlyCents: showValues ? d.monthlyCents : null,
    contact: contact
      ? { id: contact.id, name: contact.name ?? contact.pushName, phone: contact.phone, email: contact.email }
      : null,
    stage,
    tags: tagRows,
    events: evs,
    conversationId: conv[0]?.id ?? null,
    aiSummary: conv[0]?.ai_summary ?? null,
    aiSummaryAt: conv[0]?.ai_summary_at ?? null,
  };
}

export const dealPatchInput = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(120).optional(),
  valueCents: z.number().int().min(0).max(1e13).optional(),
  sourceId: z.string().uuid().nullable().optional(),
  connectionId: z.string().uuid().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
});

export async function updateDeal(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  raw: z.input<typeof dealPatchInput>,
) {
  const p = dealPatchInput.parse(raw);
  const d = await loadDeal(db, actor, organizationId, id);
  if (p.valueCents !== undefined && !can(actor, "deals.view_values"))
    throw new AppError("forbidden", "Você não pode alterar valores.");
  if (p.sourceId) {
    const s = await db.query.dealSources.findFirst({
      where: and(eq(dealSources.id, p.sourceId), eq(dealSources.organizationId, organizationId)),
    });
    if (!s) throw new AppError("validation", "Fonte inválida.");
  }
  if (p.connectionId) {
    const c = await db.query.whatsappConnections.findFirst({
      where: and(
        eq(whatsappConnections.id, p.connectionId),
        eq(whatsappConnections.organizationId, organizationId),
      ),
    });
    if (!c) throw new AppError("validation", "Conexão inválida.");
  }
  await db
    .update(deals)
    .set({
      ...p,
      description: p.description === undefined ? undefined : p.description || null,
      updatedAt: new Date(),
    })
    .where(eq(deals.id, d.id));
  if (p.valueCents !== undefined && p.valueCents !== Number(d.valueCents))
    await event(db, organizationId, d.id, actor.userId, "value", {
      from: Number(d.valueCents),
      to: p.valueCents,
    });
  if (p.title && p.title !== d.title)
    await event(db, organizationId, d.id, actor.userId, "title", { to: p.title });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

export async function moveDeal(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  stageId: string,
) {
  const d = await loadDeal(db, actor, organizationId, id);
  const to = await stageInOrg(db, organizationId, stageId);
  if (to.id === d.stageId) return;
  const from = await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, d.stageId) });
  await db
    .update(deals)
    .set({
      stageId: to.id,
      pipelineId: to.pipelineId,
      stageChangedAt: new Date(),
      closedAt: CLOSED_KINDS.includes(to.kind) ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(deals.id, d.id));
  await event(db, organizationId, d.id, actor.userId, "stage", {
    from: from?.name ?? null,
    to: to.name,
    toId: to.id,
    kind: to.kind,
  });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

export async function assignDeal(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  userId: string | null,
) {
  const d = await loadDeal(db, actor, organizationId, id);
  if (!can(actor, "deals.reassign")) {
    if (userId !== actor.userId)
      throw new AppError("forbidden", "Você só pode assumir negociações para você.");
    if (d.assignedUserId && d.assignedUserId !== actor.userId)
      throw new AppError("forbidden", "Essa negociação já tem responsável.");
  }
  const uid = await validUser(db, organizationId, userId);
  await db.update(deals).set({ assignedUserId: uid, updatedAt: new Date() }).where(eq(deals.id, d.id));
  const name = uid ? (await db.query.users.findFirst({ where: eq(users.id, uid) }))?.name : null;
  await event(db, organizationId, d.id, actor.userId, "assigned", { userId: uid, name });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

export async function addDealNote(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  text: string,
) {
  const d = await loadDeal(db, actor, organizationId, id);
  const t = text.trim();
  if (!t) throw new AppError("validation", "Escreva a anotação.");
  await event(db, organizationId, d.id, actor.userId, "note", { text: t.slice(0, 4000) });
  await db.update(deals).set({ updatedAt: new Date() }).where(eq(deals.id, d.id));
}

/** Aplica etiquetas pelo nome (cria as que não existem). */
export async function setDealTags(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  names: string[],
) {
  const d = await loadDeal(db, actor, organizationId, id);
  const clean = [...new Set(names.map((n) => n.trim().slice(0, 40)).filter(Boolean))];
  const ids = await tagIdsByName(db, organizationId, clean, can(actor, "settings.manage"));
  const before = await db.select({ id: dealTags.tagId }).from(dealTags).where(eq(dealTags.dealId, d.id));
  const added = ids.filter((t) => !before.some((b) => b.id === t));
  await db.delete(dealTags).where(eq(dealTags.dealId, d.id));
  if (ids.length)
    await db
      .insert(dealTags)
      .values(ids.map((tagId) => ({ dealId: d.id, tagId })))
      .onConflictDoNothing();
  await event(db, organizationId, d.id, actor.userId, "tags", { tags: clean, added });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

async function tagIdsByName(db: Db, organizationId: string, names: string[], create: boolean) {
  const out: string[] = [];
  for (const name of names) {
    let t = await db.query.tags.findFirst({
      where: and(eq(tags.organizationId, organizationId), sql`lower(${tags.name}) = lower(${name})`),
    });
    if (!t && create) [t] = await db.insert(tags).values({ organizationId, name }).returning();
    if (t) out.push(t.id);
  }
  return out;
}

export async function deleteDeal(db: Database, actor: ActorU, organizationId: string, id: string) {
  if (!can(actor, "deals.delete"))
    throw new AppError("forbidden", "Só administradores e gestores excluem negociações.");
  const d = await loadDeal(db, actor, organizationId, id);
  await db.delete(deals).where(eq(deals.id, d.id));
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "deal.deleted",
    entity: "deal",
    entityId: d.id,
    data: { number: d.number, title: d.title },
  });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

/** Negociação aberta mais recente do contato (para mostrar na conversa). */
export async function getOpenDealForContact(
  db: Database,
  actor: ActorU,
  organizationId: string,
  contactId: string,
) {
  const [r] = await db
    .select({
      id: deals.id,
      number: deals.number,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      pipelineName: pipelines.name,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .where(and(eq(deals.organizationId, organizationId), eq(deals.contactId, contactId), visibility(actor)))
    .orderBy(sql`(${pipelineStages.kind} in ('won','lost')) asc`, desc(deals.updatedAt))
    .limit(1);
  return r ?? null;
}

// ---------- Configuração: funis, etapas, etiquetas, fontes ----------

export async function createPipeline(db: Database, actor: ActorU, organizationId: string, name: string) {
  requireSettings(actor);
  const n = name.trim().slice(0, 60);
  if (!n) throw new AppError("validation", "Dê um nome ao funil.");
  await ensureCrmDefaults(db, organizationId);
  const p = await createPipelineWithStages(db, organizationId, n, false, DEFAULT_STAGES);
  return p.id;
}

export async function updatePipeline(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  patch: { name?: string; isDefault?: boolean },
) {
  requireSettings(actor);
  const p = await db.query.pipelines.findFirst({
    where: and(eq(pipelines.id, id), eq(pipelines.organizationId, organizationId)),
  });
  if (!p) throw new AppError("not_found", "Funil não encontrado.");
  if (patch.isDefault)
    await db.update(pipelines).set({ isDefault: false }).where(eq(pipelines.organizationId, organizationId));
  await db
    .update(pipelines)
    .set({
      ...(patch.name?.trim() ? { name: patch.name.trim().slice(0, 60) } : {}),
      ...(patch.isDefault ? { isDefault: true } : {}),
    })
    .where(eq(pipelines.id, id));
}

export async function deletePipeline(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireSettings(actor);
  const p = await db.query.pipelines.findFirst({
    where: and(eq(pipelines.id, id), eq(pipelines.organizationId, organizationId)),
  });
  if (!p) throw new AppError("not_found", "Funil não encontrado.");
  if (p.isDefault)
    throw new AppError("validation", "Esse é o funil padrão. Marque outro como padrão antes de excluir.");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(deals).where(eq(deals.pipelineId, id));
  if (Number(n) > 0)
    throw new AppError("validation", `Esse funil tem ${n} negociações. Mova-as antes de excluir.`);
  await db.delete(pipelines).where(eq(pipelines.id, id));
}

export const stageInput = z.object({
  name: z.string().trim().min(1, "Dê um nome à etapa.").max(60),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Cor inválida.")
    .default("#8e8e93"),
  kind: z.enum(["open", "scheduled", "won", "lost"]).default("open"),
});

export async function addStage(
  db: Database,
  actor: ActorU,
  organizationId: string,
  pipelineId: string,
  raw: z.input<typeof stageInput>,
) {
  requireSettings(actor);
  const input = stageInput.parse(raw);
  const p = await db.query.pipelines.findFirst({
    where: and(eq(pipelines.id, pipelineId), eq(pipelines.organizationId, organizationId)),
  });
  if (!p) throw new AppError("not_found", "Funil não encontrado.");
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`coalesce(max(${pipelineStages.position}), -1)::int` })
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId));
  const [s] = await db
    .insert(pipelineStages)
    .values({ organizationId, pipelineId, ...input, position: Number(n) + 1 })
    .returning({ id: pipelineStages.id });
  return s?.id;
}

export async function updateStage(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  raw: z.input<typeof stageInput>,
) {
  requireSettings(actor);
  const input = stageInput.parse(raw);
  await stageInOrg(db, organizationId, id);
  await db.update(pipelineStages).set(input).where(eq(pipelineStages.id, id));
}

export async function moveStage(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  dir: "up" | "down",
) {
  requireSettings(actor);
  const s = await stageInOrg(db, organizationId, id);
  const list = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, s.pipelineId))
    .orderBy(asc(pipelineStages.position));
  const i = list.findIndex((x) => x.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  const order = [...list];
  const [moved] = order.splice(i, 1);
  if (moved) order.splice(j, 0, moved);
  for (const [pos, st] of order.entries())
    await db.update(pipelineStages).set({ position: pos }).where(eq(pipelineStages.id, st.id));
}

export async function deleteStage(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireSettings(actor);
  const s = await stageInOrg(db, organizationId, id);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(deals).where(eq(deals.stageId, id));
  if (Number(n) > 0)
    throw new AppError("validation", `Essa etapa tem ${n} negociações. Mova-as antes de excluir.`);
  const [{ left } = { left: 0 }] = await db
    .select({ left: count() })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, s.pipelineId), ne(pipelineStages.id, id)));
  if (Number(left) === 0) throw new AppError("validation", "O funil precisa de pelo menos uma etapa.");
  await db.delete(pipelineStages).where(eq(pipelineStages.id, id));
}

export async function saveTag(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: { id?: string; name: string; color?: string },
) {
  requireSettings(actor);
  const name = raw.name.trim().slice(0, 40);
  if (!name) throw new AppError("validation", "Dê um nome à etiqueta.");
  const color = /^#[0-9a-f]{6}$/i.test(raw.color ?? "") ? (raw.color as string) : "#0071e3";
  try {
    if (raw.id) {
      await db
        .update(tags)
        .set({ name, color })
        .where(and(eq(tags.id, raw.id), eq(tags.organizationId, organizationId)));
    } else await db.insert(tags).values({ organizationId, name, color });
  } catch {
    throw new AppError("conflict", "Já existe uma etiqueta com esse nome.");
  }
}

export async function deleteTag(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireSettings(actor);
  await db.delete(tags).where(and(eq(tags.id, id), eq(tags.organizationId, organizationId)));
}

export async function saveSource(db: Database, actor: ActorU, organizationId: string, name: string) {
  requireSettings(actor);
  const n = name.trim().slice(0, 60);
  if (!n) throw new AppError("validation", "Dê um nome à fonte.");
  const key = slugify(n).replace(/-/g, "_") || "fonte";
  await db.insert(dealSources).values({ organizationId, name: n, key }).onConflictDoNothing();
}

export async function deleteSource(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireSettings(actor);
  await db
    .delete(dealSources)
    .where(and(eq(dealSources.id, id), eq(dealSources.organizationId, organizationId)));
}

// ---------- Importação de negociações ----------

function norm(h: string) {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9:]+/g, "_")
    .replace(/^_|_$/g, "");
}

const COLS = {
  originId: ["id"],
  title: ["titulo", "titulo_negociacao"],
  value: ["valor"],
  pipeline: ["funil"],
  stage: ["etapa", "estagio"],
  source: ["fonte"],
  owner: ["responsavel", "id_usuario"],
  tags: ["etiquetas"],
  contactName: ["contato", "nome"],
  phone: ["telefone"],
  email: ["e_mail", "email"],
  createdAt: ["criado_em", "data_criacao", "data_de_criacao"],
  kind: ["tipo"],
  landline: ["fixo"],
  description: ["descricao"],
  valueType: ["tipo_valor"],
  setup: ["valor_implantacao"],
  monthly: ["valor_mensalidade"],
} satisfies Record<string, string[]>;
const IGNORED = new Set([
  "atualizado_em",
  "departamento",
  "id_departamento",
  "anuncio",
  "score",
  "produtos",
  "id_whatsapp",
]);

export type DealImportResult = {
  total: number;
  created: number;
  skipped: number;
  contactsOnly: number;
  invalid: { line: number; reason: string }[];
  createdStages: string[];
  unknownOwners: string[];
};

/**
 * Importa negociações do export do sistema antigo ou do modelo (tipo criar_negociacao).
 * Cria funis, etapas, fontes e etiquetas que faltarem. Reimportar o export não duplica (usa o ID de origem).
 */
export async function importDealsCsv(
  db: Database,
  actor: ActorU,
  organizationId: string,
  csv: string,
): Promise<DealImportResult> {
  requireSettings(actor);
  await ensureCrmDefaults(db, organizationId);
  const rows = parseCsv(csv);
  const rawHeader = rows.shift() ?? [];
  const header = rawHeader.map(norm);
  const col = (k: ColKey) => header.findIndex((h) => (COLS[k] as readonly string[]).includes(h));
  const c = Object.fromEntries((Object.keys(COLS) as ColKey[]).map((k) => [k, col(k)])) as Record<
    ColKey,
    number
  >;
  if (c.phone < 0) throw new AppError("validation", "Não achei a coluna de telefone.");
  if (rows.length > 20_000) throw new AppError("validation", "Máximo de 20.000 linhas por vez.");
  const known = new Set(Object.values(c).filter((i) => i >= 0));
  const extraCols = rawHeader
    .map((h, i) => ({ h: h.replace(/^﻿/, "").trim(), i }))
    .filter(({ h, i }) => !known.has(i) && h && !IGNORED.has(norm(h)) && !norm(h).startsWith("campo:"));
  const customCols = rawHeader
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h }) => norm(h).startsWith("campo:"))
    .map(({ h, i }) => ({ h: h.replace(/^campo:/i, "").trim(), i }));

  const team = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId));
  const findOwner = (v: string) => {
    const s = v.trim().toLowerCase();
    if (!s) return null;
    return (
      team.find((u) => u.id === v.trim() || u.email.toLowerCase() === s || u.name.trim().toLowerCase() === s)
        ?.id ?? undefined
    );
  };

  const result: DealImportResult = {
    total: rows.length,
    created: 0,
    skipped: 0,
    contactsOnly: 0,
    invalid: [],
    createdStages: [],
    unknownOwners: [],
  };
  const get = (r: string[], k: keyof typeof COLS) => (c[k] >= 0 ? (r[c[k]] ?? "").trim() : "");

  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    try {
      const rawPhone = get(r, "phone");
      const digits = rawPhone.replace(/\D/g, "");
      const phone =
        digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
          ? digits
          : normalizePhoneInput(rawPhone, { landline: /^(s|sim|x|1)$/i.test(get(r, "landline")) });
      if (!phone) {
        result.invalid.push({ line, reason: rawPhone ? `Telefone inválido: ${rawPhone}` : "Sem telefone" });
        continue;
      }
      let name = get(r, "contactName");
      if (name.replace(/\D/g, "") === digits && digits) name = "";
      const emailRaw = get(r, "email").toLowerCase();
      const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw : null;
      const contactId = await upsertContactByPhone(db, organizationId, phone, name || null, email);

      const kind = get(r, "kind");
      if (kind && !/negocia/i.test(kind)) {
        result.contactsOnly++;
        continue;
      }
      const originId = c.originId >= 0 ? get(r, "originId") : "";
      if (originId) {
        const dup = await db
          .select({ id: deals.id })
          .from(deals)
          .where(
            and(eq(deals.organizationId, organizationId), sql`${deals.extra}->>'ID de origem' = ${originId}`),
          )
          .limit(1);
        if (dup.length) {
          result.skipped++;
          continue;
        }
      }

      await db.transaction(async (tx) => {
        // Funil e etapa pelo nome (cria se faltar); vazio = funil padrão, primeira etapa.
        const pName = get(r, "pipeline");
        const sName = get(r, "stage");
        let stage = await firstStage(tx, organizationId);
        if (pName || sName) {
          let pipe = pName
            ? await tx.query.pipelines.findFirst({
                where: and(
                  eq(pipelines.organizationId, organizationId),
                  sql`lower(${pipelines.name}) = lower(${pName})`,
                ),
              })
            : await tx.query.pipelines.findFirst({ where: eq(pipelines.id, stage.pipelineId) });
          if (!pipe && pName) {
            pipe = await createPipelineWithStages(tx, organizationId, pName, false, []);
            result.createdStages.push(`Funil ${pName}`);
          }
          if (pipe && sName) {
            let st = await tx.query.pipelineStages.findFirst({
              where: and(
                eq(pipelineStages.pipelineId, pipe.id),
                sql`lower(${pipelineStages.name}) = lower(${sName})`,
              ),
            });
            if (!st) {
              const kindGuess: StageKind = /ganh|vend/i.test(sName)
                ? "won"
                : /perd/i.test(sName)
                  ? "lost"
                  : /agend|visita|reuni/i.test(sName)
                    ? "scheduled"
                    : "open";
              const [{ n } = { n: 0 }] = await tx
                .select({ n: sql<number>`coalesce(max(${pipelineStages.position}), -1)::int` })
                .from(pipelineStages)
                .where(eq(pipelineStages.pipelineId, pipe.id));
              [st] = await tx
                .insert(pipelineStages)
                .values({
                  organizationId,
                  pipelineId: pipe.id,
                  name: sName,
                  kind: kindGuess,
                  position: Number(n) + 1,
                })
                .returning();
              result.createdStages.push(`${pipe.name} → ${sName}`);
            }
            if (st) stage = st;
          } else if (pipe) stage = await firstStage(tx, organizationId, pipe.id);
        }

        const srcName = get(r, "source");
        let sourceId: string | null = null;
        if (srcName) {
          const key = slugify(srcName).replace(/-/g, "_") || "fonte";
          const found = await tx.query.dealSources.findFirst({
            where: and(
              eq(dealSources.organizationId, organizationId),
              or(eq(dealSources.key, key), sql`lower(${dealSources.name}) = lower(${srcName})`),
            ),
          });
          sourceId =
            found?.id ??
            (
              await tx
                .insert(dealSources)
                .values({ organizationId, name: srcName, key })
                .returning({ id: dealSources.id })
            )[0]?.id ??
            null;
        }
        const ownerRaw = get(r, "owner");
        const owner = ownerRaw ? findOwner(ownerRaw) : null;
        if (ownerRaw && owner === undefined && !result.unknownOwners.includes(ownerRaw))
          result.unknownOwners.push(ownerRaw);

        const recurring = /recorr/i.test(get(r, "valueType"));
        const setup = parseMoneyToCents(get(r, "setup"));
        const monthly = parseMoneyToCents(get(r, "monthly"));
        const valueCents = recurring ? setup + monthly * 12 : parseMoneyToCents(get(r, "value"));
        const created = parseBrDate(get(r, "createdAt")) ?? new Date();
        const extra: Record<string, string> = {};
        if (originId) extra["ID de origem"] = originId;
        for (const { h, i: ci } of [...extraCols, ...customCols]) {
          const v = (r[ci] ?? "").trim();
          if (v) extra[h] = v.slice(0, 1000);
        }
        const number = await nextNumber(tx, organizationId);
        const [d] = await tx
          .insert(deals)
          .values({
            organizationId,
            number,
            pipelineId: stage.pipelineId,
            stageId: stage.id,
            contactId,
            title: get(r, "title") || name || phone,
            valueType: recurring ? "recurring" : "single",
            valueCents,
            setupCents: recurring ? setup : null,
            monthlyCents: recurring ? monthly : null,
            sourceId,
            assignedUserId: owner ?? null,
            description: get(r, "description") || null,
            extra: Object.keys(extra).length ? extra : null,
            createdAt: created,
            stageChangedAt: created,
            updatedAt: created,
            closedAt: CLOSED_KINDS.includes(stage.kind) ? created : null,
          })
          .returning({ id: deals.id });
        if (!d) throw new Error("falha ao gravar");
        const tagNames = get(r, "tags")
          .split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean);
        const tIds = await tagIdsByName(tx, organizationId, tagNames, true);
        if (tIds.length)
          await tx
            .insert(dealTags)
            .values(tIds.map((tagId) => ({ dealId: d.id, tagId })))
            .onConflictDoNothing();
        await event(tx, organizationId, d.id, actor.userId, "imported", { stage: stage.name });
      });
      result.created++;
    } catch (e) {
      result.invalid.push({ line, reason: e instanceof AppError ? e.message : "Erro ao gravar a linha" });
    }
  }
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "deal.imported",
    data: { total: result.total, created: result.created, skipped: result.skipped },
  });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
  return result;
}
