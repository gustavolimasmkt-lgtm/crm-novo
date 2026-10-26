import {
  aiJobs,
  auditLog,
  contacts,
  conversations,
  type Database,
  type MessageType,
  memberships,
  messageMedia,
  messages,
  users,
  whatsappConnections,
} from "@crm/db";
import { and, desc, eq, ilike, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transcriber } from "../ai/transcribe.js";
import { type Actor, can } from "../auth/permissions.js";
import {
  type EvolutionApi,
  EvolutionError,
  jidToTarget,
  normalizePhoneInput,
} from "../whatsapp/evolution.js";
import { previewOf } from "../whatsapp/parse.js";
import { syncDealAssignee } from "./crm.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";
import { upsertContactAndConversation } from "./messages.js";

type ActorU = Actor & { userId: string };

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Vendedor e atendente veem as conversas deles e as sem dono; admin, gestor e Master veem todas. */
function visibility(actor: ActorU): SQL | undefined {
  if (can(actor, "conversations.view_all")) return undefined;
  return or(eq(conversations.assignedUserId, actor.userId), isNull(conversations.assignedUserId));
}

export type ConversationFilter = "open" | "unread" | "closed" | "all" | "mine";

export type ConversationListItem = {
  id: string;
  status: "open" | "closed";
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean | null;
  contactId: string;
  contactName: string | null;
  contactPushName: string | null;
  contactPhone: string | null;
  connectionId: string;
  connectionName: string;
  connectionPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  aiPaused: boolean;
  aiPausedReason: string | null;
};

const listColumns = {
  id: conversations.id,
  status: conversations.status,
  unreadCount: conversations.unreadCount,
  lastMessageAt: conversations.lastMessageAt,
  lastMessagePreview: conversations.lastMessagePreview,
  lastMessageFromMe: conversations.lastMessageFromMe,
  contactId: contacts.id,
  contactName: contacts.name,
  contactPushName: contacts.pushName,
  contactPhone: contacts.phone,
  connectionId: whatsappConnections.id,
  connectionName: whatsappConnections.name,
  connectionPhone: whatsappConnections.phone,
  assignedUserId: conversations.assignedUserId,
  assignedUserName: users.name,
  aiPaused: conversations.aiPaused,
  aiPausedReason: conversations.aiPausedReason,
};

function baseQuery(db: Database) {
  return db
    .select(listColumns)
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .innerJoin(whatsappConnections, eq(whatsappConnections.id, conversations.connectionId))
    .leftJoin(users, eq(users.id, conversations.assignedUserId));
}

export async function listConversations(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { filter?: ConversationFilter; q?: string; limit?: number } = {},
): Promise<ConversationListItem[]> {
  const conds: (SQL | undefined)[] = [eq(conversations.organizationId, organizationId), visibility(actor)];
  const f = opts.filter ?? "open";
  if (f === "open") conds.push(eq(conversations.status, "open"));
  if (f === "closed") conds.push(eq(conversations.status, "closed"));
  if (f === "unread") conds.push(sql`${conversations.unreadCount} > 0`);
  if (f === "mine") conds.push(eq(conversations.assignedUserId, actor.userId));
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(contacts.name, `%${q}%`),
        ilike(contacts.pushName, `%${q}%`),
        digits.length >= 3 ? ilike(contacts.phone, `%${digits}%`) : undefined,
      ),
    );
  }
  return baseQuery(db)
    .where(and(...conds))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(Math.min(opts.limit ?? 100, 200));
}

export async function getConversation(db: Database, actor: ActorU, organizationId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "Conversa não encontrada.");
  const [row] = await baseQuery(db)
    .where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId), visibility(actor)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Conversa não encontrada.");
  return row;
}

export type MessageItem = {
  id: string;
  direction: "in" | "out";
  type: MessageType;
  body: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  sentAt: Date;
  sentByName: string | null;
  sentByAi: boolean;
  internal: boolean;
  transcript: string | null;
};

export async function listMessages(
  db: Database,
  actor: ActorU,
  organizationId: string,
  conversationId: string,
  opts: { before?: Date; limit?: number } = {},
): Promise<MessageItem[]> {
  await getConversation(db, actor, organizationId, conversationId);
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      mediaMime: messages.mediaMime,
      mediaName: messages.mediaName,
      status: messages.status,
      error: messages.error,
      sentAt: messages.sentAt,
      sentByName: users.name,
      sentByAi: messages.sentByAi,
      internal: messages.internal,
      transcript: messages.transcript,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sentByUserId))
    .where(
      and(
        eq(messages.conversationId, conversationId),
        opts.before ? lt(messages.sentAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(messages.sentAt), desc(messages.createdAt))
    .limit(Math.min(opts.limit ?? 60, 200));
  return rows.reverse();
}

export async function markConversationRead(db: Database, actor: ActorU, organizationId: string, id: string) {
  const c = await getConversation(db, actor, organizationId, id);
  if (c.unreadCount === 0) return;
  await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, id));
  await notifyOrg(db, { o: organizationId, t: "conversation", c: id });
}

export async function setConversationStatus(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  status: "open" | "closed",
) {
  await getConversation(db, actor, organizationId, id);
  await db
    .update(conversations)
    .set({ status, ...(status === "closed" ? { unreadCount: 0 } : {}), updatedAt: new Date() })
    .where(eq(conversations.id, id));
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: `conversation.${status}`,
    entity: "conversation",
    entityId: id,
  });
  await notifyOrg(db, { o: organizationId, t: "conversation", c: id });
}

/** Atribui a conversa. Qualquer um puxa para si uma conversa sem dono; passar para outra pessoa exige gestor/admin. */
export async function assignConversation(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  userId: string | null,
) {
  const c = await getConversation(db, actor, organizationId, id);
  const self = userId === actor.userId;
  if (!can(actor, "conversations.view_all")) {
    if (!self || !can(actor, "conversations.take"))
      throw new AppError("forbidden", "Você só pode puxar conversas para você.");
    if (c.assignedUserId && c.assignedUserId !== actor.userId)
      throw new AppError("forbidden", "Essa conversa já tem responsável.");
  }
  if (userId) {
    const m = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        eq(memberships.active, true),
      ),
    });
    if (!m && !self) throw new AppError("validation", "Essa pessoa não faz parte da equipe.");
  }
  await db
    .update(conversations)
    .set({ assignedUserId: userId, updatedAt: new Date() })
    .where(eq(conversations.id, id));
  await syncDealAssignee(db, organizationId, c.contactId, userId);
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "conversation.assigned",
    entity: "conversation",
    entityId: id,
    data: { userId },
  });
  await notifyOrg(db, { o: organizationId, t: "conversation", c: id });
}

export async function listAssignableUsers(db: Database, organizationId: string) {
  return db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.active, true)))
    .orderBy(users.name);
}

export const sendInput = z.object({
  text: z.string().max(4096, "Mensagem longa demais (máximo 4096 caracteres).").optional(),
  file: z
    .object({ name: z.string().max(200), mime: z.string().max(120), data: z.instanceof(Buffer) })
    .optional(),
});

function kindOf(mime: string): MessageType {
  if (mime.startsWith("image/") && mime !== "image/webp") return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

async function loadSendContext(db: Database, actor: ActorU, organizationId: string, conversationId: string) {
  const conv = await getConversation(db, actor, organizationId, conversationId);
  const connection = await db.query.whatsappConnections.findFirst({
    where: eq(whatsappConnections.id, conv.connectionId),
  });
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
  if (!connection || !contact) throw new AppError("not_found", "Conversa não encontrada.");
  if (!connection.active)
    throw new AppError("validation", "Essa conexão está desativada. Ative em Conexões.");
  if (connection.status !== "open")
    throw new AppError("validation", "O WhatsApp dessa conexão está desconectado. Reconecte em Conexões.");
  return { conv, connection, contact };
}

/** Envia texto ou arquivo. A mensagem é gravada antes (pendente) e atualizada com o resultado. */
export async function sendMessage(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  conversationId: string,
  raw: z.input<typeof sendInput>,
) {
  const input = sendInput.parse(raw);
  const text = input.text?.trim() || null;
  if (!text && !input.file) throw new AppError("validation", "Escreva uma mensagem ou anexe um arquivo.");
  if (input.file && input.file.data.length > MAX_MEDIA_BYTES)
    throw new AppError("validation", "Arquivo grande demais (máximo 16 MB).");
  const { conv, connection, contact } = await loadSendContext(db, actor, organizationId, conversationId);

  const type: MessageType = input.file ? kindOf(input.file.mime) : "text";
  const [msg] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId,
      connectionId: connection.id,
      direction: "out",
      type,
      body: type === "audio" ? null : text,
      mediaMime: input.file?.mime ?? null,
      mediaName: input.file?.name ?? null,
      status: "pending",
      sentByUserId: actor.userId,
    })
    .returning();
  if (!msg) throw new Error("Falha ao gravar mensagem");
  if (input.file) {
    await db.insert(messageMedia).values({
      messageId: msg.id,
      mime: input.file.mime,
      fileName: input.file.name,
      data: input.file.data,
    });
  }
  // Responder conversa sem dono assume a conversa.
  const assign = !conv.assignedUserId && !actor.isMaster ? { assignedUserId: actor.userId } : {};
  await db
    .update(conversations)
    .set({
      lastMessageAt: msg.sentAt,
      lastMessagePreview: previewOf(type, text),
      lastMessageFromMe: true,
      unreadCount: 0,
      status: "open",
      ...assign,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
  if (assign.assignedUserId)
    await syncDealAssignee(db, organizationId, conv.contactId, assign.assignedUserId);
  // Atendente respondeu: a IA sai desta conversa até alguém religar.
  await db
    .update(conversations)
    .set({ aiPaused: true, aiPausedReason: "Um atendente respondeu" })
    .where(and(eq(conversations.id, conversationId), eq(conversations.aiPaused, false)));
  await db.delete(aiJobs).where(eq(aiJobs.conversationId, conversationId));
  await notifyOrg(db, { o: organizationId, t: "message", c: conversationId });

  await deliver(db, evo, organizationId, msg.id, connection.instanceName, jidToTarget(contact.waJid), {
    type,
    text,
    file: input.file,
  });
  return msg.id;
}

async function deliver(
  db: Database,
  evo: EvolutionApi,
  organizationId: string,
  messageId: string,
  instanceName: string,
  to: string,
  m: {
    type: MessageType;
    text: string | null;
    file?: { name: string; mime: string; data: Buffer };
    delay?: number;
  },
) {
  try {
    let r: Awaited<ReturnType<EvolutionApi["sendText"]>>;
    if (!m.file)
      r = await evo.sendText(instanceName, to, m.text ?? "", m.delay ? { delay: m.delay } : undefined);
    else if (m.type === "audio") r = await evo.sendAudio(instanceName, to, m.file.data.toString("base64"));
    else
      r = await evo.sendMedia(instanceName, to, {
        kind: m.type === "image" ? "image" : m.type === "video" ? "video" : "document",
        mime: m.file.mime,
        base64: m.file.data.toString("base64"),
        fileName: m.file.name,
        caption: m.text ?? undefined,
      });
    // O eco (send.message/messages.upsert) pode chegar antes desta resposta; se já gravou, une os dois.
    // Une com o eco numa transação; se o eco entrar no meio, tenta de novo.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await db.transaction(async (tx) => {
          await tx
            .delete(messages)
            .where(and(eq(messages.externalId, r.externalId), sql`${messages.id} <> ${messageId}`));
          await tx
            .update(messages)
            .set({ externalId: r.externalId, status: "sent", error: null, raw: r.raw as object })
            .where(eq(messages.id, messageId));
        });
        break;
      } catch (err) {
        const e2 = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
        const info = `${e2.message ?? ""} ${e2.code ?? ""} ${e2.cause?.message ?? ""} ${e2.cause?.code ?? ""}`;
        if (attempt === 2 || !/duplicate|unique|23505/i.test(info)) throw err;
      }
    }
  } catch (e) {
    const detail = e instanceof EvolutionError ? e.message : String((e as Error)?.message ?? e);
    console.error("[envio]", detail);
    await db
      .update(messages)
      .set({ status: "failed", error: "Não foi possível enviar. Tente de novo." })
      .where(eq(messages.id, messageId));
  }
  const row = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  await notifyOrg(db, { o: organizationId, t: "message", c: row?.conversationId });
}

/** Tenta de novo uma mensagem que falhou. */
export async function retryMessage(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  messageId: string,
) {
  const msg = await db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)),
  });
  if (!msg || msg.direction !== "out") throw new AppError("not_found", "Mensagem não encontrada.");
  if (msg.status !== "failed") return;
  const { connection, contact } = await loadSendContext(db, actor, organizationId, msg.conversationId);
  const media = await db.query.messageMedia.findFirst({ where: eq(messageMedia.messageId, msg.id) });
  await db.update(messages).set({ status: "pending", error: null }).where(eq(messages.id, msg.id));
  await deliver(db, evo, organizationId, msg.id, connection.instanceName, jidToTarget(contact.waJid), {
    type: msg.type,
    text: msg.body,
    file: media ? { name: media.fileName ?? "arquivo", mime: media.mime, data: media.data } : undefined,
  });
}

/** Devolve a mídia da mensagem; na primeira vez baixa da Evolution e guarda. */
export async function getMessageMedia(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  messageId: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new AppError("not_found", "Mídia não encontrada.");
  const msg = await db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)),
  });
  if (!msg) throw new AppError("not_found", "Mídia não encontrada.");
  await getConversation(db, actor, organizationId, msg.conversationId);
  return loadMessageMedia(db, evo, msg);
}

/** Mídia da mensagem (sem checar permissão): usa o cache ou baixa da Evolution e guarda. */
async function loadMessageMedia(db: Database, evo: EvolutionApi, msg: typeof messages.$inferSelect) {
  const cached = await db.query.messageMedia.findFirst({ where: eq(messageMedia.messageId, msg.id) });
  if (cached) return { mime: cached.mime, fileName: cached.fileName, data: cached.data };
  if (!msg.raw) throw new AppError("not_found", "Mídia não disponível.");
  const connection = await db.query.whatsappConnections.findFirst({
    where: eq(whatsappConnections.id, msg.connectionId),
  });
  if (!connection) throw new AppError("not_found", "Mídia não disponível.");
  let got: Awaited<ReturnType<EvolutionApi["getMedia"]>>;
  try {
    got = await evo.getMedia(connection.instanceName, msg.raw);
  } catch (e) {
    console.error("[mídia]", (e as Error).message);
    throw new AppError("integration", "Não foi possível baixar a mídia agora.");
  }
  const data = Buffer.from(got.base64, "base64");
  const mime =
    (got.mime ?? msg.mediaMime ?? "application/octet-stream").split(";")[0]?.trim() ||
    "application/octet-stream";
  const fileName = got.fileName ?? msg.mediaName;
  if (data.length <= MAX_MEDIA_BYTES) {
    await db.insert(messageMedia).values({ messageId: msg.id, mime, fileName, data }).onConflictDoNothing();
  }
  return { mime, fileName, data };
}

export const startInput = z.object({
  connectionId: z.string().uuid("Escolha a conexão."),
  phone: z.string().min(8, "Digite o número com DDD."),
  brazil: z.boolean().default(true),
  landline: z.boolean().default(false),
});

/** Inicia (ou reabre) conversa com um número. Confere na Evolution se o número tem WhatsApp. */
export async function startConversation(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof startInput>,
) {
  if (!can(actor, "conversations.take")) throw new AppError("forbidden", "Sem permissão.");
  const input = startInput.parse(raw);
  const connection = await db.query.whatsappConnections.findFirst({
    where: and(
      eq(whatsappConnections.id, input.connectionId),
      eq(whatsappConnections.organizationId, organizationId),
    ),
  });
  if (!connection) throw new AppError("not_found", "Conexão não encontrada.");
  if (connection.status !== "open") throw new AppError("validation", "Essa conexão está desconectada.");
  const phone = normalizePhoneInput(input.phone, { brazil: input.brazil, landline: input.landline });
  if (!phone) throw new AppError("validation", "Número inválido. Digite com DDD, ex.: 48 99999-9999.");

  let jid = `${phone}@s.whatsapp.net`;
  let verified = false;
  try {
    const [r] = await evo.checkNumbers(connection.instanceName, [phone]);
    if (r && !r.exists) throw new AppError("validation", "Esse número não tem WhatsApp.");
    if (r?.jid) {
      jid = r.jid;
      verified = true;
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error("[checagem de número]", (e as Error).message);
  }
  const realPhone = jid.endsWith("@s.whatsapp.net") ? (jid.split("@")[0] ?? phone) : phone;
  const { conversation } = await upsertContactAndConversation(db, connection, {
    contactJid: jid,
    phone: realPhone,
    fromMe: true,
    verified,
  });
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversation.id) });
  if (
    conv &&
    !can(actor, "conversations.view_all") &&
    conv.assignedUserId &&
    conv.assignedUserId !== actor.userId
  ) {
    throw new AppError("forbidden", "Esse contato já está sendo atendido por outra pessoa.");
  }
  await db
    .update(conversations)
    .set({
      status: "open",
      ...(conv?.assignedUserId || actor.isMaster ? {} : { assignedUserId: actor.userId }),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversation.id));
  await notifyOrg(db, { o: organizationId, t: "conversation", c: conversation.id });
  return conversation.id;
}

/** Conexões que a pessoa pode usar para iniciar conversa. */
export async function listUsableConnections(db: Database, organizationId: string) {
  return db
    .select({
      id: whatsappConnections.id,
      name: whatsappConnections.name,
      phone: whatsappConnections.phone,
      status: whatsappConnections.status,
    })
    .from(whatsappConnections)
    .where(and(eq(whatsappConnections.organizationId, organizationId), eq(whatsappConnections.active, true)))
    .orderBy(whatsappConnections.createdAt);
}

export async function renameContact(
  db: Database,
  actor: ActorU,
  organizationId: string,
  conversationId: string,
  name: string,
) {
  const c = await getConversation(db, actor, organizationId, conversationId);
  const clean = name.trim().slice(0, 80) || null;
  await db.update(contacts).set({ name: clean, updatedAt: new Date() }).where(eq(contacts.id, c.contactId));
  await notifyOrg(db, { o: organizationId, t: "conversation", c: conversationId });
}

/** Mensagem enviada pelo agente de IA (não assume a conversa nem pausa a IA). */
export async function sendAiMessage(
  db: Database,
  evo: EvolutionApi,
  organizationId: string,
  conversationId: string,
  text: string,
  opts: {
    image?: { name: string; mime: string; data: Buffer };
    /** Envio automático (follow-up, lembrete): conta no limite anti-bloqueio. */
    automation?: string;
    /** Mostra "digitando..." antes, proporcional ao tamanho do texto. */
    typing?: boolean;
  } = {},
) {
  const { image } = opts;
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
  });
  if (!conv) throw new AppError("not_found", "Conversa não encontrada.");
  const connection = await db.query.whatsappConnections.findFirst({
    where: eq(whatsappConnections.id, conv.connectionId),
  });
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
  if (!connection || !contact || !connection.active || connection.status !== "open")
    throw new AppError("validation", "Conexão indisponível para a IA responder.");
  const type = image ? ("image" as const) : ("text" as const);
  const [msg] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId,
      connectionId: connection.id,
      direction: "out",
      type,
      body: text || null,
      mediaMime: image?.mime ?? null,
      mediaName: image?.name ?? null,
      status: "pending",
      sentByAi: true,
      automation: opts.automation ?? null,
    })
    .returning();
  if (!msg) throw new Error("Falha ao gravar mensagem");
  if (image)
    await db
      .insert(messageMedia)
      .values({ messageId: msg.id, mime: image.mime, fileName: image.name, data: image.data })
      .onConflictDoNothing();
  await db
    .update(conversations)
    .set({
      lastMessageAt: msg.sentAt,
      lastMessagePreview: previewOf(type, text || null),
      lastMessageFromMe: true,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
  await notifyOrg(db, { o: organizationId, t: "message", c: conversationId });
  await deliver(db, evo, organizationId, msg.id, connection.instanceName, jidToTarget(contact.waJid), {
    type,
    text: text || null,
    file: image,
    delay: opts.typing && !image ? Math.min(6000, 1000 + text.length * 25) : undefined,
  });
  return msg.id;
}

/** Nota interna na conversa: só a equipe vê; não vai para o WhatsApp nem para a IA. */
export async function addNote(
  db: Database,
  actor: ActorU,
  organizationId: string,
  conversationId: string,
  text: string,
) {
  const conv = await getConversation(db, actor, organizationId, conversationId);
  const body = text.trim();
  if (!body) throw new AppError("validation", "Escreva a nota.");
  if (body.length > 4000) throw new AppError("validation", "Nota longa demais (máximo 4000 caracteres).");
  const [m] = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId: conv.id,
      connectionId: conv.connectionId,
      direction: "out",
      type: "text",
      body,
      status: "sent",
      internal: true,
      sentByUserId: actor.userId,
    })
    .returning({ id: messages.id });
  await notifyOrg(db, { o: organizationId, t: "message", c: conv.id });
  return m?.id ?? null;
}

/**
 * Transcreve um áudio (e guarda). Com actor, confere a permissão de ver a conversa.
 * Devolve o texto ou null se não for áudio.
 */
export async function transcribeMessage(
  db: Database,
  evo: EvolutionApi,
  stt: Transcriber,
  organizationId: string,
  messageId: string,
  actor: ActorU | null = null,
) {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw new AppError("not_found", "Mensagem não encontrada.");
  const msg = await db.query.messages.findFirst({
    where: and(eq(messages.id, messageId), eq(messages.organizationId, organizationId)),
  });
  if (!msg) throw new AppError("not_found", "Mensagem não encontrada.");
  if (actor) await getConversation(db, actor, organizationId, msg.conversationId);
  if (msg.type !== "audio") return null;
  if (msg.transcript) return msg.transcript;
  const media = await loadMessageMedia(db, evo, msg);
  const text = (await stt.transcribe(media.data, media.mime, media.fileName ?? "audio.ogg"))
    .trim()
    .slice(0, 8000);
  await db
    .update(messages)
    .set({ transcript: text || "(áudio sem fala)" })
    .where(eq(messages.id, msg.id));
  await notifyOrg(db, { o: organizationId, t: "message", c: msg.conversationId });
  return text || "(áudio sem fala)";
}
