import { appointments, conversations, messages, notificationOutbox, whatsappConnections } from "@crm/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  brParts,
  createAnthropicClient,
  createAppointment,
  createConnection,
  createEvolutionClient,
  createOrganization,
  handleEvolutionWebhook,
  inWindow,
  processAiJobs,
  processFollowups,
  processReminders,
  refreshConnection,
  saveAgent,
  saveFollowupSettings,
  saveScheduleSettings,
  setMyPhone,
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

const H = 3600_000;
const ALWAYS = { windowStart: "00:00", windowEnd: "23:59", sundays: true };

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
  const hook = (fromMe: boolean, text: string, who = "5548999990001") =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id: `X${++n}-${Date.now()}`, remoteJid: `${who}@s.whatsapp.net`, fromMe },
        pushName: fromMe ? undefined : "Joana Silva",
        message: { conversation: text },
      },
    });
  const say = (text: string) => hook(false, text);
  const phoneSays = (text: string) => hook(true, text);
  await saveAgent(db, admin, org.id, {
    name: "Assistente",
    active: true,
    instructions: "Você é o assistente da Loja. Vendemos carros seminovos.",
    replyDelaySeconds: 0,
  });
  const deps = { evo, ai };
  const silence = (hours: number) =>
    db.update(conversations).set({ lastMessageAt: new Date(Date.now() - hours * H) });
  const lastText = () => (fake.sent.at(-1)?.body as { text?: string } | undefined)?.text;
  return { org, admin, say, phoneSays, deps, silence, lastText };
}

describe("follow-up", () => {
  it("retoma em 24 h (IA) e 72 h (texto fixo), para quando acabam os passos e zera quando o cliente volta", async () => {
    const { org, admin, say, deps, silence, lastText } = await setup();
    await saveFollowupSettings(db, admin, org.id, {
      enabled: true,
      steps: [
        { hours: 24, text: null },
        { hours: 72, text: "Oi {nome}, ainda procurando carro?" },
      ],
      ...ALWAYS,
    });
    await say("oi");
    await processAiJobs(db, deps);
    expect(lastText()).toBe("Resposta automática: oi");
    expect(await processFollowups(db, deps)).toEqual([]);

    await silence(25);
    expect((await processFollowups(db, deps)).map((r) => r.result)).toEqual(["enviado-1"]);
    expect(lastText()).toBe("Oi! Ainda tem interesse? Posso ajudar?");
    const req = fakeAi.requests.at(-1) as { messages: { content: string }[]; tools?: unknown };
    expect(req.tools).toBeUndefined();
    expect(req.messages.at(-1)?.content).toContain("não responde há 25 horas");
    expect(await processFollowups(db, deps)).toEqual([]); // conta a partir do follow-up

    await silence(73);
    expect((await processFollowups(db, deps)).map((r) => r.result)).toEqual(["enviado-2"]);
    expect(lastText()).toBe("Oi Joana, ainda procurando carro?");
    await silence(1000);
    expect(await processFollowups(db, deps)).toEqual([]);

    await say("sim, ainda quero");
    const [c] = await db.select().from(conversations);
    expect(c?.followupCount).toBe(0);
  });

  it("não atravessa vendedor, respeita despedida, janela de horário e visita marcada", async () => {
    const { org, admin, say, phoneSays, deps, silence } = await setup();
    await saveFollowupSettings(db, admin, org.id, {
      enabled: true,
      steps: [{ hours: 24, text: null }],
      ...ALWAYS,
    });
    await say("oi");
    await processAiJobs(db, deps);

    // Vendedor falou por último (pelo celular): a IA não manda follow-up.
    await phoneSays("Joana, te ligo amanhã");
    await silence(30);
    expect(await processFollowups(db, deps)).toEqual([]);

    // Cliente se despediu: a IA decide não mandar (e o passo é consumido).
    await db
      .update(messages)
      .set({ sentAt: new Date(Date.now() - 2 * H) })
      .where(eq(messages.sentByAi, false));
    await say("obrigado, tchau");
    await processAiJobs(db, deps);
    await silence(30);
    fake.sent.length = 0;
    expect((await processFollowups(db, deps)).map((r) => r.result)).toEqual(["nao-enviado"]);
    expect(fake.sent).toHaveLength(0);

    // Fora da janela de envio: espera.
    await say("na verdade quero ver um carro");
    await processAiJobs(db, deps);
    await saveFollowupSettings(db, admin, org.id, {
      enabled: true,
      steps: [{ hours: 24, text: null }],
      windowStart: "00:00",
      windowEnd: "00:01",
      sundays: true,
    });
    await silence(30);
    expect(await processFollowups(db, deps)).toEqual([]);

    // Com visita marcada no futuro: não cobra.
    await saveFollowupSettings(db, admin, org.id, {
      enabled: true,
      steps: [{ hours: 24, text: null }],
      ...ALWAYS,
    });
    const later = new Date(Date.now() + 48 * H);
    await createAppointment(db, admin, org.id, {
      phone: "5548999990001",
      date: brParts(later).date,
      time: brParts(later).time,
    });
    expect(await processFollowups(db, deps)).toEqual([]);
    await db.delete(appointments);
    expect((await processFollowups(db, deps)).map((r) => r.result)).toEqual(["enviado-1"]);
  });

  it("janela: domingo e horário", () => {
    const s = { windowStart: "08:00", windowEnd: "20:00", sundays: false };
    expect(inWindow(s, new Date("2026-10-26T12:00:00-03:00"))).toBe(true); // segunda 12h
    expect(inWindow(s, new Date("2026-10-26T21:00:00-03:00"))).toBe(false);
    expect(inWindow(s, new Date("2026-10-25T12:00:00-03:00"))).toBe(false); // domingo
    expect(inWindow({ ...s, sundays: true }, new Date("2026-10-25T12:00:00-03:00"))).toBe(true);
  });
});

describe("lembretes de visita", () => {
  it("lembra 24 h e 2 h antes, avisa o responsável no último e pula o que perdeu o sentido", async () => {
    const { org, admin, say, deps, lastText } = await setup();
    await setMyPhone(db, admin.userId, "48988887777");
    await saveScheduleSettings(db, admin, org.id, {
      aiCanBook: false,
      durationMinutes: 30,
      perSlot: 1,
      hours: {},
      remindEnabled: true,
      remindHours: [2, 24],
      remindTemplate: null,
    });
    await say("oi");
    await processAiJobs(db, deps);
    const at = new Date(Date.now() + 23 * H);
    const id = await createAppointment(db, admin, org.id, {
      phone: "5548999990001",
      date: brParts(at).date,
      time: brParts(at).time,
    });
    await db
      .update(appointments)
      .set({ createdAt: new Date(Date.now() - 48 * H) })
      .where(eq(appointments.id, id));
    fake.sent.length = 0;
    expect((await processReminders(db, evo)).map((r) => r.result)).toEqual(["lembrete-24h"]);
    expect(lastText()).toMatch(
      /^Oi Joana! Passando para lembrar da sua visita (hoje|amanhã) às \d\d:\d\d na Loja\./,
    );
    expect(await processReminders(db, evo)).toEqual([]);
    expect(await db.select().from(notificationOutbox)).toHaveLength(0);

    await db
      .update(appointments)
      .set({ startsAt: new Date(Date.now() + 90 * 60_000) })
      .where(eq(appointments.id, id));
    expect((await processReminders(db, evo)).map((r) => r.result)).toEqual(["lembrete-2h"]);
    expect(lastText()).toContain("hoje às");
    const [aviso] = await db.select().from(notificationOutbox);
    expect(aviso?.body).toContain("VISITA HOJE ÀS");
    // A mensagem do lembrete é automática: não pausa a IA.
    const [c] = await db.select().from(conversations);
    expect(c?.aiPaused).toBe(false);

    // Marcada 3 h antes: o lembrete de 24 h é pulado; contato sem conversa ganha uma.
    const soon = new Date(Date.now() + 3 * H);
    await createAppointment(db, admin, org.id, {
      phone: "48 99777-1234",
      contactName: "Pedro",
      date: brParts(soon).date,
      time: brParts(soon).time,
    });
    expect((await processReminders(db, evo)).map((r) => r.result)).toEqual(["pulado"]);
    await db
      .update(appointments)
      .set({ startsAt: sql`now() + interval '100 minutes'`, createdAt: sql`now() - interval '80 minutes'` })
      .where(sql`${appointments.id} <> ${id}`);
    fake.sent.length = 0;
    expect((await processReminders(db, evo)).map((r) => r.result)).toEqual(["lembrete-2h"]);
    expect(fake.sent[0]?.to).toBe("5548997771234");
    expect(lastText()).toContain("Oi Pedro!");
  });
});
