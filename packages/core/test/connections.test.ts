import { webhookEvents, whatsappConnections } from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createConnection,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  deleteConnection,
  disconnectConnection,
  EvolutionError,
  formatPhone,
  handleEvolutionWebhook,
  jidToPhone,
  listConnections,
  refreshConnection,
  setConnectionActive,
  updateOrganizationLimits,
} from "../src/index.js";
import { type FakeEvolution, startFakeEvolution } from "../src/testing/fake-evolution.js";
import { createMaster, db, resetDb } from "./helpers.js";

let fake: FakeEvolution;
let evo: ReturnType<typeof createEvolutionClient>;
const BASE = "https://crm.exemplo.com";

beforeAll(async () => {
  fake = await startFakeEvolution();
  evo = createEvolutionClient({ baseUrl: fake.url, apiKey: fake.apiKey });
});
afterAll(() => fake.close());
beforeEach(async () => {
  await resetDb();
  fake.calls.length = 0;
  for (const k of [...fake.instances.keys()]) if (k !== "GREENCAR") fake.instances.delete(k);
});

async function setup(limit = 1) {
  const master = await createMaster();
  const masterActor = { isMaster: true, role: null, userId: master.id };
  const { organization, invite } = await createOrganization(db, masterActor, {
    name: "GreenCar Veículos",
    adminEmail: "admin@greencar.com",
    adminName: "Admin",
    whatsappConnections: limit,
  });
  const admin = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const adminActor = { isMaster: false, role: "admin" as const, userId: admin.userId };
  return { masterActor, adminActor, org: organization };
}

/** Webhook tokens are only known at creation time; read the configured URL from the fake. */
function webhookOf(instanceName: string) {
  const url = new URL(fake.instances.get(instanceName)?.webhook ?? "");
  const id = url.pathname.split("/").at(-1) ?? "";
  return { id, token: url.searchParams.get("t") ?? "" };
}

async function instanceNameOf(id: string) {
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, id) });
  return row?.instanceName ?? "";
}

describe("cliente Evolution", () => {
  it("recusa instâncias sem o prefixo do CRM, sem chamar a Evolution", async () => {
    await expect(evo.logout("GREENCAR")).rejects.toBeInstanceOf(EvolutionError);
    await expect(evo.deleteInstance("GREENCAR")).rejects.toBeInstanceOf(EvolutionError);
    await expect(evo.connectionState("GREENCAR")).rejects.toBeInstanceOf(EvolutionError);
    await expect(evo.fetchInstance("crm_../GREENCAR")).rejects.toBeInstanceOf(EvolutionError);
    expect(fake.calls).toHaveLength(0);
    expect(fake.instances.get("GREENCAR")?.state).toBe("open");
  });

  it("envia a chave no cabeçalho e reporta erro de autenticação", async () => {
    const bad = createEvolutionClient({ baseUrl: fake.url, apiKey: "errada" });
    await expect(bad.createInstance("crm_teste_abc")).rejects.toThrow(/401/);
  });

  it("formata telefones", () => {
    expect(jidToPhone("554896229897@s.whatsapp.net")).toBe("554896229897");
    expect(jidToPhone("5548996743297:12@s.whatsapp.net")).toBe("5548996743297");
    expect(formatPhone("554896229897")).toBe("(48) 9622-9897");
    expect(formatPhone("5548996743297")).toBe("(48) 99674-3297");
    expect(formatPhone("14155550100")).toBe("+14155550100");
  });
});

describe("conexões de WhatsApp", () => {
  it("cria com QR, conecta pela leitura e mostra o número", async () => {
    const { adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    expect(c.status).toBe("pending");
    expect(c.qrCode).toMatch(/^data:image\/png;base64,/);
    const name = await instanceNameOf(c.id);
    expect(name).toMatch(/^crm_greencarveiculos_[a-z0-9]+$/);
    const wh = webhookOf(name);
    expect(wh.id).toBe(c.id);
    expect(fake.instances.get(name)?.webhook).toContain(`${BASE}/api/webhooks/evolution/${c.id}?t=`);

    await fake.scan(name, "5548996743297");
    const r = await refreshConnection(db, evo, adminActor, org.id, c.id);
    expect(r.status).toBe("open");
    expect(r.phone).toBe("5548996743297");
    expect(r.qrCode).toBeNull();
    expect(r.connectedAt).toBeInstanceOf(Date);
  });

  it("respeita o limite do plano e o Master pode aumentar", async () => {
    const { masterActor, adminActor, org } = await setup(1);
    await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    await expect(createConnection(db, evo, adminActor, org.id, { name: "Vendas" }, BASE)).rejects.toThrow(
      /Limite de 1/,
    );
    await expect(
      updateOrganizationLimits(db, adminActor, org.id, { whatsappConnections: 5, aiCreditsMonthly: 1 }),
    ).rejects.toThrow(/Master/);
    await updateOrganizationLimits(db, masterActor, org.id, {
      whatsappConnections: 2,
      aiCreditsMonthly: 50000,
    });
    await createConnection(db, evo, adminActor, org.id, { name: "Vendas" }, BASE);
    const { connections, limit } = await listConnections(db, adminActor, org.id);
    expect(limit).toBe(2);
    expect(connections.map((c) => c.name)).toEqual(["Loja", "Vendas"]);
  });

  it("só administrador (ou Master) gerencia; vendedor não", async () => {
    const { adminActor, org } = await setup();
    const inv = await createInvitation(db, adminActor, org.id, { email: "v@greencar.com", role: "seller" });
    const seller = await acceptInvitation(db, { token: inv.token, name: "Vendedor", password: "venda1234" });
    const sellerActor = { isMaster: false, role: "seller" as const, userId: seller.userId };
    await expect(createConnection(db, evo, sellerActor, org.id, { name: "X" }, BASE)).rejects.toThrow(
      /administradores/,
    );
    await expect(listConnections(db, sellerActor, org.id)).rejects.toThrow(/administradores/);
  });

  it("não enxerga conexão de outra empresa", async () => {
    const { masterActor, adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    const other = await createOrganization(db, masterActor, {
      name: "Outra",
      adminEmail: "o@o.com",
      adminName: "Outro Admin",
    });
    await expect(refreshConnection(db, evo, masterActor, other.organization.id, c.id)).rejects.toThrow(
      /não encontrada/,
    );
    await expect(deleteConnection(db, evo, masterActor, other.organization.id, c.id)).rejects.toThrow(
      /não encontrada/,
    );
  });

  it("se a Evolution falhar, não deixa registro nem instância sobrando", async () => {
    const { adminActor, org } = await setup();
    const broken = { ...evo, setWebhook: async () => Promise.reject(new EvolutionError("falhou", 500)) };
    await expect(createConnection(db, broken, adminActor, org.id, { name: "Loja" }, BASE)).rejects.toThrow(
      /Não foi possível criar/,
    );
    expect(await db.select().from(whatsappConnections)).toHaveLength(0);
    expect([...fake.instances.keys()]).toEqual(["GREENCAR"]);
  });

  it("gera QR novo quando o anterior venceu", async () => {
    const { adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    await db
      .update(whatsappConnections)
      .set({ qrUpdatedAt: new Date(Date.now() - 60_000) })
      .where(eq(whatsappConnections.id, c.id));
    const before = fake.calls.filter((x) => x.path.startsWith("/instance/connect/")).length;
    const r = await refreshConnection(db, evo, adminActor, org.id, c.id);
    expect(r.status).toBe("pending");
    expect(r.qrCode).toBeTruthy();
    expect(fake.calls.filter((x) => x.path.startsWith("/instance/connect/")).length).toBe(before + 1);
    // QR ainda válido: não pede outro
    await refreshConnection(db, evo, adminActor, org.id, c.id);
    expect(fake.calls.filter((x) => x.path.startsWith("/instance/connect/")).length).toBe(before + 1);
  });

  it("desconectar, desativar e excluir só afetam a instância do CRM", async () => {
    const { adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    const name = await instanceNameOf(c.id);
    await fake.scan(name);
    await refreshConnection(db, evo, adminActor, org.id, c.id);

    await setConnectionActive(db, adminActor, org.id, c.id, false);
    expect((await listConnections(db, adminActor, org.id)).connections[0]?.active).toBe(false);
    expect(fake.instances.get(name)?.state).toBe("open");

    await disconnectConnection(db, evo, adminActor, org.id, c.id);
    expect(fake.instances.get(name)?.state).toBe("close");
    expect((await listConnections(db, adminActor, org.id)).connections[0]?.status).toBe("close");

    await deleteConnection(db, evo, adminActor, org.id, c.id);
    expect(fake.instances.has(name)).toBe(false);
    expect(await db.select().from(whatsappConnections)).toHaveLength(0);

    const greencar = fake.instances.get("GREENCAR");
    expect(greencar?.state).toBe("open");
    expect(greencar?.webhook).toBe("https://outro-sistema.example/webhook");
    expect(fake.calls.some((x) => x.path.includes("GREENCAR"))).toBe(false);
  });
});

describe("webhook da Evolution", () => {
  it("aceita só com o segredo certo e a instância certa", async () => {
    const { adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    const name = await instanceNameOf(c.id);
    const { token } = webhookOf(name);

    expect((await handleEvolutionWebhook(db, c.id, "errado", { event: "connection.update" })).status).toBe(
      401,
    );
    expect(
      (await handleEvolutionWebhook(db, c.id, token, { event: "connection.update", instance: "GREENCAR" }))
        .status,
    ).toBe(401);
    expect((await handleEvolutionWebhook(db, crypto.randomUUID(), token, {})).status).toBe(404);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("aplica QR e conexão; guarda e processa mensagens", async () => {
    const { adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    const name = await instanceNameOf(c.id);
    const { token } = webhookOf(name);

    await handleEvolutionWebhook(db, c.id, token, {
      event: "qrcode.updated",
      instance: name,
      data: { qrcode: { base64: "data:image/png;base64,NOVO", pairingCode: null } },
    });
    let row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, c.id) });
    expect(row?.qrCode).toBe("data:image/png;base64,NOVO");

    await handleEvolutionWebhook(db, c.id, token, {
      event: "connection.update",
      instance: name,
      data: { state: "open", wuid: "5548996743297@s.whatsapp.net", profileName: "Teste" },
    });
    row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, c.id) });
    expect(row?.status).toBe("open");
    expect(row?.phone).toBe("5548996743297");
    expect(row?.qrCode).toBeNull();

    await handleEvolutionWebhook(db, c.id, token, {
      event: "MESSAGES_UPSERT",
      instance: name,
      data: {
        key: { id: "ABC", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false },
        message: { conversation: "oi" },
      },
    });
    const evs = await db.select().from(webhookEvents).orderBy(webhookEvents.createdAt);
    expect(evs.map((e) => e.event)).toEqual(["qrcode.updated", "connection.update", "messages.upsert"]);
    expect(evs[0]?.processedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(evs[0]?.payload)).not.toContain("NOVO");
    expect(evs[2]?.processedAt).toBeInstanceOf(Date); // mensagens agora são processadas na hora
  });

  it("o fluxo real: a Evolution chama o webhook quando o celular lê o QR", async () => {
    const { adminActor, org } = await setup();
    const c = await createConnection(db, evo, adminActor, org.id, { name: "Loja" }, BASE);
    const name = await instanceNameOf(c.id);
    const { token } = webhookOf(name);
    // Simula o que a Evolution faz (no teste o "servidor" do CRM é a própria função).
    await handleEvolutionWebhook(db, c.id, token, {
      event: "connection.update",
      instance: name,
      data: { state: "connecting" },
    });
    let row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, c.id) });
    expect(row?.status).toBe("connecting");
    await handleEvolutionWebhook(db, c.id, token, {
      event: "connection.update",
      instance: name,
      data: { state: "close" },
    });
    row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, c.id) });
    expect(row?.status).toBe("close");
  });
});
