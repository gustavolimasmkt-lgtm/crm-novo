import { type Database, memberships, scheduledMessages, users } from "@crm/db";
import { and, asc, eq, lte } from "drizzle-orm";
import type { Actor } from "../auth/permissions.js";
import type { EvolutionApi } from "../whatsapp/evolution.js";
import { getConversation, sendMessage } from "./conversations.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };

/** Agenda uma mensagem na conversa (sai em nome de quem agendou). */
export async function scheduleMessage(
  db: Database,
  actor: ActorU,
  organizationId: string,
  conversationId: string,
  input: { text: string; sendAt: Date },
) {
  const conv = await getConversation(db, actor, organizationId, conversationId);
  const body = input.text.trim();
  if (!body) throw new AppError("validation", "Escreva a mensagem.");
  if (body.length > 4096) throw new AppError("validation", "Mensagem longa demais.");
  const at = input.sendAt.getTime();
  if (Number.isNaN(at) || at < Date.now() + 60_000)
    throw new AppError("validation", "Escolha um horário a partir de daqui a 1 minuto.");
  if (at > Date.now() + 90 * 86_400_000) throw new AppError("validation", "Agende para no máximo 90 dias.");
  const [r] = await db
    .insert(scheduledMessages)
    .values({
      organizationId,
      conversationId: conv.id,
      body,
      sendAt: input.sendAt,
      createdByUserId: actor.userId,
    })
    .returning({ id: scheduledMessages.id });
  await notifyOrg(db, { o: organizationId, t: "message", c: conv.id });
  return r?.id ?? null;
}

export async function listScheduled(
  db: Database,
  actor: ActorU,
  organizationId: string,
  conversationId: string,
) {
  await getConversation(db, actor, organizationId, conversationId);
  return db
    .select({
      id: scheduledMessages.id,
      body: scheduledMessages.body,
      sendAt: scheduledMessages.sendAt,
      createdByName: users.name,
    })
    .from(scheduledMessages)
    .leftJoin(users, eq(users.id, scheduledMessages.createdByUserId))
    .where(and(eq(scheduledMessages.conversationId, conversationId), eq(scheduledMessages.status, "pending")))
    .orderBy(asc(scheduledMessages.sendAt));
}

export async function cancelScheduled(db: Database, actor: ActorU, organizationId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "Agendamento não encontrado.");
  const s = await db.query.scheduledMessages.findFirst({
    where: and(eq(scheduledMessages.id, id), eq(scheduledMessages.organizationId, organizationId)),
  });
  if (!s || s.status !== "pending") throw new AppError("not_found", "Agendamento não encontrado.");
  await getConversation(db, actor, organizationId, s.conversationId);
  await db.update(scheduledMessages).set({ status: "canceled" }).where(eq(scheduledMessages.id, id));
  await notifyOrg(db, { o: organizationId, t: "message", c: s.conversationId });
}

/** Envia as mensagens agendadas que venceram. Chamado por um timer no servidor. */
export async function processScheduled(db: Database, evo: EvolutionApi, limit = 20) {
  const due = await db
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, "pending"), lte(scheduledMessages.sendAt, new Date())))
    .orderBy(asc(scheduledMessages.sendAt))
    .limit(limit);
  let sent = 0;
  for (const s of due) {
    const claimed = await db
      .update(scheduledMessages)
      .set({ status: "sent" })
      .where(and(eq(scheduledMessages.id, s.id), eq(scheduledMessages.status, "pending")))
      .returning({ id: scheduledMessages.id });
    if (!claimed.length) continue;
    try {
      const u = s.createdByUserId
        ? await db.query.users.findFirst({ where: eq(users.id, s.createdByUserId) })
        : null;
      const m = u
        ? await db.query.memberships.findFirst({
            where: and(eq(memberships.userId, u.id), eq(memberships.organizationId, s.organizationId)),
          })
        : null;
      if (!u || (!u.isMaster && !m?.active)) throw new Error("quem agendou saiu da equipe");
      const actor = { isMaster: u.isMaster, role: m?.role ?? null, userId: u.id };
      const messageId = await sendMessage(db, evo, actor, s.organizationId, s.conversationId, {
        text: s.body,
      });
      await db.update(scheduledMessages).set({ messageId }).where(eq(scheduledMessages.id, s.id));
      sent++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      console.error(`[agendada] ${s.id}:`, msg);
      await db
        .update(scheduledMessages)
        .set({ status: "failed", error: msg })
        .where(eq(scheduledMessages.id, s.id));
      await notifyOrg(db, { o: s.organizationId, t: "message", c: s.conversationId });
    }
  }
  return sent;
}
