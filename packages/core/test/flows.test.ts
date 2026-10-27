import {
  conversations,
  deals,
  flowRuns,
  notificationOutbox,
  pipelineStages,
  tasks,
  whatsappConnections,
} from "@crm/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createConnection,
  createEvolutionClient,
  createOrganization,
  handleEvolutionWebhook,
  listContactRuns,
  listConversations,
  listFlows,
  listUpcoming,
  moveDeal,
  processFlows,
  refreshConnection,
  saveFlow,
  saveFollowupSettings,
  scheduleMessage,
  setDealTags,
  setFlowActive,
  setMyPhone,
  startFlow,
  stopRun,
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
});

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
  const say = (text: string, from = "5548999990001") =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id: `F${++n}-${Date.now()}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
        pushName: "Joana Silva",
        message: { conversation: text },
      },
    });
  await saveFollowupSettings(db, admin, org.id, {
    enabled: false,
    steps: [],
    windowStart: "00:00",
    windowEnd: "23:59",
    sundays: true,
    gapMinSeconds: 30,
    gapMaxSeconds: 30,
    dailyLimit: 100,
  });
  // O anti-bloqueio segura envios seguidos; aqui cada ciclo é testado isolado.
  const tick = async () => {
    await db.update(whatsappConnections).set({ nextAutomatedAt: null });
    await db
      .update(flowRuns)
      .set({ nextAt: new Date(Date.now() - 1000) })
      .where(eq(flowRuns.status, "active"));
    return (await processFlows(db, evo)).map((r) => r.result);
  };
  const texts = () =>
    fake.sent.filter((s) => s.kind === "sendText").map((s) => (s.body as { text: string }).text);
  return { org, admin, say, tick, texts };
}

describe("fluxos", () => {
  it("valida: só gestor, etapa obrigatória no gatilho de etapa, pelo menos uma ação", async () => {
    const { org, admin } = await setup();
    await expect(
      saveFlow(db, { ...admin, role: "seller" }, org.id, null, {
        name: "x",
        trigger: "manual",
        steps: [{ type: "message", text: "oi" }],
      }),
    ).rejects.toThrow(/gestores/);
    await expect(
      saveFlow(db, admin, org.id, null, {
        name: "x",
        trigger: "stage_entered",
        steps: [{ type: "message", text: "oi" }],
      }),
    ).rejects.toThrow(/Escolha a etapa/);
    await expect(
      saveFlow(db, admin, org.id, null, {
        name: "x",
        trigger: "manual",
        steps: [{ type: "wait", minutes: 10 }],
      }),
    ).rejects.toThrow(/pelo menos uma mensagem/);
  });

  it("lead novo: mensagem, espera, segunda mensagem, tarefa e aviso; uma mensagem por ciclo", async () => {
    const { org, admin, say, tick, texts } = await setup();
    await setMyPhone(db, admin.userId, "48988887777");
    const id = await saveFlow(db, admin, org.id, null, {
      name: "Boas-vindas",
      trigger: "lead_created",
      stopOnReply: false,
      steps: [
        { type: "message", text: "Oi {nome}! Obrigado pelo contato." },
        { type: "message", text: "Posso te mandar as opções?" },
        { type: "wait", minutes: 60 },
        { type: "message", text: "Ainda tem interesse?" },
        { type: "task", title: "Ligar para o cliente", dueMinutes: 0 },
        { type: "notify", text: "O fluxo terminou para {nome}." },
      ],
    });
    // Desligado: não dispara.
    await say("oi");
    expect(await tick()).toEqual([]);
    await setFlowActive(db, admin, org.id, id ?? "", true);
    await new Promise((r) => setTimeout(r, 5));
    await say("oi", "5548999990002");
    expect(await tick()).toEqual(["passo-1"]); // mandou a primeira e para (uma por ciclo)
    expect(texts()).toEqual(["Oi Joana! Obrigado pelo contato."]);
    expect(await tick()).toEqual(["passo-3"]); // segunda mensagem + começa a espera
    const run = (await db.select().from(flowRuns))[0];
    expect(run?.nextAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(await tick()).toEqual(["done"]);
    expect(texts()).toEqual([
      "Oi Joana! Obrigado pelo contato.",
      "Posso te mandar as opções?",
      "Ainda tem interesse?",
    ]);
    const [t] = await db.select().from(tasks);
    expect(t).toMatchObject({ title: "Ligar para o cliente", assignedUserId: admin.userId });
    const [aviso] = await db.select().from(notificationOutbox);
    expect(aviso?.body).toContain("⚡ BOAS-VINDAS");
    expect(aviso?.body).toContain("O fluxo terminou para Joana.");
    expect((await listFlows(db, org.id))[0]).toMatchObject({ finished: 1, running: 0 });
  });

  it("para quando o cliente responde, por etapa e por etiqueta, manual, duplicado e parar", async () => {
    const { org, admin, say, tick, texts } = await setup();
    await say("oi");
    const [deal] = await db.select().from(deals);
    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, deal?.pipelineId ?? ""));
    const qualified = stages.find((s) => s.name === "Qualificado");
    const won = stages.find((s) => s.kind === "won");
    const fid = await saveFlow(db, admin, org.id, null, {
      name: "Qualificado",
      trigger: "stage_entered",
      triggerStageId: qualified?.id ?? null,
      steps: [
        { type: "message", text: "Separei umas opções para você." },
        { type: "wait", minutes: 1440 },
        { type: "message", text: "Conseguiu ver?" },
      ],
    });
    await setFlowActive(db, admin, org.id, fid ?? "", true);
    await new Promise((r) => setTimeout(r, 5));
    await moveDeal(db, admin, org.id, deal?.id ?? "", qualified?.id ?? "");
    expect(await tick()).toEqual(["passo-2"]);
    expect(texts()).toEqual(["Separei umas opções para você."]);
    await say("vi sim, obrigado");
    expect(await tick()).toEqual(["stopped"]);
    const [r1] = await db.select().from(flowRuns);
    expect(r1?.stopReason).toBe("cliente respondeu");

    // Etiqueta
    const tid = await saveFlow(db, admin, org.id, null, {
      name: "Financiamento",
      trigger: "tag_added",
      triggerTagId: null,
      steps: [{ type: "message", text: "Vou simular o financiamento." }],
    }).catch((e) => e);
    expect(String(tid)).toMatch(/Escolha a etiqueta/);
    await setDealTags(db, admin, org.id, deal?.id ?? "", ["Financiamento"]);
    const tag = await db.query.tags.findFirst();
    const tf = await saveFlow(db, admin, org.id, null, {
      name: "Financiamento",
      trigger: "tag_added",
      triggerTagId: tag?.id ?? null,
      steps: [{ type: "message", text: "Vou simular o financiamento." }],
    });
    await setFlowActive(db, admin, org.id, tf ?? "", true);
    await new Promise((r) => setTimeout(r, 5));
    await setDealTags(db, admin, org.id, deal?.id ?? "", ["Financiamento"]); // já tinha: não dispara
    expect(await tick()).toEqual([]);
    await setDealTags(db, admin, org.id, deal?.id ?? "", []);
    await setDealTags(db, admin, org.id, deal?.id ?? "", ["Financiamento", "Urgente"]);
    expect(await tick()).toEqual(["done"]);
    expect(texts().at(-1)).toBe("Vou simular o financiamento.");

    // Manual + duplicado + parar + lista de programadas
    const mf = await saveFlow(db, admin, org.id, null, {
      name: "Reaquecer",
      trigger: "manual",
      stopOnReply: true,
      steps: [
        { type: "wait", minutes: 120 },
        { type: "message", text: "Oi {nome}, novidades no estoque!" },
      ],
    });
    const [c] = await listConversations(db, admin, org.id);
    await expect(startFlow(db, admin, org.id, mf ?? "", c?.id ?? "")).rejects.toThrow(/Ligue o fluxo/);
    await setFlowActive(db, admin, org.id, mf ?? "", true);
    const runId = await startFlow(db, admin, org.id, mf ?? "", c?.id ?? "");
    await expect(startFlow(db, admin, org.id, mf ?? "", c?.id ?? "")).rejects.toThrow(/já está rodando/);
    await processFlows(db, evo); // executa a espera
    await scheduleMessage(db, admin, org.id, c?.id ?? "", {
      text: "Lembrete manual",
      sendAt: new Date(Date.now() + 30 * 60_000),
    });
    const up = await listUpcoming(db, admin, org.id);
    expect(up.map((u) => [u.kind, u.text])).toEqual([
      ["scheduled", "Lembrete manual"],
      ["flow", "Oi {nome}, novidades no estoque!"],
    ]);
    expect(await listContactRuns(db, org.id, c?.contactId ?? "")).toHaveLength(1);
    await stopRun(db, admin, org.id, runId);
    const stopped = await db.query.flowRuns.findFirst({ where: eq(flowRuns.id, runId) });
    expect(stopped).toMatchObject({ status: "stopped", stopReason: "parado pela equipe" });

    // Negociação ganha para o fluxo
    await setFlowActive(db, admin, org.id, fid ?? "", false);
    await setFlowActive(db, admin, org.id, fid ?? "", true);
    const runs2 = await db
      .select()
      .from(flowRuns)
      .where(and(eq(flowRuns.flowId, mf ?? ""), eq(flowRuns.status, "active")));
    expect(runs2).toHaveLength(0);
    await moveDeal(db, admin, org.id, deal?.id ?? "", won?.id ?? "");
    void conversations;
  });
});
