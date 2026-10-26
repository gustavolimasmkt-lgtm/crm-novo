import type { MessageType } from "@crm/db";
import { jidToPhone } from "./evolution.js";

/** Mensagem do WhatsApp (formato Baileys, como a Evolution entrega) já interpretada. */
export type ParsedMessage = {
  externalId: string;
  /** jid preferido do contato: o do número quando conhecido; senão o @lid. */
  contactJid: string;
  phone: string | null;
  fromMe: boolean;
  pushName: string | null;
  type: MessageType;
  body: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  sentAt: Date;
  /** Id (no WhatsApp) da mensagem que esta responde, se for resposta. */
  quotedExternalId: string | null;
  raw: Record<string, unknown>;
};

export type SkipReason = "group" | "broadcast" | "protocol" | "reaction" | "invalid";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" ? (v as Obj) : undefined);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Tira os envelopes (temporária, visualização única, documento com legenda). */
function unwrap(m: Obj | undefined): Obj | undefined {
  let cur = m;
  for (let i = 0; i < 5 && cur; i++) {
    const inner =
      obj(obj(cur.ephemeralMessage)?.message) ??
      obj(obj(cur.viewOnceMessage)?.message) ??
      obj(obj(cur.viewOnceMessageV2)?.message) ??
      obj(obj(cur.viewOnceMessageV2Extension)?.message) ??
      obj(obj(cur.documentWithCaptionMessage)?.message) ??
      obj(obj(cur.editedMessage)?.message);
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

export function previewOf(type: MessageType, body: string | null): string {
  const label: Record<MessageType, string> = {
    text: "",
    image: "📷 Foto",
    audio: "🎵 Áudio",
    video: "🎥 Vídeo",
    document: "📄 Documento",
    sticker: "Figurinha",
    location: "📍 Localização",
    contact: "👤 Contato",
    other: "Mensagem",
  };
  if (type === "text") return (body ?? "").slice(0, 140);
  return body ? `${label[type]}: ${body}`.slice(0, 140) : label[type];
}

export function parseMessage(data: unknown): ParsedMessage | { skip: SkipReason } {
  const d = obj(data);
  const key = obj(d?.key);
  const externalId = str(key?.id);
  const remoteJid = str(key?.remoteJid);
  if (!d || !key || !externalId || !remoteJid) return { skip: "invalid" };
  if (remoteJid.endsWith("@g.us")) return { skip: "group" };
  if (
    remoteJid === "status@broadcast" ||
    remoteJid.endsWith("@broadcast") ||
    remoteJid.endsWith("@newsletter")
  )
    return { skip: "broadcast" };

  const m = unwrap(obj(d.message));
  if (!m) return { skip: "invalid" };
  if (m.protocolMessage || (m.senderKeyDistributionMessage && Object.keys(m).length === 1))
    return { skip: "protocol" };
  if (m.reactionMessage) return { skip: "reaction" };

  // Endereçamento novo do WhatsApp (@lid): a Evolution manda o número em remoteJidAlt/senderPn quando sabe.
  const alt = str(key.remoteJidAlt) ?? str(key.senderPn) ?? str(d.senderPn);
  const contactJid = remoteJid.endsWith("@s.whatsapp.net")
    ? remoteJid
    : alt?.endsWith("@s.whatsapp.net")
      ? alt
      : remoteJid;
  const phone = contactJid.endsWith("@s.whatsapp.net") ? jidToPhone(contactJid) : null;

  let type: MessageType = "other";
  let body: string | null = null;
  let mediaMime: string | null = null;
  let mediaName: string | null = null;
  const img = obj(m.imageMessage);
  const vid = obj(m.videoMessage);
  const aud = obj(m.audioMessage);
  const doc = obj(m.documentMessage);
  const stk = obj(m.stickerMessage);
  const loc = obj(m.locationMessage) ?? obj(m.liveLocationMessage);
  const ctt = obj(m.contactMessage) ?? obj(m.contactsArrayMessage);
  if (str(m.conversation)) {
    type = "text";
    body = str(m.conversation);
  } else if (obj(m.extendedTextMessage)) {
    type = "text";
    body = str(obj(m.extendedTextMessage)?.text);
  } else if (img) {
    type = "image";
    body = str(img.caption);
    mediaMime = str(img.mimetype) ?? "image/jpeg";
  } else if (vid) {
    type = "video";
    body = str(vid.caption);
    mediaMime = str(vid.mimetype) ?? "video/mp4";
  } else if (aud) {
    type = "audio";
    mediaMime = str(aud.mimetype) ?? "audio/ogg";
  } else if (doc) {
    type = "document";
    body = str(doc.caption);
    mediaMime = str(doc.mimetype) ?? "application/octet-stream";
    mediaName = str(doc.fileName) ?? str(doc.title);
  } else if (stk) {
    type = "sticker";
    mediaMime = str(stk.mimetype) ?? "image/webp";
  } else if (loc) {
    type = "location";
    const lat = loc.degreesLatitude;
    const lng = loc.degreesLongitude;
    body = typeof lat === "number" && typeof lng === "number" ? `${lat},${lng}` : null;
  } else if (ctt) {
    type = "contact";
    body = str(ctt.displayName);
  } else if (
    str(obj(m.buttonsResponseMessage)?.selectedDisplayText) ||
    str(obj(m.listResponseMessage)?.title)
  ) {
    type = "text";
    body = str(obj(m.buttonsResponseMessage)?.selectedDisplayText) ?? str(obj(m.listResponseMessage)?.title);
  }

  // Resposta a outra mensagem: o id citado vem no contextInfo do conteúdo.
  let quotedExternalId: string | null = null;
  for (const v of Object.values(m)) {
    const id = str(obj(obj(v)?.contextInfo)?.stanzaId);
    if (id) {
      quotedExternalId = id;
      break;
    }
  }

  const ts = d.messageTimestamp;
  const seconds =
    typeof ts === "number" ? ts : typeof ts === "string" ? Number(ts) : Number(obj(ts)?.low ?? NaN);
  const sentAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();

  return {
    externalId,
    contactJid,
    phone,
    fromMe: key.fromMe === true,
    pushName: str(d.pushName),
    type,
    body,
    mediaMime,
    mediaName,
    sentAt,
    quotedExternalId,
    raw: { key, message: d.message, messageTimestamp: d.messageTimestamp },
  };
}

/** Mensagem apagada para todos ou editada (protocolMessage), com o id da mensagem original. */
export function parseProtocol(
  data: unknown,
): { kind: "revoke"; targetId: string } | { kind: "edit"; targetId: string; text: string } | null {
  const d = obj(data);
  let m = obj(d?.message);
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      obj(obj(m.ephemeralMessage)?.message) ?? obj(obj(m.editedMessage)?.message) ?? obj(obj(m.message));
    if (m.protocolMessage || !inner) break;
    m = inner;
  }
  const pm = obj(m?.protocolMessage);
  const target = str(obj(pm?.key)?.id);
  if (!pm || !target) return null;
  const type = pm.type;
  if (type === 0 || type === "REVOKE") return { kind: "revoke", targetId: target };
  const edited = obj(pm.editedMessage);
  const text = str(edited?.conversation) ?? str(obj(edited?.extendedTextMessage)?.text);
  if ((type === 14 || type === "MESSAGE_EDIT" || edited) && text)
    return { kind: "edit", targetId: target, text };
  return null;
}

/** Status de entrega vindo de messages.update. */
export function parseStatus(v: unknown): "sent" | "delivered" | "read" | "failed" | null {
  const s = String(v ?? "").toUpperCase();
  if (s === "SERVER_ACK" || s === "PENDING" || s === "1" || s === "2") return s === "PENDING" ? null : "sent";
  if (s === "DELIVERY_ACK" || s === "3") return "delivered";
  if (s === "READ" || s === "PLAYED" || s === "4" || s === "5") return "read";
  if (s === "ERROR" || s === "0") return "failed";
  return null;
}
