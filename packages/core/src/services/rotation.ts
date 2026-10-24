import {
  conversations,
  type Database,
  dealEvents,
  deals,
  leadRotation,
  memberships,
  notificationOutbox,
  users,
  whatsappConnections,
} from "@crm/db";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { type Actor, can } from "../auth/permissions.js";
import type { EvolutionApi } from "../whatsapp/evolution.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };

export async function getRotation(db: Database, organizationId: string) {
  return (
    (await db.query.leadRotation.findFirst({ where: eq(leadRotation.organizationId, organizationId) })) ?? {
      organizationId,
      enabled: false,
      userIds: [] as string[],
      lastUserId: null,
      notify: true,
      updatedAt: new Date(),
    }
  );
}

export async function saveRotation(
  db: Database,
  actor: ActorU,
  organizationId: string,
  input: { enabled: boolean; userIds: string[]; notify: boolean },
) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores configuram o rodízio.");
  const ids = [...new Set(input.userIds.filter((u) => /^[0-9a-f-]{36}$/i.test(u)))];
  const valid = ids.length
    ? await db
        .select({ id: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.active, true),
            inArray(memberships.userId, ids),
          ),
        )
    : [];
  const ok = ids.filter((id) => valid.some((v) => v.id === id));
  if (input.enabled && !ok.length)
    throw new AppError("validation", "Escolha pelo menos uma pessoa para o rodízio.");
  const values = { enabled: input.enabled, userIds: ok, notify: input.notify, updatedAt: new Date() };
  await db
    .insert(leadRotation)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: leadRotation.organizationId, set: values });
}

/** Próxima pessoa do rodízio (ignora quem saiu da equipe). Null se o rodízio estiver desligado. */
export async function pickNextAssignee(db: Database, organizationId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rotation:${organizationId}`}))`);
    const r = await tx.query.leadRotation.findFirst({
      where: eq(leadRotation.organizationId, organizationId),
    });
    if (!r?.enabled || !r.userIds.length) return null;
    const active = await tx
      .select({ id: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.active, true),
          inArray(memberships.userId, r.userIds),
        ),
      );
    const order = r.userIds.filter((id) => active.some((a) => a.id === id));
    if (!order.length) return null;
    const idx = r.lastUserId ? order.indexOf(r.lastUserId) : -1;
    const next = order[(idx + 1) % order.length] ?? order[0] ?? null;
    await tx
      .update(leadRotation)
      .set({ lastUserId: next })
      .where(eq(leadRotation.organizationId, organizationId));
    return next;
  });
}

function appUrl() {
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}

export function conversationLink(conversationId: string) {
  const base = appUrl();
  return base ? `${base}/conversas?c=${conversationId}` : "";
}

/** Põe um aviso de WhatsApp na fila para a pessoa (se ela tiver telefone e os avisos estiverem ligados). */
export async function notifyUser(
  db: Database,
  organizationId: string,
  connectionId: string | null,
  userId: string,
  body: string,
) {
  const r = await getRotation(db, organizationId);
  if (!r.notify) return false;
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u?.phone) return false;
  await db
    .insert(notificationOutbox)
    .values({ organizationId, connectionId, toPhone: u.phone, body: body.slice(0, 2000) });
  return true;
}

/** Distribui um lead novo: atribui conversa e negociação ao próximo do rodízio e avisa. */
export async function distributeLead(
  db: Database,
  organizationId: string,
  dealId: string,
  conversationId: string | null,
  connectionId: string | null,
  contact: { name: string | null; phone: string | null },
) {
  // Conversa que já tem responsável: o lead fica com essa pessoa, sem girar o rodízio.
  if (conversationId) {
    const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
    if (conv?.assignedUserId) return null;
  }
  const userId = await pickNextAssignee(db, organizationId);
  if (!userId) return null;
  await db
    .update(deals)
    .set({ assignedUserId: userId })
    .where(and(eq(deals.id, dealId), isNull(deals.assignedUserId)));
  if (conversationId)
    await db
      .update(conversations)
      .set({ assignedUserId: userId })
      .where(and(eq(conversations.id, conversationId), isNull(conversations.assignedUserId)));
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  await db
    .insert(dealEvents)
    .values({ organizationId, dealId, type: "assigned", data: { userId, name: u?.name, via: "rodízio" } });
  const link = conversationId ? conversationLink(conversationId) : "";
  await notifyUser(
    db,
    organizationId,
    connectionId,
    userId,
    `🔔 NOVO LEAD PARA VOCÊ\nCliente: ${contact.name || contact.phone || "sem nome"}${contact.phone ? `\nTelefone: ${contact.phone}` : ""}${link ? `\nAbrir conversa: ${link}` : ""}`,
  );
  await notifyOrg(db, { o: organizationId, t: "conversation", c: conversationId ?? undefined });
  return userId;
}

/** Envia os avisos pendentes. Chamado por um timer no servidor. */
export async function processOutbox(db: Database, evo: EvolutionApi, limit = 10) {
  const pending = await db
    .select()
    .from(notificationOutbox)
    .where(and(isNull(notificationOutbox.sentAt), lt(notificationOutbox.attempts, 5)))
    .orderBy(asc(notificationOutbox.createdAt))
    .limit(limit);
  let sent = 0;
  for (const n of pending) {
    try {
      // Usa a conexão de origem; se não houver/estiver fora, qualquer conexão aberta da empresa.
      const conns = await db
        .select()
        .from(whatsappConnections)
        .where(
          and(
            eq(whatsappConnections.organizationId, n.organizationId),
            eq(whatsappConnections.status, "open"),
            eq(whatsappConnections.active, true),
          ),
        );
      const conn = conns.find((c) => c.id === n.connectionId) ?? conns[0];
      if (!conn) throw new Error("nenhuma conexão de WhatsApp aberta");
      await evo.sendText(conn.instanceName, n.toPhone, n.body);
      await db
        .update(notificationOutbox)
        .set({ sentAt: new Date(), attempts: n.attempts + 1, error: null })
        .where(eq(notificationOutbox.id, n.id));
      sent++;
    } catch (e) {
      await db
        .update(notificationOutbox)
        .set({ attempts: n.attempts + 1, error: String((e as Error)?.message ?? e).slice(0, 300) })
        .where(eq(notificationOutbox.id, n.id));
    }
  }
  return { found: pending.length, sent };
}

export async function setMyPhone(db: Database, userId: string, phone: string) {
  const d = phone.replace(/\D/g, "");
  const { normalizePhoneInput } = await import("../whatsapp/evolution.js");
  const p = d ? normalizePhoneInput(d) : null;
  if (d && !p) throw new AppError("validation", "Telefone inválido. Use DDD + número.");
  await db.update(users).set({ phone: p, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Para a tela da equipe: rodízio + pessoas ativas (com telefone para aviso). */
export async function rotationOverview(db: Database, organizationId: string) {
  const r = await getRotation(db, organizationId);
  const people = await db
    .select({ id: users.id, name: users.name, phone: users.phone, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.active, true)))
    .orderBy(asc(users.name));
  return { enabled: r.enabled, notify: r.notify, userIds: r.userIds, lastUserId: r.lastUserId, people };
}
