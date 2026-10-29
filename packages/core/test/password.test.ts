import { loginAttempts, passwordResets, sessions, whatsappConnections } from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  checkResetToken,
  createConnection,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  createResetLinkForMember,
  login,
  refreshConnection,
  requestPasswordReset,
  resetPassword,
  setMyPhone,
} from "../src/index.js";
import { type FakeEvolution, startFakeEvolution } from "../src/testing/fake-evolution.js";
import { createMaster, db, resetDb } from "./helpers.js";

let fake: FakeEvolution;
let evo: ReturnType<typeof createEvolutionClient>;
beforeAll(async () => {
  fake = await startFakeEvolution();
  evo = createEvolutionClient({ baseUrl: fake.url, apiKey: fake.apiKey });
  process.env.APP_URL = "https://crm.exemplo.com";
});
afterAll(() => fake.close());
beforeEach(async () => {
  await resetDb();
  fake.sent.length = 0;
});

async function setup() {
  const master = await createMaster();
  const masterActor = { isMaster: true, role: null, userId: master.id };
  const { organization: org, invite } = await createOrganization(db, masterActor, {
    name: "Loja Senha",
    adminEmail: "admin@senha.com",
    adminName: "Admin",
  });
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const inv = await createInvitation(db, admin, org.id, { email: "vend@senha.com", role: "seller" });
  const s = await acceptInvitation(db, { token: inv.token, name: "Paula Vendedora", password: "senha1234" });
  const seller = { isMaster: false, role: "seller" as const, userId: s.userId };
  const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
  await fake.scan(row?.instanceName ?? "");
  await refreshConnection(db, evo, admin, org.id, conn.id);
  return { org, admin, seller, masterActor };
}
const tokenFromLink = (text: string) => text.match(/redefinir-senha\?t=([\w-]+)/)?.[1] ?? "";

describe("esqueci minha senha", () => {
  it("manda o link pelo WhatsApp, troca a senha, derruba sessões e não reaproveita o link", async () => {
    const { seller } = await setup();
    // Sem WhatsApp cadastrado: não manda (e a tela responde igual).
    expect(await requestPasswordReset(db, evo, "vend@senha.com")).toBe(false);
    await setMyPhone(db, seller.userId, "48988887777");
    expect(await requestPasswordReset(db, evo, "nao-existe@senha.com")).toBe(false);
    expect(await requestPasswordReset(db, evo, " VEND@senha.com ")).toBe(true);
    const msg = fake.sent.at(-1);
    expect(msg?.to).toContain("48988887777");
    const text = String(msg?.body.text ?? "");
    expect(text).toContain("https://crm.exemplo.com/redefinir-senha?t=");
    const token = tokenFromLink(text);
    // O banco guarda só o hash.
    const [stored] = await db.select().from(passwordResets);
    expect(stored?.tokenHash).not.toBe(token);

    await login(db, { email: "vend@senha.com", password: "senha1234" });
    await db.insert(loginAttempts).values({ email: "vend@senha.com", success: false });
    expect(await checkResetToken(db, token)).toMatchObject({ email: "vend@senha.com" });
    await expect(resetPassword(db, token, "curta")).rejects.toThrow(/8 caracteres/);
    await resetPassword(db, token, "novaSenha99");
    expect(await db.select().from(sessions).where(eq(sessions.userId, seller.userId))).toHaveLength(0);
    await expect(login(db, { email: "vend@senha.com", password: "senha1234" })).rejects.toThrow();
    expect(await login(db, { email: "vend@senha.com", password: "novaSenha99" })).toHaveProperty("token");
    await expect(resetPassword(db, token, "outraSenha1")).rejects.toThrow(/vencido ou já usado/);
    expect(await checkResetToken(db, token)).toBeNull();
  });

  it("limita a 3 pedidos por hora e o link vence em 30 minutos", async () => {
    const { seller } = await setup();
    await setMyPhone(db, seller.userId, "48988887777");
    for (let i = 0; i < 3; i++) expect(await requestPasswordReset(db, evo, "vend@senha.com")).toBe(true);
    expect(await requestPasswordReset(db, evo, "vend@senha.com")).toBe(false);
    const token = tokenFromLink(String(fake.sent.at(-1)?.body.text ?? ""));
    await db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(resetPassword(db, token, "novaSenha99")).rejects.toThrow(/vencido/);
  });

  it("administrador gera link para a equipe, com limites", async () => {
    const { org, admin, seller, masterActor } = await setup();
    const r = await createResetLinkForMember(db, admin, org.id, seller.userId);
    expect(r.link).toMatch(/^https:\/\/crm\.exemplo\.com\/redefinir-senha\?t=/);
    await resetPassword(db, tokenFromLink(r.link), "trocada123");
    await expect(createResetLinkForMember(db, seller, org.id, admin.userId)).rejects.toThrow(
      /administradores/,
    );
    await expect(createResetLinkForMember(db, admin, org.id, admin.userId)).rejects.toThrow(/Conta/);
    await expect(createResetLinkForMember(db, admin, org.id, masterActor.userId)).rejects.toThrow();
    // Quem também está em outra empresa não pode ter a senha trocada por este admin.
    const { invite } = await createOrganization(db, masterActor, {
      name: "Outra Loja",
      adminEmail: "vend@senha.com",
      adminName: "Paula",
    });
    await acceptInvitation(db, { token: invite.token, password: "trocada123" });
    await expect(createResetLinkForMember(db, admin, org.id, seller.userId)).rejects.toThrow(/outra empresa/);
  });
});
