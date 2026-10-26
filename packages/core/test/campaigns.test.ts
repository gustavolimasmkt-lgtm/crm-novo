import {
  campaignRecipients,
  contacts,
  conversations,
  messages,
  notificationOutbox,
  scheduledMessages,
  whatsappConnections,
} from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  cancelScheduled,
  createAnthropicClient,
  createCampaign,
  createConnection,
  createContact,
  createEvolutionClient,
  createOrganization,
  deleteMessage,
  editMessage,
  handleEvolutionWebhook,
  listCampaigns,
  listConversations,
  listMessages,
  listScheduled,
  OPT_OUT_FOOTER,
  previewAudience,
  processAiJobs,
  processCampaigns,
  processScheduled,
  refreshConnection,
  saveAgent,
  saveFollowupSettings,
  saveRotation,
  scheduleMessage,
  sendMessage,
  setCampaignStatus,
  setMyPhone,
  summarizeConversation,
} from "../src/index.js";
import { type FakeAnthropic, startFakeAnthropic } from "../src/testing/fake-anthropic.js";
import { type FakeEvolution, startFakeEvolution } from "../src/testing/fake-evolution.js";
import { createMaster, db, resetDb } from "./helpers.js";

let fake: FakeEvolution;
let fakeAi: FakeAnthropic;
let evo: ReturnType<typeof createEvolutionClient>;
let ai: ReturnType<typeof createAnthropicClient>;
beforeAll(async () => {
  fake = await startFakeEvolution();
  fakeAi = await startFakeAnthropic();
  evo = createEvolutionClient({ baseUrl: fake.url, apiKey: fake.apiKey });
  ai = createAnthropicClient({ apiKey: "teste", baseUrl: fakeAi.url });
});
afterAll(async () => {
  await fake.close();
  await fakeAi.close();
});
beforeEach(async () => {
  await resetDb();
  fake.sent.length = 0;
  fakeAi.requests.length = 0;
});

const ALWAYS = {
  windowStart: "00:00",
  windowEnd: "23:59",
  sundays: true,
  gapMinSeconds: 30,
  gapMaxSeconds: 30,
  dailyLimit: 100,
};

async function setup() {
  const master = await createMaster();
  const { organization: org, invite } = await createOrganization(
    db,
    { isMaster: true, role: null, userId: master.id },
    { name: "Loja", adminEmail: "admin@loja.com", adminName: "Admin" },
  );
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
  const instance = row?.instanceName ?? "";
  await fake.scan(instance);
  await refreshConnection(db, evo, admin, org.id, conn.id);
  const token = new URL(fake.instances.get(instance)?.webhook ?? "").searchParams.get("t") ?? "";
  let n = 0;
  const hook = (data: Record<string, unknown>) =>
    handleEvolutionWebhook(db, conn.id, token, { event: "messages.upsert", instance, data });
  const say = (text: string, from = "5548999990001", extra: Record<string, unknown> = {}) =>
    hook({
      key: { id: `C${++n}-${Date.now()}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
      pushName: "Joana Silva",
      message: { conversation: text, ...extra },
    });
  const free = () => db.update(whatsappConnections).set({ nextAutomatedAt: null });
  return { org, admin, connId: conn.id, instance, hook, say, free };
}

describe("responder, editar e apagar", () => {
  it("responde citando, edita até 15 min, apaga para todos e recebe edição/apagado do cliente", async () => {
    const { org, admin, hook, say } = await setup();
    await say("tem hrv?");
    const [c] = await listConversations(db, admin, org.id);
    const convId = c?.id ?? "";
    const [inMsg] = await listMessages(db, admin, org.id, convId);
    const id = await sendMessage(db, evo, admin, org.id, convId, { text: "Temos sim!", replyTo: inMsg?.id });
    expect(fake.sent.at(-1)?.body).toMatchObject({
      text: "Temos sim!",
      quoted: { key: { id: expect.any(String) }, message: { conversation: "tem hrv?" } },
    });
    let msgs = await listMessages(db, admin, org.id, convId);
    const mine = msgs.find((m) => m.id === id);
    expect(mine).toMatchObject({
      quoted: { body: "tem hrv?", fromMe: false },
      canEdit: true,
      canDelete: true,
    });
    expect(msgs[0]?.canEdit).toBe(false); // mensagem do cliente

    await editMessage(db, evo, admin, org.id, id, "Temos sim, prata 2020!");
    expect(fake.sent.at(-1)).toMatchObject({
      kind: "updateMessage",
      body: { text: "Temos sim, prata 2020!" },
    });
    await deleteMessage(db, evo, admin, org.id, id);
    expect(fake.sent.at(-1)).toMatchObject({ kind: "deleteMessageForEveryone", body: { fromMe: true } });
    msgs = await listMessages(db, admin, org.id, convId);
    expect(msgs.find((m) => m.id === id)).toMatchObject({
      deletedAt: expect.any(Date),
      body: "Temos sim, prata 2020!",
      canDelete: false,
    });

    // Mensagem antiga: não edita mais.
    const id2 = await sendMessage(db, evo, admin, org.id, convId, { text: "Oi" });
    await db
      .update(messages)
      .set({ sentAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(messages.id, id2));
    await expect(editMessage(db, evo, admin, org.id, id2, "Olá")).rejects.toThrow(/15 minutos/);

    // Cliente responde citando, edita e apaga.
    const ext = (await db.query.messages.findFirst({ where: eq(messages.id, id2) }))?.externalId;
    await say("qual o preço?", "5548999990001", {});
    await hook({
      key: { id: "CQ1", remoteJid: "5548999990001@s.whatsapp.net", fromMe: false },
      message: { extendedTextMessage: { text: "e esse?", contextInfo: { stanzaId: ext } } },
    });
    msgs = await listMessages(db, admin, org.id, convId);
    expect(msgs.at(-1)).toMatchObject({ body: "e esse?", quoted: { body: "Oi", fromMe: true } });
    await hook({
      key: { id: "CQ2", remoteJid: "5548999990001@s.whatsapp.net", fromMe: false },
      message: {
        protocolMessage: { key: { id: "CQ1" }, type: 14, editedMessage: { conversation: "e esse aqui?" } },
      },
    });
    await hook({
      key: { id: "CQ3", remoteJid: "5548999990001@s.whatsapp.net", fromMe: false },
      message: { protocolMessage: { key: { id: "CQ1" }, type: "REVOKE" } },
    });
    const cq1 = await db.query.messages.findFirst({ where: eq(messages.externalId, "CQ1") });
    expect(cq1).toMatchObject({
      body: "e esse aqui?",
      editedAt: expect.any(Date),
      deletedAt: expect.any(Date),
    });
    expect(await db.select().from(messages).where(eq(messages.externalId, "CQ2"))).toHaveLength(0);
  });
});

describe("mensagens agendadas", () => {
  it("agenda, lista, cancela e envia na hora em nome de quem agendou", async () => {
    const { org, admin, say } = await setup();
    await say("oi");
    const [c] = await listConversations(db, admin, org.id);
    await expect(
      scheduleMessage(db, admin, org.id, c?.id ?? "", { text: "x", sendAt: new Date() }),
    ).rejects.toThrow(/1 minuto/);
    const id1 = await scheduleMessage(db, admin, org.id, c?.id ?? "", {
      text: "Bom dia! Conseguiu ver o carro?",
      sendAt: new Date(Date.now() + 3600_000),
    });
    const id2 = await scheduleMessage(db, admin, org.id, c?.id ?? "", {
      text: "Cancelada",
      sendAt: new Date(Date.now() + 7200_000),
    });
    expect((await listScheduled(db, admin, org.id, c?.id ?? "")).map((s) => s.body)).toEqual([
      "Bom dia! Conseguiu ver o carro?",
      "Cancelada",
    ]);
    await cancelScheduled(db, admin, org.id, id2 ?? "");
    expect(await processScheduled(db, evo)).toBe(0);
    await db
      .update(scheduledMessages)
      .set({ sendAt: new Date(Date.now() - 1000) })
      .where(eq(scheduledMessages.id, id1 ?? ""));
    expect(await processScheduled(db, evo)).toBe(1);
    expect(fake.sent.at(-1)?.body).toMatchObject({ text: "Bom dia! Conseguiu ver o carro?" });
    const m = await db.query.messages.findFirst({
      where: eq(messages.body, "Bom dia! Conseguiu ver o carro?"),
    });
    expect(m?.sentByUserId).toBe(admin.userId);
    expect(await listScheduled(db, admin, org.id, c?.id ?? "")).toEqual([]);
  });
});

describe("campanhas", () => {
  it("público filtrado, um por vez, {nome}, SAIR tira da lista e não pausa a IA", async () => {
    const { org, admin, connId, say, free } = await setup();
    await saveFollowupSettings(db, admin, org.id, { enabled: false, steps: [], ...ALWAYS });
    await setMyPhone(db, admin.userId, "48988887777");
    await say("oi", "5548999990001"); // Joana, com conversa
    await createContact(db, admin, org.id, { name: "Pedro Souza", phone: "48 99777-1234" });
    await createContact(db, admin, org.id, { name: "Equipe", phone: "48 98888-7777" }); // número da equipe: fora
    await createContact(db, admin, org.id, { name: "Sem Zap", phone: "48 99666-0000" });
    fake.withoutWhatsapp.add("5548996660000");

    const pv = await previewAudience(db, admin, org.id, { stageIds: [], tagIds: [], lastContactDays: null });
    expect(pv.count).toBe(3);
    const quiet = await previewAudience(db, admin, org.id, { stageIds: [], tagIds: [], lastContactDays: 7 });
    expect(quiet.count).toBe(2); // Joana falou agora

    const id = await createCampaign(db, admin, org.id, {
      name: "Feirão",
      connectionId: connId,
      body: "Oi {nome}! Feirão neste sábado com taxa zero.",
      optOutFooter: true,
      filter: { stageIds: [], tagIds: [], lastContactDays: null },
      startAt: null,
    });
    fake.sent.length = 0;
    await free();
    const results: string[] = [];
    const r1 = await processCampaigns(db, evo);
    results.push(...r1.map((x) => x.result));
    const waited = await processCampaigns(db, evo); // espera a vez no número
    for (let i = 0; i < 2; i++) {
      await free();
      results.push(...(await processCampaigns(db, evo)).map((x) => x.result));
    }
    expect(results.filter((r) => r !== "sem-whatsapp")).toEqual(["enviado", "enviado"]);
    expect(results.filter((r) => r === "sem-whatsapp")).toHaveLength(1);
    expect(waited.filter((r) => r.result === "enviado")).toHaveLength(0);
    await free();
    expect((await processCampaigns(db, evo)).map((x) => x.result)).toEqual(["concluida"]);
    const texts = fake.sent
      .filter((s) => s.kind === "sendText")
      .map((s) => (s.body as { text: string }).text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain(`Oi Joana! Feirão neste sábado com taxa zero.\n\n${OPT_OUT_FOOTER}`);
    expect(texts.some((t) => t.startsWith("Oi Pedro!"))).toBe(true);
    const [camp] = await listCampaigns(db, admin, org.id);
    expect(camp).toMatchObject({ id, status: "done", total: 3, sent: 2, skipped: 1 });
    const msgs = await db.select().from(messages).where(eq(messages.automation, "campaign"));
    expect(msgs.every((m) => !m.sentByAi && m.sentByUserId === admin.userId)).toBe(true);

    // Joana responde SAIR: sai da lista e ganha nota interna.
    await say("SAIR", "5548999990001");
    const joana = await db.query.contacts.findFirst({ where: eq(contacts.phone, "5548999990001") });
    expect(joana?.optOut).toBe(true);
    const note = await db.query.messages.findFirst({ where: eq(messages.internal, true) });
    expect(note?.body).toContain("pediu para sair");
    expect(
      (await previewAudience(db, admin, org.id, { stageIds: [], tagIds: [], lastContactDays: null })).count,
    ).toBe(2); // Pedro e o sem WhatsApp

    // Pausar/cancelar
    const id2 = await createCampaign(db, admin, org.id, {
      name: "Outra",
      connectionId: connId,
      body: "Novidade no estoque!",
      filter: { stageIds: [], tagIds: [], lastContactDays: null },
    });
    await setCampaignStatus(db, admin, org.id, id2, "paused");
    await free();
    expect(await processCampaigns(db, evo)).toEqual([]);
    await setCampaignStatus(db, admin, org.id, id2, "canceled");
    const rs = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id2));
    expect(rs.every((x) => x.status === "skipped")).toBe(true);
    await expect(setCampaignStatus(db, admin, org.id, id2, "running")).rejects.toThrow(/terminou/);
    void notificationOutbox;
  });

  it("quem responde ao disparo é atendido pela IA (o disparo não conta como vendedor)", async () => {
    const { org, admin, connId, say, free } = await setup();
    await saveFollowupSettings(db, admin, org.id, { enabled: false, steps: [], ...ALWAYS });
    await createContact(db, admin, org.id, { name: "Pedro Souza", phone: "48 99777-1234" });
    await createCampaign(db, admin, org.id, {
      name: "Feirão",
      connectionId: connId,
      body: "Oi {nome}! Feirão sábado.",
      filter: { stageIds: [], tagIds: [], lastContactDays: null },
    });
    await free();
    await processCampaigns(db, evo);
    await saveAgent(db, admin, org.id, {
      name: "Assistente",
      active: true,
      instructions: "Você é o assistente da Loja. Vendemos carros seminovos.",
      replyDelaySeconds: 0,
    });
    await say("quero saber mais", "5548997771234");
    expect((await processAiJobs(db, { evo, ai })).map((r) => r.result)).toEqual(["respondida"]);
    void conversations;
  });

  it("só gestor dispara", async () => {
    const { org, connId } = await setup();
    const seller = {
      isMaster: false,
      role: "seller" as const,
      userId: "00000000-0000-0000-0000-000000000000",
    };
    await expect(
      previewAudience(db, seller, org.id, { stageIds: [], tagIds: [], lastContactDays: null }),
    ).rejects.toThrow(/gestores/);
    void connId;
  });
});

describe("resumo do lead", () => {
  it("resume a conversa, guarda e vai junto no aviso de transferência", async () => {
    const { org, admin, say } = await setup();
    await setMyPhone(db, admin.userId, "48988887777");
    await saveRotation(db, admin, org.id, { enabled: true, notify: true, userIds: [admin.userId] });
    await saveAgent(db, admin, org.id, {
      name: "Assistente",
      active: true,
      instructions: "Você é o assistente da Loja. Vendemos carros seminovos.",
      replyDelaySeconds: 0,
    });
    await say("tem hrv?");
    await processAiJobs(db, { evo, ai });
    const [c] = await listConversations(db, admin, org.id);
    const s = await summarizeConversation(db, ai, org.id, c?.id ?? "", admin);
    expect(s).toMatchObject({ interesse: "Honda HR-V", temperatura: "morno", nota: 5 });
    const req = fakeAi.requests.at(-1) as { model: string; messages: { content: string }[] };
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.messages[0]?.content).toContain("Cliente: tem hrv?");
    expect(req.messages[0]?.content).toContain("Loja (IA): Resposta automática: tem hrv?");

    // Conversa sem dono: o rodízio puxa a pessoa e o aviso leva o resumo.
    await db.update(conversations).set({ assignedUserId: null });
    await say("quero falar com um vendedor");
    await processAiJobs(db, { evo, ai });
    const avisos = await db.select().from(notificationOutbox);
    const aviso = avisos.find((a) => a.body.includes("ATENDIMENTO HUMANO"));
    expect(aviso?.body).toContain("Resumo: Cliente conversou sobre carros. Pediu um vendedor.");
    expect(aviso?.body).toContain("Temperatura: quente (nota 8/10)");
    expect(aviso?.body).toContain("Próximo passo: Ligar hoje e oferecer visita");
    const [c2] = await db.select().from(conversations);
    expect(c2?.aiSummary?.temperatura).toBe("quente");
  });
});
