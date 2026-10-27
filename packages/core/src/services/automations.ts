import {
  appointments,
  contacts,
  conversations,
  type Database,
  type FollowupStep,
  followupSettings,
  messages,
  organizations,
  whatsappConnections,
} from "@crm/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AiClient, ChatMessage } from "../ai/anthropic.js";
import { type Actor, can } from "../auth/permissions.js";
import type { EvolutionApi } from "../whatsapp/evolution.js";
import { buildSystemPrompt, getAgent, getAiUsage, recordUsage, toChatTurns } from "./agent.js";
import { sendAiMessage } from "./conversations.js";
import { AppError } from "./errors.js";
import { upsertContactAndConversation } from "./messages.js";
import { notifyUser } from "./rotation.js";
import { brParts, DEFAULT_REMINDER, formatBr } from "./schedule.js";

type ActorU = Actor & { userId: string };
const HOUR = 3600_000;
const NO_SEND = "NAO_ENVIAR";

export const DEFAULT_FOLLOWUP_STEPS: FollowupStep[] = [
  { hours: 24, text: null },
  { hours: 72, text: null },
];

// ---------------------------------------------------------------- follow-up

export async function getFollowupSettings(db: Database, organizationId: string) {
  return (
    (await db.query.followupSettings.findFirst({
      where: eq(followupSettings.organizationId, organizationId),
    })) ?? {
      organizationId,
      enabled: false,
      steps: DEFAULT_FOLLOWUP_STEPS,
      windowStart: "08:00",
      windowEnd: "20:00",
      sundays: false,
      gapMinSeconds: 30,
      gapMaxSeconds: 90,
      dailyLimit: 120,
      updatedAt: new Date(),
    }
  );
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (use 08:00).");
export const followupInput = z.object({
  enabled: z.boolean(),
  steps: z
    .array(
      z.object({
        hours: z.coerce
          .number()
          .int()
          .min(1, "Follow-up: mínimo 1 hora.")
          .max(720, "Follow-up: máximo 720 horas (30 dias)."),
        text: z.string().max(1000).nullable().default(null),
      }),
    )
    .max(5, "No máximo 5 follow-ups."),
  windowStart: hhmm,
  windowEnd: hhmm,
  sundays: z.boolean().default(false),
  gapMinSeconds: z.coerce.number().int().min(10, "Intervalo mínimo: 10 segundos.").max(3600).default(30),
  gapMaxSeconds: z.coerce.number().int().min(10).max(3600).default(90),
  dailyLimit: z.coerce
    .number()
    .int()
    .min(1, "Limite por dia: pelo menos 1.")
    .max(1000, "Limite por dia: no máximo 1000.")
    .default(120),
});

export async function saveFollowupSettings(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof followupInput>,
) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores configuram o follow-up.");
  const input = followupInput.parse(raw);
  if (input.enabled && !input.steps.length)
    throw new AppError("validation", "Adicione pelo menos um follow-up.");
  if (input.gapMinSeconds > input.gapMaxSeconds)
    throw new AppError("validation", "O intervalo máximo precisa ser maior ou igual ao mínimo.");
  if (input.windowStart >= input.windowEnd)
    throw new AppError("validation", "O fim do horário de envio precisa ser depois do início.");
  const values = {
    ...input,
    steps: input.steps.map((s) => ({ hours: s.hours, text: s.text?.trim() || null })),
    updatedAt: new Date(),
  };
  await db
    .insert(followupSettings)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: followupSettings.organizationId, set: values });
}

/** Está dentro da janela de envio (horário de Brasília)? */
export function inWindow(s: { windowStart: string; windowEnd: string; sundays: boolean }, now = new Date()) {
  const p = brParts(now);
  if (p.weekday === 0 && !s.sundays) return false;
  return p.time >= s.windowStart && p.time < s.windowEnd;
}

function firstName(c: { name: string | null; pushName: string | null } | undefined) {
  const n = (c?.name || c?.pushName || "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,}$/u.test(n) ? n : "";
}

function fill(template: string, vars: Record<string, string>) {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/ +([!,.?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Anti-bloqueio: reserva a vez de um envio automático no número (intervalo aleatório entre envios
 * e limite por dia). Devolve false se ainda não é a vez ou se o limite do dia acabou.
 */
export async function reserveAutomatedSend(
  db: Database,
  connectionId: string,
  p: { gapMinSeconds: number; gapMaxSeconds: number; dailyLimit: number },
) {
  const gap = p.gapMinSeconds + Math.random() * Math.max(0, p.gapMaxSeconds - p.gapMinSeconds);
  const dayStart = new Date(`${brParts(new Date()).date}T00:00:00-03:00`);
  const rows = await db.execute(sql`
    update whatsapp_connections set next_automated_at = now() + make_interval(secs => ${gap})
    where id = ${connectionId}::uuid
      and (next_automated_at is null or next_automated_at <= now())
      and (select count(*) from messages m where m.connection_id = ${connectionId}::uuid
           and m.automation is not null and m.automation <> 'flow_manual'
           and m.sent_at >= ${dayStart.toISOString()}::timestamptz) < ${p.dailyLimit}
    returning id
  `);
  return rows.length > 0;
}

export type AutomationDeps = { evo: EvolutionApi; ai: AiClient };

/** A IA escreve a retomada. Devolve null se ela achar que não faz sentido mandar. */
async function writeFollowup(
  db: Database,
  ai: AiClient,
  organizationId: string,
  conversationId: string,
  hoursSilent: number,
) {
  const agent = await getAgent(db, organizationId);
  if (!agent) return null;
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conv) return null;
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
  const rows = await db
    .select({
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      mediaName: messages.mediaName,
      transcript: messages.transcript,
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.internal, false)))
    .orderBy(desc(messages.createdAt))
    .limit(agent.historyMessages);
  const turns: ChatMessage[] = toChatTurns(rows.reverse());
  if (!turns.length) return null;
  const note = `[Aviso do sistema, não é o cliente: o cliente não responde há ${hoursSilent} horas. Escreva UMA mensagem curta e natural para retomar a conversa a partir do último assunto, sem repetir a mensagem anterior e sem pressionar. Não invente ofertas nem condições. Se a conversa já terminou (o cliente se despediu, disse que não tem interesse ou já comprou), responda apenas ${NO_SEND}.]`;
  const last = turns.at(-1);
  if (last?.role === "user") last.content = `${String(last.content)}\n${note}`;
  else turns.push({ role: "user", content: note });
  const r = await ai.chat({
    model: agent.model,
    system: buildSystemPrompt({
      instructions: agent.instructions,
      orgName: org?.name ?? "a empresa",
      contactName: contact?.name ?? contact?.pushName ?? null,
    }),
    messages: turns,
    maxTokens: 300,
  });
  await recordUsage(db, organizationId, conversationId, "followup", agent.model, r);
  const text = r.text.trim();
  if (!text || text.includes(NO_SEND)) return null;
  return text.slice(0, 1500);
}

/**
 * Retoma clientes que pararam de responder à IA. Só age em conversas em que a última mensagem
 * foi da IA (nunca atravessa vendedor), sem visita marcada e sem negociação encerrada.
 */
export async function processFollowups(db: Database, deps: AutomationDeps, limit = 10) {
  const due = await db.execute<{
    id: string;
    organization_id: string;
    connection_id: string;
    followup_count: number;
    last_message_at: string;
    hours: number;
    text: string | null;
    window_start: string;
    window_end: string;
    sundays: boolean;
    gap_min_seconds: number;
    gap_max_seconds: number;
    daily_limit: number;
  }>(sql`
    select c.id, c.organization_id, c.connection_id, c.followup_count, c.last_message_at,
           (fs.steps -> c.followup_count ->> 'hours')::int as hours,
           fs.steps -> c.followup_count ->> 'text' as text,
           fs.window_start, fs.window_end, fs.sundays, fs.gap_min_seconds, fs.gap_max_seconds, fs.daily_limit
    from conversations c
    join followup_settings fs on fs.organization_id = c.organization_id and fs.enabled
    join ai_agents a on a.organization_id = c.organization_id and a.active
    where c.status = 'open'
      and not c.ai_paused
      and c.last_message_from_me
      and (a.connection_id is null or a.connection_id = c.connection_id)
      and c.followup_count < jsonb_array_length(fs.steps)
      and c.last_message_at < now() - make_interval(hours => (fs.steps -> c.followup_count ->> 'hours')::int)
      and (select m.sent_by_ai from messages m where m.conversation_id = c.id and not m.internal
           order by m.created_at desc limit 1)
      and exists (select 1 from messages m where m.conversation_id = c.id and m.direction = 'in')
      and not exists (select 1 from ai_jobs j where j.conversation_id = c.id)
      and not exists (select 1 from appointments ap where ap.contact_id = c.contact_id
                      and ap.status = 'scheduled' and ap.starts_at > now())
      and not exists (
        select 1 from deals d join pipeline_stages s on s.id = d.stage_id
        where d.contact_id = c.contact_id and s.kind in ('won', 'lost')
          and not exists (select 1 from deals d2 join pipeline_stages s2 on s2.id = d2.stage_id
                          where d2.contact_id = c.contact_id and s2.kind not in ('won', 'lost')))
    order by c.last_message_at
    limit ${limit}
  `);
  const out: { conversationId: string; result: string }[] = [];
  for (const row of due) {
    if (!inWindow({ windowStart: row.window_start, windowEnd: row.window_end, sundays: row.sundays }))
      continue;
    const pace = {
      gapMinSeconds: row.gap_min_seconds,
      gapMaxSeconds: row.gap_max_seconds,
      dailyLimit: row.daily_limit,
    };
    if (!(await reserveAutomatedSend(db, row.connection_id, pace))) continue;
    // Reserva: só um processo envia este passo.
    const claimed = await db
      .update(conversations)
      .set({ followupCount: row.followup_count + 1 })
      .where(and(eq(conversations.id, row.id), eq(conversations.followupCount, row.followup_count)))
      .returning({ contactId: conversations.contactId });
    if (!claimed.length) continue;
    try {
      const usage = await getAiUsage(db, row.organization_id);
      let text: string | null = null;
      if (row.text?.trim()) {
        const contact = await db.query.contacts.findFirst({
          where: eq(contacts.id, claimed[0]?.contactId ?? ""),
        });
        text = fill(row.text, { nome: firstName(contact) });
      } else if (!usage.exhausted) {
        const silent = Math.round((Date.now() - new Date(row.last_message_at).getTime()) / HOUR);
        text = await writeFollowup(db, deps.ai, row.organization_id, row.id, silent);
      }
      if (!text) {
        out.push({ conversationId: row.id, result: usage.exhausted ? "sem-creditos" : "nao-enviado" });
        continue;
      }
      await sendAiMessage(db, deps.evo, row.organization_id, row.id, text, {
        automation: "followup",
        typing: true,
      });
      out.push({ conversationId: row.id, result: `enviado-${row.followup_count + 1}` });
    } catch (e) {
      console.error(`[follow-up] conversa ${row.id}:`, (e as Error)?.message ?? e);
      out.push({ conversationId: row.id, result: "erro" });
    }
  }
  return out;
}

// ---------------------------------------------------------------- lembretes de visita

function whenText(start: Date, now = new Date()) {
  const s = brParts(start);
  const n = brParts(now);
  const tomorrow = brParts(new Date(now.getTime() + 24 * HOUR)).date;
  if (s.date === n.date) return `hoje às ${s.time}`;
  if (s.date === tomorrow) return `amanhã às ${s.time}`;
  return formatBr(start).replace(/\/\d{4} /, " ");
}

/** Lembra o cliente da visita (ex.: 24 h e 2 h antes) e avisa o responsável no último lembrete. */
export async function processReminders(db: Database, evo: EvolutionApi, limit = 20) {
  const rows = await db.execute<{
    id: string;
    organization_id: string;
    contact_id: string;
    connection_id: string | null;
    assigned_user_id: string | null;
    starts_at: string;
    created_at: string;
    reminders_sent: number[];
    remind_hours: number[];
    remind_template: string | null;
  }>(sql`
    select ap.id, ap.organization_id, ap.contact_id, ap.connection_id, ap.assigned_user_id,
           ap.starts_at, ap.created_at, ap.reminders_sent, ss.remind_hours, ss.remind_template
    from appointments ap
    join schedule_settings ss on ss.organization_id = ap.organization_id and ss.remind_enabled
    where ap.status = 'scheduled'
      and ap.starts_at > now()
      and ap.starts_at < now() + interval '73 hours'
    order by ap.starts_at
    limit ${limit}
  `);
  const out: { appointmentId: string; result: string }[] = [];
  const now = Date.now();
  for (const a of rows) {
    const start = new Date(a.starts_at);
    const created = new Date(a.created_at).getTime();
    const sent = a.reminders_sent ?? [];
    const due = (a.remind_hours ?? []).filter((h) => !sent.includes(h) && now >= start.getTime() - h * HOUR);
    if (!due.length) continue;
    // Se vários venceram juntos (servidor parado), manda só o mais próximo da visita.
    const h = Math.min(...due);
    // Marcada depois do ponto do lembrete (ex.: marcou 3 h antes): o de 24 h não faz sentido.
    const skip = created > start.getTime() - h * HOUR;
    const next = [...sent, ...due];
    // Anti-bloqueio (lembrete pulado não precisa esperar a vez).
    let connId: string | null = null;
    if (!skip) {
      const pace = await getFollowupSettings(db, a.organization_id);
      connId = await preferredConnection(db, a.organization_id, a.contact_id, a.connection_id);
      if (!connId || !(await reserveAutomatedSend(db, connId, pace))) continue;
    }
    const claimed = await db
      .update(appointments)
      .set({ remindersSent: next })
      .where(
        and(eq(appointments.id, a.id), sql`${appointments.remindersSent} = ${JSON.stringify(sent)}::jsonb`),
      )
      .returning({ id: appointments.id });
    if (!claimed.length) continue;
    if (skip) {
      out.push({ appointmentId: a.id, result: "pulado" });
      continue;
    }
    try {
      const org = await db.query.organizations.findFirst({ where: eq(organizations.id, a.organization_id) });
      const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, a.contact_id) });
      if (!contact) throw new Error("contato não encontrado");
      const convId = await conversationFor(db, a.organization_id, contact, connId);
      const text = fill(a.remind_template || DEFAULT_REMINDER, {
        nome: firstName(contact),
        quando: whenText(start),
        empresa: org?.name ?? "",
      });
      await sendAiMessage(db, evo, a.organization_id, convId, text, { automation: "reminder", typing: true });
      if (a.assigned_user_id && h === Math.min(...(a.remind_hours ?? [h])))
        await notifyUser(
          db,
          a.organization_id,
          a.connection_id,
          a.assigned_user_id,
          `📅 VISITA ${whenText(start).toUpperCase()}\nCliente: ${contact.name ?? contact.pushName ?? contact.phone ?? ""}${contact.phone ? ` (${contact.phone})` : ""}\nO cliente recebeu o lembrete.`,
        );
      out.push({ appointmentId: a.id, result: `lembrete-${h}h` });
    } catch (e) {
      // Devolve a marcação para tentar de novo no próximo ciclo.
      await db.update(appointments).set({ remindersSent: sent }).where(eq(appointments.id, a.id));
      console.error(`[lembrete] visita ${a.id}:`, (e as Error)?.message ?? e);
      out.push({ appointmentId: a.id, result: "erro" });
    }
  }
  return out;
}

/** Conversa do contato para mandar o lembrete (usa a conexão da visita ou qualquer conexão aberta). */
export async function conversationFor(
  db: Database,
  organizationId: string,
  contact: { id: string; waJid: string; phone: string | null },
  connectionId: string | null,
) {
  const conns = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.organizationId, organizationId),
        eq(whatsappConnections.status, "open"),
        eq(whatsappConnections.active, true),
      ),
    );
  if (!conns.length) throw new Error("nenhuma conexão de WhatsApp aberta");
  const existing = await db
    .select({ id: conversations.id, connectionId: conversations.connectionId })
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`);
  const open = existing.filter((c) => conns.some((x) => x.id === c.connectionId));
  const found = open.find((c) => c.connectionId === connectionId) ?? open[0];
  if (found) return found.id;
  const conn = conns.find((c) => c.id === connectionId) ?? conns[0];
  if (!conn) throw new Error("nenhuma conexão de WhatsApp aberta");
  const { conversation } = await upsertContactAndConversation(db, conn, {
    contactJid: contact.waJid,
    phone: contact.phone ?? null,
    fromMe: true,
    verified: false,
  });
  return conversation.id;
}

/** Conexão aberta que o lembrete vai usar (a da conversa do contato, a da visita ou qualquer aberta). */
async function preferredConnection(
  db: Database,
  organizationId: string,
  contactId: string,
  connectionId: string | null,
) {
  const [row] = await db.execute<{ id: string }>(sql`
    select w.id from whatsapp_connections w
    where w.organization_id = ${organizationId}::uuid and w.status = 'open' and w.active
    order by (exists (select 1 from conversations c where c.contact_id = ${contactId}::uuid
                      and c.connection_id = w.id)) desc,
             (w.id = ${connectionId ?? "00000000-0000-0000-0000-000000000000"}::uuid) desc
    limit 1
  `);
  return row?.id ?? null;
}
