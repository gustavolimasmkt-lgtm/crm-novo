import { contacts, conversations, messages, webhookEvents, whatsappConnections } from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  assignConversation,
  createConnection,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  getMessageMedia,
  handleEvolutionWebhook,
  listConversations,
  listMessages,
  markConversationRead,
  normalizePhoneInput,
  parseMessage,
  processPendingEvents,
  refreshConnection,
  retryMessage,
  sendMessage,
  setConnectionActive,
  setConversationStatus,
  startConversation,
} from "../src/index.js";
import { type FakeEvolution, startFakeEvolution } from "../src/testing/fake-evolution.js";
import { createMaster, db, resetDb } from "./helpers.js";

let fake: FakeEvolution;
let evo: ReturnType<typeof createEvolutionClient>;

beforeAll(async () => {
  fake = await startFakeEvolution();
  evo = createEvolutionClient({ baseUrl: fake.url, apiKey: fake.apiKey });
});
afterAll(() => fake.close());
beforeEach(async () => {
  await resetDb();
  fake.sent.length = 0;
  fake.failSends = false;
  fake.withoutWhatsapp.clear();
  for (const k of [...fake.instances.keys()]) if (k !== "GREENCAR") fake.instances.delete(k);
});

async function setup() {
  const master = await createMaster();
  const masterActor = { isMaster: true, role: null, userId: master.id };
  const { organization: org, invite } = await createOrganization(db, masterActor, {
    name: "Loja Teste",
    adminEmail: "admin@loja.com",
    adminName: "Admin Loja",
  });
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin Loja", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const mk = async (email: string, role: "seller" | "agent" | "manager") => {
    const inv = await createInvitation(db, admin, org.id, { email, role });
    const u = await acceptInvitation(db, {
      token: inv.token,
      name: `Pessoa ${email.split("@")[0]}`,
      password: "senha1234",
    });
    return { isMaster: false, role, userId: u.userId };
  };
  const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
  const instance = row?.instanceName ?? "";
  await fake.scan(instance);
  await refreshConnection(db, evo, admin, org.id, conn.id);
  const url = new URL(fake.instances.get(instance)?.webhook ?? "");
  const token = url.searchParams.get("t") ?? "";
  const hook = (event: string, data: unknown) =>
    handleEvolutionWebhook(db, conn.id, token, { event, instance, data });
  return { org, admin, masterActor, mk, conn, instance, hook };
}

const incoming = (id: string, from: string, text: string, extra: Record<string, unknown> = {}) => ({
  key: { id, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
  pushName: "Maria Cliente",
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  ...extra,
});

describe("interpretação das mensagens", () => {
  it("entende texto, mídia, envelopes e ignora grupo, status e reação", () => {
    const t = parseMessage(incoming("A", "5548999990000", "oi"));
    expect("skip" in t ? null : t.body).toBe("oi");
    const img = parseMessage({
      key: { id: "B", remoteJid: "5548999990000@s.whatsapp.net", fromMe: false },
      message: {
        ephemeralMessage: { message: { imageMessage: { mimetype: "image/jpeg", caption: "foto" } } },
      },
    });
    expect("skip" in img ? null : [img.type, img.body, img.mediaMime]).toEqual([
      "image",
      "foto",
      "image/jpeg",
    ]);
    const doc = parseMessage({
      key: { id: "C", remoteJid: "5548999990000@s.whatsapp.net", fromMe: true },
      message: {
        documentWithCaptionMessage: {
          message: { documentMessage: { fileName: "proposta.pdf", mimetype: "application/pdf" } },
        },
      },
    });
    expect("skip" in doc ? null : [doc.type, doc.mediaName, doc.fromMe]).toEqual([
      "document",
      "proposta.pdf",
      true,
    ]);
    expect(parseMessage({ key: { id: "D", remoteJid: "123@g.us" }, message: { conversation: "x" } })).toEqual(
      { skip: "group" },
    );
    expect(
      parseMessage({ key: { id: "E", remoteJid: "status@broadcast" }, message: { conversation: "x" } }),
    ).toEqual({ skip: "broadcast" });
    expect(
      parseMessage({
        key: { id: "F", remoteJid: "1@s.whatsapp.net" },
        message: { reactionMessage: { text: "👍" } },
      }),
    ).toEqual({ skip: "reaction" });
    const lid = parseMessage({
      key: {
        id: "G",
        remoteJid: "99887766@lid",
        remoteJidAlt: "5548999990000@s.whatsapp.net",
        fromMe: false,
      },
      message: { conversation: "via lid" },
    });
    expect("skip" in lid ? null : [lid.contactJid, lid.phone]).toEqual([
      "5548999990000@s.whatsapp.net",
      "5548999990000",
    ]);
  });

  it("normaliza número digitado", () => {
    expect(normalizePhoneInput("(48) 99674-3297")).toBe("5548996743297");
    expect(normalizePhoneInput("48 9674-3297")).toBe("5548996743297");
    expect(normalizePhoneInput("48 3433-1234", { landline: true })).toBe("554834331234");
    expect(normalizePhoneInput("+55 48 99674-3297")).toBe("5548996743297");
    expect(normalizePhoneInput("123")).toBeNull();
    expect(normalizePhoneInput("14155550100", { brazil: false })).toBe("14155550100");
  });
});

describe("recebimento", () => {
  it("cria contato e conversa, conta não lidas e ignora duplicadas", async () => {
    const { org, admin, hook } = await setup();
    await hook("messages.upsert", incoming("M1", "5548999990000", "Oi, o carro ainda está disponível?"));
    await hook("messages.upsert", incoming("M1", "5548999990000", "Oi, o carro ainda está disponível?"));
    await hook("MESSAGES_UPSERT", incoming("M2", "5548999990000", "Aceita troca?"));

    const list = await listConversations(db, admin, org.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      contactPhone: "5548999990000",
      contactPushName: "Maria Cliente",
      unreadCount: 2,
      lastMessagePreview: "Aceita troca?",
      lastMessageFromMe: false,
      status: "open",
    });
    const msgs = await listMessages(db, admin, org.id, list[0]?.id ?? "");
    expect(msgs.map((m) => m.body)).toEqual(["Oi, o carro ainda está disponível?", "Aceita troca?"]);
    await markConversationRead(db, admin, org.id, list[0]?.id ?? "");
    expect((await listConversations(db, admin, org.id, { filter: "unread" })).length).toBe(0);
  });

  it("mensagem enviada pelo celular aparece como enviada; grupos não viram conversa", async () => {
    const { org, admin, hook } = await setup();
    await hook("messages.upsert", {
      ...incoming("P1", "5548999990001", "Te mando o orçamento"),
      key: { id: "P1", remoteJid: "5548999990001@s.whatsapp.net", fromMe: true },
    });
    await hook("messages.upsert", {
      key: { id: "G1", remoteJid: "1203@g.us", fromMe: false },
      message: { conversation: "grupo" },
    });
    const list = await listConversations(db, admin, org.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.unreadCount).toBe(0);
    const msgs = await listMessages(db, admin, org.id, list[0]?.id ?? "");
    expect(msgs[0]).toMatchObject({ direction: "out", sentByName: null });
    // eventos guardados e processados mesmo quando ignorados
    const evs = await db.select().from(webhookEvents);
    expect(evs.every((e) => e.processedAt)).toBe(true);
  });

  it("cliente escrevendo reabre conversa fechada", async () => {
    const { org, admin, hook } = await setup();
    await hook("messages.upsert", incoming("R1", "5548999990002", "oi"));
    const [c] = await listConversations(db, admin, org.id);
    await setConversationStatus(db, admin, org.id, c?.id ?? "", "closed");
    expect(await listConversations(db, admin, org.id)).toHaveLength(0);
    expect(await listConversations(db, admin, org.id, { filter: "closed" })).toHaveLength(1);
    await hook("messages.upsert", incoming("R2", "5548999990002", "voltei"));
    expect(await listConversations(db, admin, org.id)).toHaveLength(1);
  });

  it("conexão desativada guarda o evento mas não cria conversa; reprocessador pega pendentes", async () => {
    const { org, admin, conn, hook } = await setup();
    await setConnectionActive(db, admin, org.id, conn.id, false);
    await hook("messages.upsert", incoming("D1", "5548999990003", "oi"));
    expect(await listConversations(db, admin, org.id)).toHaveLength(0);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);

    // evento pendente (ex.: falhou antes) é processado pelo reprocessador
    await setConnectionActive(db, admin, org.id, conn.id, true);
    await db.insert(webhookEvents).values({
      connectionId: conn.id,
      organizationId: org.id,
      event: "messages.upsert",
      payload: { event: "messages.upsert", data: incoming("D2", "5548999990003", "chegou depois") },
    });
    const r = await processPendingEvents(db);
    expect(r).toEqual({ found: 1, done: 1 });
    const [c] = await listConversations(db, admin, org.id);
    expect(c?.lastMessagePreview).toBe("chegou depois");
  });

  it("baixa a mídia da Evolution uma vez e guarda", async () => {
    const { org, admin, hook } = await setup();
    await hook("messages.upsert", {
      key: { id: "IMG1", remoteJid: "5548999990004@s.whatsapp.net", fromMe: false },
      message: { imageMessage: { mimetype: "image/jpeg", caption: "olha o carro" } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    });
    const [c] = await listConversations(db, admin, org.id);
    expect(c?.lastMessagePreview).toBe("📷 Foto: olha o carro");
    const [m] = await listMessages(db, admin, org.id, c?.id ?? "");
    const before = fake.calls.filter((x) => x.path.includes("getBase64")).length;
    const media = await getMessageMedia(db, evo, admin, org.id, m?.id ?? "");
    expect(media.mime).toBe("image/png");
    expect(media.data.length).toBeGreaterThan(10);
    await getMessageMedia(db, evo, admin, org.id, m?.id ?? "");
    expect(fake.calls.filter((x) => x.path.includes("getBase64")).length).toBe(before + 1);
  });
});

describe("envio", () => {
  it("envia texto, assume a conversa, aplica status e não duplica com o eco", async () => {
    const { org, mk, hook } = await setup();
    const seller = await mk("vendedor@loja.com", "seller");
    await hook("messages.upsert", incoming("S1", "5548999990005", "Quero simular"));
    const [c] = await listConversations(db, seller, org.id);
    const id = await sendMessage(db, evo, seller, org.id, c?.id ?? "", {
      text: "Claro! Qual valor de entrada?",
    });
    expect(fake.sent.at(-1)).toMatchObject({ kind: "sendText", to: "5548999990005" });

    const msg = await db.query.messages.findFirst({ where: eq(messages.id, id) });
    expect(msg).toMatchObject({ status: "sent", direction: "out", sentByUserId: seller.userId });
    const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, c?.id ?? "") });
    expect(conv?.assignedUserId).toBe(seller.userId);

    // eco do envio e confirmações
    await hook("send.message", {
      key: { id: msg?.externalId, remoteJid: "5548999990005@s.whatsapp.net", fromMe: true },
      message: { conversation: "Claro! Qual valor de entrada?" },
    });
    await hook("messages.update", { keyId: msg?.externalId, status: "READ" });
    await hook("messages.update", { keyId: msg?.externalId, status: "DELIVERY_ACK" });
    const msgs = await listMessages(db, seller, org.id, c?.id ?? "");
    expect(msgs).toHaveLength(2);
    expect(msgs[1]?.status).toBe("read");
  });

  it("falha de envio fica marcada e dá para tentar de novo", async () => {
    const { org, admin, hook } = await setup();
    await hook("messages.upsert", incoming("F1", "5548999990006", "oi"));
    const [c] = await listConversations(db, admin, org.id);
    fake.failSends = true;
    const id = await sendMessage(db, evo, admin, org.id, c?.id ?? "", { text: "teste" });
    expect((await db.query.messages.findFirst({ where: eq(messages.id, id) }))?.status).toBe("failed");
    fake.failSends = false;
    await retryMessage(db, evo, admin, org.id, id);
    expect((await db.query.messages.findFirst({ where: eq(messages.id, id) }))?.status).toBe("sent");
  });

  it("envia arquivo como imagem ou documento", async () => {
    const { org, admin, hook } = await setup();
    await hook("messages.upsert", incoming("A1", "5548999990007", "manda a foto"));
    const [c] = await listConversations(db, admin, org.id);
    await sendMessage(db, evo, admin, org.id, c?.id ?? "", {
      text: "Segue",
      file: { name: "carro.jpg", mime: "image/jpeg", data: Buffer.from("fakejpg") },
    });
    expect(fake.sent.at(-1)?.body).toMatchObject({
      mediatype: "image",
      caption: "Segue",
      fileName: "carro.jpg",
    });
    await sendMessage(db, evo, admin, org.id, c?.id ?? "", {
      file: { name: "proposta.pdf", mime: "application/pdf", data: Buffer.from("%PDF") },
    });
    expect(fake.sent.at(-1)?.body).toMatchObject({ mediatype: "document" });
    await sendMessage(db, evo, admin, org.id, c?.id ?? "", {
      file: { name: "audio.ogg", mime: "audio/ogg", data: Buffer.from("OggS") },
    });
    expect(fake.sent.at(-1)?.kind).toBe("sendWhatsAppAudio");
  });

  it("não envia por conexão desconectada", async () => {
    const { org, admin, conn, hook } = await setup();
    await hook("messages.upsert", incoming("X1", "5548999990008", "oi"));
    const [c] = await listConversations(db, admin, org.id);
    await db.update(whatsappConnections).set({ status: "close" }).where(eq(whatsappConnections.id, conn.id));
    await expect(sendMessage(db, evo, admin, org.id, c?.id ?? "", { text: "oi" })).rejects.toThrow(
      /desconectado/,
    );
  });

  it("inicia conversa nova conferindo se o número tem WhatsApp", async () => {
    const { org, admin, conn } = await setup();
    const id = await startConversation(db, evo, admin, org.id, {
      connectionId: conn.id,
      phone: "(48) 99674-3297",
    });
    const c = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, c?.contactId ?? "") });
    expect(contact?.phone).toBe("5548996743297");
    expect(c?.assignedUserId).toBe(admin.userId);
    // mesma pessoa de novo: mesma conversa
    expect(
      await startConversation(db, evo, admin, org.id, { connectionId: conn.id, phone: "48996743297" }),
    ).toBe(id);
    fake.withoutWhatsapp.add("5548911112222");
    await expect(
      startConversation(db, evo, admin, org.id, { connectionId: conn.id, phone: "48 91111-2222" }),
    ).rejects.toThrow(/não tem WhatsApp/);
  });
});

describe("quem vê o quê", () => {
  it("vendedor vê as dele e as sem dono; admin e gestor veem todas", async () => {
    const { org, admin, mk, hook } = await setup();
    const s1 = await mk("s1@loja.com", "seller");
    const s2 = await mk("s2@loja.com", "agent");
    const manager = await mk("g@loja.com", "manager");
    await hook("messages.upsert", incoming("V1", "5548911110001", "a"));
    await hook("messages.upsert", incoming("V2", "5548911110002", "b"));
    await hook("messages.upsert", incoming("V3", "5548911110003", "c"));
    const all = await listConversations(db, admin, org.id);
    const byPhone = (p: string) => all.find((c) => c.contactPhone === p)?.id ?? "";
    await assignConversation(db, s1, org.id, byPhone("5548911110001"), s1.userId);
    await assignConversation(db, manager, org.id, byPhone("5548911110002"), s2.userId);

    expect((await listConversations(db, s1, org.id)).map((c) => c.contactPhone).sort()).toEqual([
      "5548911110001",
      "5548911110003",
    ]);
    expect((await listConversations(db, s2, org.id)).map((c) => c.contactPhone).sort()).toEqual([
      "5548911110002",
      "5548911110003",
    ]);
    expect(await listConversations(db, manager, org.id)).toHaveLength(3);
    expect((await listConversations(db, s1, org.id, { filter: "mine" })).map((c) => c.contactPhone)).toEqual([
      "5548911110001",
    ]);

    // vendedor não abre nem puxa conversa de outro, nem passa para outra pessoa
    await expect(listMessages(db, s1, org.id, byPhone("5548911110002"))).rejects.toThrow(/não encontrada/);
    await expect(assignConversation(db, s1, org.id, byPhone("5548911110003"), s2.userId)).rejects.toThrow(
      /só pode puxar/,
    );
    await expect(sendMessage(db, evo, s1, org.id, byPhone("5548911110002"), { text: "oi" })).rejects.toThrow(
      /não encontrada/,
    );
  });

  it("empresa não enxerga conversas de outra", async () => {
    const { org, admin, masterActor, hook } = await setup();
    await hook("messages.upsert", incoming("O1", "5548911110009", "oi"));
    const [c] = await listConversations(db, admin, org.id);
    const other = await createOrganization(db, masterActor, {
      name: "Outra",
      adminEmail: "o@o.com",
      adminName: "Outro Admin",
    });
    expect(await listConversations(db, masterActor, other.organization.id)).toHaveLength(0);
    await expect(listMessages(db, masterActor, other.organization.id, c?.id ?? "")).rejects.toThrow(
      /não encontrada/,
    );
  });
});
