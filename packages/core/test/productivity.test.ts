import { conversations, messages, notificationOutbox, tasks, whatsappConnections } from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  addNote,
  countOverdueTasks,
  createAnthropicClient,
  createConnection,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  createTask,
  createTranscriber,
  deleteQuickReply,
  fillQuickReply,
  handleEvolutionWebhook,
  listConversations,
  listMessages,
  listQuickReplies,
  listTasks,
  processAiJobs,
  processFollowups,
  processTaskAlerts,
  refreshConnection,
  reserveAutomatedSend,
  saveAgent,
  saveFollowupSettings,
  saveQuickReply,
  setMyPhone,
  setTaskDone,
  transcribeMessage,
} from "../src/index.js";
import { type FakeAnthropic, startFakeAnthropic } from "../src/testing/fake-anthropic.js";
import { type FakeEvolution, startFakeEvolution } from "../src/testing/fake-evolution.js";
import { createMaster, db, resetDb } from "./helpers.js";

let fake: FakeEvolution;
let fakeAi: FakeAnthropic;
let evo: ReturnType<typeof createEvolutionClient>;
let ai: ReturnType<typeof createAnthropicClient>;
let stt: ReturnType<typeof createTranscriber>;
beforeAll(async () => {
  fake = await startFakeEvolution();
  fakeAi = await startFakeAnthropic();
  evo = createEvolutionClient({ baseUrl: fake.url, apiKey: fake.apiKey });
  ai = createAnthropicClient({ apiKey: "teste", baseUrl: fakeAi.url });
  stt = createTranscriber({ apiKey: "teste", baseUrl: `${fakeAi.url}/v1` });
});
afterAll(async () => {
  await fake.close();
  await fakeAi.close();
});
beforeEach(async () => {
  await resetDb();
  fake.sent.length = 0;
  fakeAi.requests.length = 0;
  fakeAi.transcriptions = 0;
});

const H = 3600_000;

async function setup() {
  const master = await createMaster();
  const { organization: org, invite } = await createOrganization(
    db,
    { isMaster: true, role: null, userId: master.id },
    { name: "Loja", adminEmail: "admin@loja.com", adminName: "Admin" },
  );
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const inv = await createInvitation(db, admin, org.id, {
    email: "ana@loja.com",
    name: "Ana",
    role: "seller",
  });
  const ana = (await acceptInvitation(db, { token: inv.token, name: "Ana", password: "vende1234" })).userId;
  const seller = { isMaster: false, role: "seller" as const, userId: ana };
  const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
  const instance = row?.instanceName ?? "";
  await fake.scan(instance);
  await refreshConnection(db, evo, admin, org.id, conn.id);
  const token = new URL(fake.instances.get(instance)?.webhook ?? "").searchParams.get("t") ?? "";
  let n = 0;
  const incoming = (message: Record<string, unknown>, from = "5548999990001") =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id: `P${++n}-${Date.now()}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
        pushName: "Joana Silva",
        message,
      },
    });
  const say = (text: string, from?: string) => incoming({ conversation: text }, from);
  const agentOn = () =>
    saveAgent(db, admin, org.id, {
      name: "Assistente",
      active: true,
      instructions: "Você é o assistente da Loja. Vendemos carros seminovos.",
      replyDelaySeconds: 0,
    });
  return { org, admin, seller, ana, connId: conn.id, incoming, say, agentOn };
}

describe("notas internas", () => {
  it("aparecem na conversa, não mudam a prévia, não vão para a IA e não pausam a IA", async () => {
    const { org, admin, say, agentOn } = await setup();
    await agentOn();
    await say("oi");
    const [c] = await listConversations(db, admin, org.id);
    await addNote(db, admin, org.id, c?.id ?? "", "Cliente quer financiar, ligar à tarde");
    const msgs = await listMessages(db, admin, org.id, c?.id ?? "");
    expect(msgs.find((m) => m.internal)).toMatchObject({
      body: "Cliente quer financiar, ligar à tarde",
      sentByName: "Admin",
    });
    const [c2] = await listConversations(db, admin, org.id);
    expect(c2?.lastMessagePreview).toBe("oi");
    expect(fake.sent).toHaveLength(0);
    expect((await processAiJobs(db, { evo, ai })).map((r) => r.result)).toEqual(["respondida"]);
    const req = fakeAi.requests.at(-1) as { messages: { content: string }[] };
    expect(JSON.stringify(req.messages)).not.toContain("financiar");
    await expect(addNote(db, admin, org.id, c?.id ?? "", "  ")).rejects.toThrow(/Escreva/);
  });
});

describe("áudio", () => {
  it("a IA transcreve o áudio do cliente antes de responder e guarda o texto", async () => {
    const { org, admin, incoming, agentOn } = await setup();
    await agentOn();
    await incoming({ audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 4, ptt: true } });
    const r = await processAiJobs(db, { evo, ai, stt });
    expect(r.map((x) => x.result)).toEqual(["respondida"]);
    const req = fakeAi.requests.at(-1) as { messages: { content: string }[] };
    expect(req.messages.at(-1)?.content).toBe("[áudio] quero ver o hrv prata amanhã");
    const [audio] = await db.select().from(messages).where(eq(messages.type, "audio"));
    expect(audio?.transcript).toBe("quero ver o hrv prata amanhã");
    // Já transcrito: não chama de novo.
    expect(await transcribeMessage(db, evo, stt, org.id, audio?.id ?? "", admin)).toBe(
      "quero ver o hrv prata amanhã",
    );
    expect(fakeAi.transcriptions).toBe(1);
    const [c] = await listConversations(db, admin, org.id);
    const listed = await listMessages(db, admin, org.id, c?.id ?? "");
    expect(listed.find((m) => m.type === "audio")?.transcript).toBe("quero ver o hrv prata amanhã");
  });

  it("sem transcrição configurada, a IA segue dizendo que não ouve", async () => {
    const { incoming, agentOn } = await setup();
    await agentOn();
    await incoming({ audioMessage: { mimetype: "audio/ogg", seconds: 3 } });
    await processAiJobs(db, { evo, ai });
    const req = fakeAi.requests.at(-1) as { messages: { content: string }[] };
    expect(req.messages.at(-1)?.content).toBe("[áudio, ainda não consigo ouvir]");
  });
});

describe("respostas rápidas", () => {
  it("normaliza o atalho, impede duplicado e só gestor edita", async () => {
    const { org, admin, seller } = await setup();
    const id = await saveQuickReply(db, admin, org.id, null, {
      shortcut: "/Bom Dia",
      body: "Bom dia {nome}! Como posso ajudar?",
    });
    expect(await listQuickReplies(db, org.id)).toEqual([
      { id, shortcut: "bom-dia", body: "Bom dia {nome}! Como posso ajudar?" },
    ]);
    await expect(saveQuickReply(db, admin, org.id, null, { shortcut: "bom-dia", body: "x" })).rejects.toThrow(
      /Já existe/,
    );
    await expect(saveQuickReply(db, seller, org.id, null, { shortcut: "oi", body: "x" })).rejects.toThrow(
      /administradores/,
    );
    await expect(saveQuickReply(db, admin, org.id, null, { shortcut: "a", body: "x" })).rejects.toThrow(
      /2 letras/,
    );
    expect(fillQuickReply("Bom dia {nome}! Tudo bem?", "Joana Silva")).toBe("Bom dia Joana! Tudo bem?");
    expect(fillQuickReply("Bom dia {nome}! Tudo bem?", "5548999")).toBe("Bom dia! Tudo bem?");
    await deleteQuickReply(db, admin, org.id, id ?? "");
    expect(await listQuickReplies(db, org.id)).toEqual([]);
  });
});

describe("tarefas", () => {
  it("vendedor cria para si, vê as suas, conclui; aviso no WhatsApp na hora, uma vez", async () => {
    const { org, admin, seller, ana } = await setup();
    await setMyPhone(db, ana, "48988880001");
    const past = new Date(Date.now() - 10 * 60_000);
    const br = new Date(past.getTime() - 3 * H).toISOString();
    const t1 = await createTask(db, seller, org.id, {
      title: "Ligar para a Joana",
      date: br.slice(0, 10),
      time: br.slice(11, 16),
      assignedUserId: admin.userId, // vendedor não escolhe: fica com ele
    });
    await createTask(db, admin, org.id, { title: "Revisar estoque", date: "2099-01-01", time: "09:00" });
    const anaTasks = await listTasks(db, seller, org.id, { done: false });
    expect(anaTasks.map((t) => [t.title, t.assignedUserName])).toEqual([["Ligar para a Joana", "Ana"]]);
    expect(await listTasks(db, admin, org.id, { done: false })).toHaveLength(2);
    expect(await countOverdueTasks(db, seller, org.id)).toBe(1);

    expect(await processTaskAlerts(db)).toBe(1);
    expect(await processTaskAlerts(db)).toBe(0);
    const [aviso] = await db.select().from(notificationOutbox);
    expect(aviso?.body).toContain("⏰ TAREFA: Ligar para a Joana");
    expect(aviso?.toPhone).toBe("5548988880001");

    await setTaskDone(db, seller, org.id, t1 ?? "", true);
    expect(await countOverdueTasks(db, seller, org.id)).toBe(0);
    expect((await listTasks(db, seller, org.id, { done: true }))[0]?.title).toBe("Ligar para a Joana");
    const adminTask = (await db.select().from(tasks)).find((t) => t.title === "Revisar estoque");
    await expect(setTaskDone(db, seller, org.id, adminTask?.id ?? "", true)).rejects.toThrow(
      /não encontrada/,
    );
  });
});

describe("anti-bloqueio", () => {
  it("intervalo entre envios automáticos e limite por dia, por número", async () => {
    const { org, admin, connId, say, agentOn } = await setup();
    const pace = { gapMinSeconds: 30, gapMaxSeconds: 30, dailyLimit: 2 };
    expect(await reserveAutomatedSend(db, connId, pace)).toBe(true);
    expect(await reserveAutomatedSend(db, connId, pace)).toBe(false); // ainda não deu o intervalo
    const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, connId) });
    const wait = (row?.nextAutomatedAt?.getTime() ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThan(31_000);

    // Dois clientes parados: só um follow-up por vez no mesmo número.
    await saveFollowupSettings(db, admin, org.id, {
      enabled: true,
      steps: [{ hours: 1, text: "Oi {nome}, conseguiu ver?" }],
      windowStart: "00:00",
      windowEnd: "23:59",
      sundays: true,
      ...pace,
    });
    await agentOn();
    await say("oi", "5548999990001");
    await say("olá", "5548999990002");
    await processAiJobs(db, { evo, ai });
    await db.update(conversations).set({ lastMessageAt: new Date(Date.now() - 2 * H) });
    await db.update(whatsappConnections).set({ nextAutomatedAt: null });
    expect((await processFollowups(db, { evo, ai })).map((r) => r.result)).toEqual(["enviado-1"]);
    const auto = await db.select().from(messages).where(eq(messages.automation, "followup"));
    expect(auto).toHaveLength(1);
    expect(fake.sent.at(-1)?.body).toMatchObject({ delay: expect.any(Number) });
    await db.update(whatsappConnections).set({ nextAutomatedAt: null });
    expect((await processFollowups(db, { evo, ai })).map((r) => r.result)).toEqual(["enviado-1"]);
    // Limite do dia (2) atingido.
    await db.insert(messages).values({
      organizationId: org.id,
      conversationId: auto[0]?.conversationId ?? "",
      connectionId: connId,
      direction: "out",
      body: "x",
      automation: "reminder",
    });
    await db.update(whatsappConnections).set({ nextAutomatedAt: null });
    expect(await reserveAutomatedSend(db, connId, pace)).toBe(false);
  });
});
