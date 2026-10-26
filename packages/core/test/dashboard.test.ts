import { appointments, conversations, deals, pipelineStages, whatsappConnections } from "@crm/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createAppointment,
  createConnection,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  getDashboard,
  handleEvolutionWebhook,
  periodRange,
  refreshConnection,
  saveRotation,
  sendMessage,
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
beforeEach(() => resetDb());

describe("períodos", () => {
  it("calcula hoje, 7 dias, este mês e mês passado no horário de Brasília", () => {
    const now = new Date("2026-10-26T15:00:00Z"); // 12:00 em Brasília
    expect(periodRange("hoje", now).from.toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(periodRange("7d", now).from.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(periodRange("mes", now).from.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    const prev = periodRange("mes-passado", now);
    expect([prev.from.toISOString(), prev.to.toISOString()]).toEqual([
      "2026-09-01T03:00:00.000Z",
      "2026-10-01T03:00:00.000Z",
    ]);
    expect(periodRange("jan", new Date("2026-01-10T15:00:00Z")).id).toBe("7d");
    expect(periodRange("mes-passado", new Date("2026-01-10T15:00:00Z")).from.toISOString()).toBe(
      "2025-12-01T03:00:00.000Z",
    );
  });
});

describe("painel", () => {
  it("gestor vê a empresa e o time; vendedor vê só o que é dele", async () => {
    const master = await createMaster();
    const { organization: org, invite } = await createOrganization(
      db,
      { isMaster: true, role: null, userId: master.id },
      { name: "Loja", adminEmail: "admin@loja.com", adminName: "Admin" },
    );
    const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
    const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
    const ids: string[] = [];
    for (const name of ["Ana", "Bruno"]) {
      const inv = await createInvitation(db, admin, org.id, {
        email: `${name}@loja.com`,
        name,
        role: "seller",
      });
      ids.push((await acceptInvitation(db, { token: inv.token, name, password: "vende1234" })).userId);
    }
    const [ana = "", bruno = ""] = ids;
    const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
    const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
    const instance = row?.instanceName ?? "";
    await fake.scan(instance);
    await refreshConnection(db, evo, admin, org.id, conn.id);
    const token = new URL(fake.instances.get(instance)?.webhook ?? "").searchParams.get("t") ?? "";
    await saveRotation(db, admin, org.id, { enabled: true, notify: false, userIds: [ana, bruno] });
    for (const [i, who] of ["5548999990001", "5548999990002", "5548999990003"].entries())
      await handleEvolutionWebhook(db, conn.id, token, {
        event: "messages.upsert",
        instance,
        data: {
          key: { id: `D${i}`, remoteJid: `${who}@s.whatsapp.net`, fromMe: false },
          pushName: `Cliente ${i + 1}`,
          message: { conversation: "oi" },
        },
      });

    // Ana fecha uma venda de R$ 50.000 e uma visita acontece.
    const [d1] = await db.select().from(deals).where(eq(deals.assignedUserId, ana)).orderBy(deals.number);
    const won = await db.query.pipelineStages.findFirst({
      where: and(eq(pipelineStages.pipelineId, d1?.pipelineId ?? ""), eq(pipelineStages.kind, "won")),
    });
    await db
      .update(deals)
      .set({ stageId: won?.id, valueCents: 5_000_000, closedAt: new Date() })
      .where(eq(deals.id, d1?.id ?? ""));
    const later = new Date(Date.now() + 5 * 3600_000);
    const apId = await createAppointment(db, { isMaster: false, role: "seller", userId: ana }, org.id, {
      phone: "5548999990003",
      date: later.toISOString().slice(0, 10),
      time: "10:00",
    });
    await db
      .update(appointments)
      .set({ status: "attended", startsAt: new Date(Date.now() - 3600_000) })
      .where(eq(appointments.id, apId));

    // Bruno responde o cliente dele; os outros dois ficam esperando há 1 hora.
    const brunoConv = await db.query.conversations.findFirst({
      where: eq(conversations.assignedUserId, bruno),
    });
    await sendMessage(
      db,
      evo,
      { isMaster: false, role: "seller", userId: bruno },
      org.id,
      brunoConv?.id ?? "",
      {
        text: "Olá!",
      },
    );
    await db.update(conversations).set({ lastMessageAt: new Date(Date.now() - 3600_000) });

    const g = await getDashboard(db, admin, org.id, { period: "7d" });
    expect(g.kpi).toMatchObject({
      leads: 3,
      won: 1,
      wonCents: 5_000_000,
      visitsAttended: 1,
      visitsNoShow: 0,
      showRate: 1,
    });
    expect(g.kpi.conversion).toBeCloseTo(1 / 3);
    expect(g.sla).toMatchObject({ total: 3, answered: 1, within5: 1 });
    expect(g.waiting.count).toBe(2);
    expect(g.waiting.items.map((w) => w.assignee).sort()).toEqual(["Ana", "Ana"]);
    expect(g.sources).toEqual([{ name: "WhatsApp direto", leads: 3, won: 1 }]);
    expect(g.funnel.reduce((s, f) => s + f.count, 0)).toBe(2);
    const t = Object.fromEntries(g.team.map((x) => [x.name, x]));
    expect(t.Ana).toMatchObject({ leads: 2, won: 1, wonCents: 5_000_000, visits: 1, waiting: 2 });
    expect(t.Bruno).toMatchObject({ leads: 1, won: 0, waiting: 0 });
    expect(g.team[0]?.name).toBe("Ana"); // ordenado por venda

    // Gestor filtrando a Ana.
    const onlyAna = await getDashboard(db, admin, org.id, { period: "7d", userId: ana });
    expect(onlyAna.kpi.leads).toBe(2);

    // Vendedor: só o dele, sem time, e não consegue ver outra pessoa.
    const b = await getDashboard(db, { isMaster: false, role: "seller", userId: bruno }, org.id, {
      period: "hoje",
      userId: ana,
    });
    expect(b.manager).toBe(false);
    expect(b.kpi).toMatchObject({ leads: 1, won: 0 });
    expect(b.team).toEqual([]);
    expect(b.waiting.count).toBe(0);
    expect(b.ai.usedCredits).toBeNull();
  });
});
