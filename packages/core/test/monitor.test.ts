import { notificationOutbox, organizations, whatsappConnections } from "@crm/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  connectionAlerts,
  createConnection,
  createEvolutionClient,
  createOrganization,
  disconnectConnection,
  monitorConnections,
  refreshConnection,
  setMyPhone,
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
beforeEach(resetDb);

async function setup() {
  const master = await createMaster();
  const { organization: org, invite } = await createOrganization(
    db,
    { isMaster: true, role: null, userId: master.id },
    { name: "Loja Monitor", adminEmail: "admin@mon.com", adminName: "Admin" },
  );
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  await db
    .update(organizations)
    .set({ limits: sql`jsonb_set(${organizations.limits}, '{whatsappConnections}', '3')` })
    .where(eq(organizations.id, org.id));
  const connect = async (name: string) => {
    const conn = await createConnection(db, evo, admin, org.id, { name }, "https://crm.exemplo.com");
    const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
    await fake.scan(row?.instanceName ?? "");
    await refreshConnection(db, evo, admin, org.id, conn.id);
    return { id: conn.id, instance: row?.instanceName ?? "" };
  };
  return { org, admin, connect };
}
const backdate = (id: string, ms: number) =>
  db
    .update(whatsappConnections)
    .set({ downSince: new Date(Date.now() - ms) })
    .where(eq(whatsappConnections.id, id));

describe("monitor de conexões", () => {
  it("pega queda sem webhook, avisa uma vez depois de 2 min e limpa quando volta", async () => {
    const { org, admin, connect } = await setup();
    await setMyPhone(db, admin.userId, "48988887777");
    const loja = await connect("Loja");
    const reserva = await connect("Reserva");
    expect(await monitorConnections(db, evo)).toMatchObject({ checked: 2, alerted: 0 });
    expect(await connectionAlerts(db, org.id)).toEqual([]);

    // Cai sem avisar (sem webhook).
    const inst = fake.instances.get(loja.instance);
    if (inst) inst.state = "close";
    expect(await monitorConnections(db, evo)).toMatchObject({ alerted: 0 });
    const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, loja.id) });
    expect(row).toMatchObject({ status: "close" });
    expect(row?.downSince).toBeTruthy();
    // "Fechada" já aparece na faixa.
    expect((await connectionAlerts(db, org.id)).map((a) => a.name)).toEqual(["Loja"]);

    await backdate(loja.id, 3 * 60_000);
    expect(await monitorConnections(db, evo)).toMatchObject({ alerted: 1 });
    expect(await monitorConnections(db, evo)).toMatchObject({ alerted: 0 });
    const avisos = await db.select().from(notificationOutbox);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ connectionId: reserva.id });
    expect(avisos[0]?.body).toContain('WHATSAPP "Loja" DESCONECTADO');

    // Voltou.
    await fake.scan(loja.instance);
    expect(await monitorConnections(db, evo)).toMatchObject({ recovered: 1 });
    expect(await connectionAlerts(db, org.id)).toEqual([]);
    const back = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, loja.id) });
    expect(back).toMatchObject({ status: "open", downSince: null, downAlertedAt: null });
  });

  it("Evolution sem responder conta como fora do ar; desconectar de propósito não alarma", async () => {
    const { org, admin, connect } = await setup();
    const loja = await connect("Loja");
    const dead = createEvolutionClient({ baseUrl: "http://127.0.0.1:1", apiKey: "x" });
    await monitorConnections(db, dead);
    expect(await connectionAlerts(db, org.id)).toEqual([]);
    await db
      .update(whatsappConnections)
      .set({
        checkFailedSince: new Date(Date.now() - 6 * 60_000),
        downSince: new Date(Date.now() - 6 * 60_000),
      })
      .where(eq(whatsappConnections.id, loja.id));
    expect(await monitorConnections(db, dead)).toMatchObject({ alerted: 1 });
    expect(await connectionAlerts(db, org.id)).toMatchObject([{ name: "Loja", noAnswer: true }]);
    // Sem outro número: não há por onde mandar WhatsApp.
    expect(await db.select().from(notificationOutbox)).toHaveLength(0);
    await monitorConnections(db, evo);
    expect(await connectionAlerts(db, org.id)).toEqual([]);

    await disconnectConnection(db, evo, admin, org.id, loja.id);
    expect(await monitorConnections(db, evo)).toMatchObject({ checked: 0 });
    expect(await connectionAlerts(db, org.id)).toEqual([]);
  });
});
