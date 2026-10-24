import {
  appointments,
  conversations,
  deals,
  messageMedia,
  messages,
  notificationOutbox,
  pipelineStages,
  users,
  whatsappConnections,
} from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  addProductPhotos,
  bookByAi,
  brParts,
  createAnthropicClient,
  createConnection,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  freeSlots,
  handleEvolutionWebhook,
  importCatalog,
  listAppointments,
  pickNextAssignee,
  processAiJobs,
  processOutbox,
  refreshConnection,
  saveAgent,
  saveProduct,
  saveRotation,
  saveScheduleSettings,
  searchCatalog,
  setMyPhone,
  simulateAgent,
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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Próxima segunda-feira com pelo menos 2 dias de folga (horário de Brasília). */
function nextMonday() {
  let d = new Date(Date.now() + 2 * 86_400_000);
  while (brParts(d).weekday !== 1) d = new Date(d.getTime() + 86_400_000);
  return brParts(d).date;
}

async function setup() {
  const master = await createMaster();
  const masterActor = { isMaster: true, role: null, userId: master.id };
  const { organization: org, invite } = await createOrganization(db, masterActor, {
    name: "Loja",
    adminEmail: "admin@loja.com",
    adminName: "Admin",
  });
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const sellers: { userId: string }[] = [];
  for (const name of ["Ana", "Bruno"]) {
    const inv = await createInvitation(db, admin, org.id, {
      email: `${name.toLowerCase()}@loja.com`,
      name,
      role: "seller",
    });
    sellers.push(await acceptInvitation(db, { token: inv.token, name, password: "vende1234" }));
  }
  const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
  const instance = row?.instanceName ?? "";
  await fake.scan(instance);
  await refreshConnection(db, evo, admin, org.id, conn.id);
  const token = new URL(fake.instances.get(instance)?.webhook ?? "").searchParams.get("t") ?? "";
  let n = 0;
  const say = (text: string, from = "5548999990001") =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id: `M${++n}-${Date.now()}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
        pushName: "Joana",
        message: { conversation: text },
      },
    });
  const agentOn = () =>
    saveAgent(db, admin, org.id, {
      name: "Assistente",
      active: true,
      instructions: "Você é o assistente da Loja. Vendemos carros seminovos.",
      replyDelaySeconds: 0,
    });
  return { org, admin, sellers, conn, say, agentOn, deps: { evo, ai } };
}

describe("catálogo", () => {
  it("busca tolerante, importa do sistema antigo e só gestor edita", async () => {
    const { org, admin, sellers } = await setup();
    await saveProduct(db, admin, org.id, null, {
      title: "Honda HR-V EXL 2020",
      description: "Prata, 45 mil km, automático",
      price: "119.900,00",
    });
    await saveProduct(db, admin, org.id, null, { title: "Fiat Mobi Like 2022", price: "52900" });
    expect((await searchCatalog(db, org.id, "hrv"))[0]?.title).toBe("Honda HR-V EXL 2020");
    expect((await searchCatalog(db, org.id, "HR-V prata"))[0]?.priceCents).toBe(11_990_000);
    expect((await searchCatalog(db, org.id, "automatico"))[0]?.title).toContain("HR-V");
    expect(await searchCatalog(db, org.id, "corolla")).toEqual([]);

    const legacy = JSON.stringify({
      catalogo: [
        { titulo: "Fiat Mobi Like 2022", descricao: "Branco", valor: "51.900,00" },
        { titulo: "Jeep Renegade 2019", descricao: "Diesel", valor: "Consulte" },
      ],
    });
    expect(await importCatalog(db, admin, org.id, legacy)).toEqual({ created: 1, updated: 1 });
    const csv = "titulo;descricao;valor\nToyota Yaris 2021;Hatch;79.990,00\n";
    expect(await importCatalog(db, admin, org.id, csv)).toEqual({ created: 1, updated: 0 });
    const mobi = (await searchCatalog(db, org.id, "mobi"))[0];
    expect(mobi).toMatchObject({ priceCents: 5_190_000, description: "Branco" });

    const seller = { isMaster: false, role: "seller" as const, userId: sellers[0]?.userId ?? "" };
    await expect(saveProduct(db, seller, org.id, null, { title: "X" })).rejects.toThrow(/administradores/);
  });

  it("o agente busca no catálogo e manda as fotos do item", async () => {
    const { org, admin, say, agentOn, deps } = await setup();
    const id = await saveProduct(db, admin, org.id, null, {
      title: "Honda HR-V EXL 2020",
      price: "119.900,00",
    });
    await addProductPhotos(db, admin, org.id, id, [
      { name: "frente.png", mime: "image/png", data: PNG },
      { name: "lado.png", mime: "image/png", data: PNG },
    ]);
    expect((await searchCatalog(db, org.id, "hrv"))[0]?.photoIds).toHaveLength(2);
    await agentOn();
    await say("tem hrv? manda foto");
    const r = await processAiJobs(db, deps);
    expect(r.map((x) => x.result)).toEqual(["respondida"]);
    const req = fakeAi.requests[0] as { tools: { name: string }[]; system: string };
    expect(req.tools.map((t) => t.name)).toContain("buscar_catalogo");
    expect(req.tools.map((t) => t.name)).not.toContain("marcar_visita");
    expect(req.system).toContain("use buscar_catalogo");
    expect(fake.sent.map((s) => s.kind)).toEqual(["sendText", "sendMedia", "sendMedia"]);
    expect(fake.sent[0]?.body).toMatchObject({ text: expect.stringContaining("2 foto(s) de Honda HR-V") });
    expect(fake.sent[1]?.body).toMatchObject({ mediatype: "image", mimetype: "image/png" });
    const imgs = await db.select().from(messages).where(eq(messages.type, "image"));
    expect(imgs).toHaveLength(2);
    expect(imgs.every((m) => m.sentByAi && m.status === "sent")).toBe(true);
    expect(await db.select().from(messageMedia)).toHaveLength(2);
  });

  it("o agente não inventa id de produto", async () => {
    const { org, admin } = await setup();
    await saveProduct(db, admin, org.id, null, { title: "Fiat Mobi 2022" });
    const s = await simulateAgent(db, ai, admin, org.id, {
      messages: [{ role: "user", content: "tem mobi? manda foto" }],
      instructions: "Você é o assistente da Loja. Vendemos carros.",
    });
    // Sem fotos cadastradas: a ferramenta recusa e nada é enviado.
    expect(s.photos).toBe(0);
    expect(s.text).toContain("não tem fotos");
  });
});

describe("agenda", () => {
  it("horários livres respeitam expediente e lotação; a IA marca e move a negociação", async () => {
    const { org, admin, sellers, say, agentOn, deps } = await setup();
    const day = nextMonday();
    expect(await freeSlots(db, org.id, day)).toHaveLength(20); // 08:00 às 18:00, 30 min
    await saveScheduleSettings(db, admin, org.id, {
      aiCanBook: true,
      durationMinutes: 60,
      perSlot: 1,
      hours: { "1": ["09:00", "12:00"], "0": null, "6": null },
    });
    expect(await freeSlots(db, org.id, day)).toEqual(["09:00", "10:00", "11:00"]);

    // Responsável com telefone recebe o aviso da visita.
    const ana = sellers[0]?.userId ?? "";
    await setMyPhone(db, ana, "(48) 98888-0001");
    await agentOn();
    await say("oi");
    const [conv] = await db.select().from(conversations);
    await db
      .update(conversations)
      .set({ assignedUserId: ana })
      .where(eq(conversations.id, conv?.id ?? ""));
    await processAiJobs(db, deps);
    fake.sent.length = 0;

    await say(`pode marcar visita ${day} 10:00`);
    await processAiJobs(db, deps);
    const [ap] = await db.select().from(appointments);
    expect(ap).toMatchObject({ createdByAi: true, status: "scheduled", assignedUserId: ana });
    expect(brParts(ap?.startsAt ?? new Date()).time).toBe("10:00");
    expect(fake.sent.at(-1)?.body).toMatchObject({
      text: expect.stringContaining("Visita marcada para segunda"),
    });
    const [deal] = await db.select().from(deals);
    const stage = await db.query.pipelineStages.findFirst({
      where: eq(pipelineStages.id, deal?.stageId ?? ""),
    });
    expect(stage?.kind).toBe("scheduled");
    const listed = await listAppointments(db, admin, org.id, {
      from: new Date(Date.now()),
      to: new Date(Date.now() + 30 * 86_400_000),
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ conversationId: conv?.id, contactName: "Joana", createdByAi: true });
    const sellerView = await listAppointments(
      db,
      { isMaster: false, role: "seller", userId: sellers[1]?.userId ?? "" },
      org.id,
      { from: new Date(), to: new Date(Date.now() + 30 * 86_400_000) },
    );
    expect(sellerView).toHaveLength(0); // é da Ana
    const [aviso] = await db.select().from(notificationOutbox);
    expect(aviso?.toPhone).toBe("5548988880001");
    expect(aviso?.body).toContain("VISITA MARCADA PELA IA");

    // Mesmo horário de novo: lotado, e a IA recebe os livres.
    const again = await bookByAi(db, org.id, conv?.id ?? "", `${day} 10:00`, "");
    expect(again).toMatchObject({ ok: false });
    expect(again.text).toContain("lotado");
    expect(again.text).toContain("09:00, 11:00");
    expect((await bookByAi(db, org.id, conv?.id ?? "", `${day} 13:00`, "")).text).toContain(
      "das 09:00 às 12:00",
    );
  });

  it("sem liberar a agenda, a IA não recebe as ferramentas", async () => {
    const { org, say, agentOn, deps } = await setup();
    await agentOn();
    await say(`marcar visita ${nextMonday()} 10:00`);
    await processAiJobs(db, deps);
    const req = fakeAi.requests[0] as { tools: { name: string }[] };
    expect(req.tools.map((t) => t.name)).not.toContain("marcar_visita");
    expect(await db.select().from(appointments)).toHaveLength(0);
    expect((await bookByAi(db, org.id, "x", "2030-01-01 10:00", "")).ok).toBe(false);
  });
});

describe("rodízio e avisos", () => {
  it("distribui leads novos em ordem, avisa por WhatsApp e respeita quem já tem responsável", async () => {
    const { org, admin, sellers, say } = await setup();
    const [ana, bruno] = sellers.map((s) => s.userId);
    await setMyPhone(db, ana ?? "", "48988880001");
    await saveRotation(db, admin, org.id, { enabled: true, notify: true, userIds: [ana ?? "", bruno ?? ""] });
    await say("oi", "5548999990001");
    await say("bom dia", "5548999990002");
    await say("olá", "5548999990003");
    await say("de novo", "5548999990001"); // mesmo cliente: não gira
    const convs = await db.select().from(conversations).orderBy(conversations.createdAt);
    expect(convs.map((c) => c.assignedUserId)).toEqual([ana, bruno, ana]);
    const ds = await db.select().from(deals).orderBy(deals.number);
    expect(ds.map((d) => d.assignedUserId)).toEqual([ana, bruno, ana]);
    // Bruno não tem telefone: só a Ana recebe (2 leads).
    const out = await db.select().from(notificationOutbox);
    expect(out).toHaveLength(2);
    expect(out[0]?.body).toContain("NOVO LEAD PARA VOCÊ");
    expect(out[0]?.body).toContain("5548999990001");

    fake.sent.length = 0;
    expect(await processOutbox(db, evo)).toEqual({ found: 2, sent: 2 });
    expect(fake.sent.map((s) => s.to)).toEqual(["5548988880001", "5548988880001"]);
    expect(await processOutbox(db, evo)).toEqual({ found: 0, sent: 0 });

    // Quem sai da equipe sai do rodízio.
    await db
      .update(users)
      .set({ phone: null })
      .where(eq(users.id, ana ?? ""));
    await saveRotation(db, admin, org.id, { enabled: false, notify: true, userIds: [] });
    expect(await pickNextAssignee(db, org.id)).toBeNull();
    await expect(
      saveRotation(db, admin, org.id, { enabled: true, notify: true, userIds: ["lixo"] }),
    ).rejects.toThrow(/pelo menos uma/);
  });

  it("quando a IA transfere, avisa o responsável (ou puxa o próximo do rodízio)", async () => {
    process.env.APP_URL = "https://crm.exemplo.com";
    const { org, admin, sellers, say, agentOn, deps } = await setup();
    const [ana, bruno] = sellers.map((s) => s.userId);
    await setMyPhone(db, bruno ?? "", "48988880002");
    await agentOn();
    await say("oi");
    await processAiJobs(db, deps);
    // Rodízio ligado depois do lead entrar: conversa ainda sem dono.
    await saveRotation(db, admin, org.id, { enabled: true, notify: true, userIds: [bruno ?? "", ana ?? ""] });
    await say("quero falar com um vendedor");
    expect((await processAiJobs(db, deps)).map((x) => x.result)).toEqual(["transferida"]);
    const [conv] = await db.select().from(conversations);
    expect(conv?.assignedUserId).toBe(bruno);
    const [deal] = await db.select().from(deals);
    expect(deal?.assignedUserId).toBe(bruno);
    const [aviso] = await db.select().from(notificationOutbox);
    expect(aviso?.body).toContain("ATENDIMENTO HUMANO NECESSÁRIO");
    expect(aviso?.body).toContain("Motivo: Cliente pediu um vendedor");
    expect(aviso?.body).toContain(`/conversas?c=${conv?.id}`);
  });
});
