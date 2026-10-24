import {
  contacts,
  conversations,
  type Database,
  type MessageStatus,
  memberships,
  messages,
  users,
  webhookEvents,
  type whatsappConnections,
} from "@crm/db";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { phoneVariants } from "../whatsapp/evolution.js";
import { type ParsedMessage, parseMessage, parseStatus, previewOf } from "../whatsapp/parse.js";
import { maybeEnqueueAi } from "./agent.js";
import { autoCreateDeal } from "./crm.js";
import { notifyOrg } from "./events.js";
import { distributeLead } from "./rotation.js";

type Connection = typeof whatsappConnections.$inferSelect;
type Obj = Record<string, unknown>;

const STATUS_RANK: Record<MessageStatus, number> = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 };
export const MAX_EVENT_ATTEMPTS = 5;

/** Acha ou cria contato e conversa para uma mensagem. */
export async function upsertContactAndConversation(
  db: Database,
  c: Pick<Connection, "id" | "organizationId">,
  p: {
    contactJid: string;
    phone: string | null;
    pushName?: string | null;
    fromMe: boolean;
    verified?: boolean;
  },
) {
  const verified = p.verified !== false;
  // Contato cadastrado à mão ou importado (jid provisório) com o mesmo número: assume o jid real.
  if (verified && p.phone) {
    const pending = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, c.organizationId),
          eq(contacts.waVerified, false),
          inArray(contacts.phone, phoneVariants(p.phone)),
        ),
      )
      .limit(1);
    const taken = await db.query.contacts.findFirst({
      where: and(eq(contacts.organizationId, c.organizationId), eq(contacts.waJid, p.contactJid)),
    });
    if (pending[0] && !taken) {
      await db
        .update(contacts)
        .set({ waJid: p.contactJid, phone: p.phone, waVerified: true, updatedAt: new Date() })
        .where(eq(contacts.id, pending[0].id));
    }
  }
  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: c.organizationId,
      waJid: p.contactJid,
      phone: p.phone,
      pushName: p.fromMe ? null : (p.pushName ?? null),
      waVerified: verified,
    })
    .onConflictDoUpdate({
      target: [contacts.organizationId, contacts.waJid],
      set: {
        // Só atualiza o nome do WhatsApp quando quem escreveu foi o contato.
        pushName: p.fromMe || !p.pushName ? sql`${contacts.pushName}` : p.pushName,
        phone: sql`coalesce(${contacts.phone}, ${p.phone})`,
        waVerified: verified ? true : sql`${contacts.waVerified}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!contact) throw new Error("Falha ao gravar contato");

  const [conversation] = await db
    .insert(conversations)
    .values({ organizationId: c.organizationId, connectionId: c.id, contactId: contact.id })
    .onConflictDoUpdate({
      target: [conversations.connectionId, conversations.contactId],
      set: { updatedAt: new Date() },
    })
    .returning();
  if (!conversation) throw new Error("Falha ao gravar conversa");
  return { contact, conversation };
}

/** Grava uma mensagem (recebida, ou enviada pelo celular). Ignora duplicadas pelo id do WhatsApp. */
async function isTeamPhone(db: Database, organizationId: string, phone: string | null) {
  if (!phone) return false;
  const [hit] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.active, true),
        inArray(users.phone, phoneVariants(phone)),
      ),
    )
    .limit(1);
  return !!hit;
}

export async function storeParsedMessage(db: Database, c: Connection, p: ParsedMessage) {
  const { conversation, contact } = await upsertContactAndConversation(db, c, p);
  const [msg] = await db
    .insert(messages)
    .values({
      organizationId: c.organizationId,
      conversationId: conversation.id,
      connectionId: c.id,
      externalId: p.externalId,
      direction: p.fromMe ? "out" : "in",
      type: p.type,
      body: p.body,
      mediaMime: p.mediaMime,
      mediaName: p.mediaName,
      status: p.fromMe ? "sent" : "read",
      raw: p.raw,
      sentAt: p.sentAt,
    })
    .onConflictDoNothing({ target: [messages.connectionId, messages.externalId] })
    .returning({ id: messages.id });
  if (!msg) return { conversationId: conversation.id, duplicate: true };

  const at = sql`${p.sentAt.toISOString()}::timestamptz`;
  const newer = sql`coalesce(${conversations.lastMessageAt}, 'epoch'::timestamptz) <= ${at}`;
  await db
    .update(conversations)
    .set({
      lastMessageAt: sql`case when ${newer} then ${at} else ${conversations.lastMessageAt} end`,
      lastMessagePreview: sql`case when ${newer} then ${previewOf(p.type, p.body)} else ${conversations.lastMessagePreview} end`,
      lastMessageFromMe: sql`case when ${newer} then ${p.fromMe} else ${conversations.lastMessageFromMe} end`,
      unreadCount: p.fromMe ? 0 : sql`${conversations.unreadCount} + 1`,
      // Cliente escreveu numa conversa fechada: reabre.
      ...(p.fromMe ? {} : { status: "open" as const }),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversation.id));
  // Lead novo entra sozinho no funil padrão.
  // Quem escreve é alguém da equipe (ex.: respondendo um aviso): não vira lead nem recebe IA.
  if (!p.fromMe && !(await isTeamPhone(db, c.organizationId, contact.phone))) {
    const newDealId = await autoCreateDeal(db, c.organizationId, contact.id, c.id);
    if (newDealId)
      await distributeLead(db, c.organizationId, newDealId, conversation.id, c.id, {
        name: contact.name ?? contact.pushName ?? null,
        phone: contact.phone ?? null,
      });
    await maybeEnqueueAi(db, c.organizationId, conversation.id, c.id);
  }
  await notifyOrg(db, { o: c.organizationId, t: "message", c: conversation.id });
  return { conversationId: conversation.id, duplicate: false };
}

async function applyStatusUpdate(db: Database, c: Connection, data: Obj) {
  const key = (data.key as Obj | undefined) ?? {};
  const externalId = String(data.keyId ?? key.id ?? data.messageId ?? "");
  const status = parseStatus(data.status ?? (data.update as Obj | undefined)?.status);
  if (!externalId || !status) return;
  const row = await db.query.messages.findFirst({
    where: and(eq(messages.connectionId, c.id), eq(messages.externalId, externalId)),
  });
  if (!row || STATUS_RANK[status] <= STATUS_RANK[row.status]) return;
  await db.update(messages).set({ status }).where(eq(messages.id, row.id));
  await notifyOrg(db, { o: c.organizationId, t: "message", c: row.conversationId });
}

/** Processa um evento de mensagem já guardado. */
export async function processMessageEvent(db: Database, c: Connection, event: string, payload: unknown) {
  if (!c.active) return; // conexão desativada no CRM: guarda, mas não processa
  const data = (payload as Obj | undefined)?.data;
  const items = Array.isArray(data) ? data : [data];
  if (event === "messages.upsert" || event === "send.message") {
    for (const item of items) {
      const p = parseMessage(item);
      if ("skip" in p) continue;
      await storeParsedMessage(db, c, p);
    }
  } else if (event === "messages.update") {
    for (const item of items)
      if (item && typeof item === "object") await applyStatusUpdate(db, c, item as Obj);
  }
}

/** Processa eventos pendentes (falhas anteriores ou acúmulo). Usado também por um timer no servidor. */
export async function processPendingEvents(db: Database, limit = 50) {
  const pending = await db
    .select()
    .from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_EVENT_ATTEMPTS)))
    .orderBy(asc(webhookEvents.createdAt))
    .limit(limit);
  let done = 0;
  for (const ev of pending) {
    if (await processEventRow(db, ev)) done++;
  }
  return { found: pending.length, done };
}

export async function processEventRow(db: Database, ev: typeof webhookEvents.$inferSelect): Promise<boolean> {
  try {
    if (ev.connectionId) {
      const c = await db.query.whatsappConnections.findFirst({
        where: (t, { eq: e }) => e(t.id, ev.connectionId as string),
      });
      if (c) await processMessageEvent(db, c, ev.event, ev.payload);
    }
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), attempts: ev.attempts + 1, error: null })
      .where(eq(webhookEvents.id, ev.id));
    return true;
  } catch (e) {
    console.error(`[eventos] falha no evento ${ev.id} (${ev.event}):`, e);
    await db
      .update(webhookEvents)
      .set({ attempts: ev.attempts + 1, error: String((e as Error)?.message ?? e).slice(0, 500) })
      .where(eq(webhookEvents.id, ev.id));
    return false;
  }
}
