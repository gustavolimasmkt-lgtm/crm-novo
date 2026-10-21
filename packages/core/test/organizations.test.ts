import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  createOrganization,
  getSession,
  listMembers,
  listMyOrganizations,
  login,
  setOrganizationStatus,
  switchOrganization,
  updateMember,
} from "../src/index.js";
import { createMaster, db, resetDb } from "./helpers.js";

beforeEach(resetDb);

async function setupOrg(name = "GreenCar") {
  const master = await createMaster();
  const actor = { isMaster: true, role: null, userId: master.id };
  const { organization, invite } = await createOrganization(db, actor, {
    name,
    adminEmail: "admin@greencar.com",
    adminName: "Admin GreenCar",
  });
  return { master, actor, organization, invite };
}

describe("empresas e convites", () => {
  it("só o master cria empresa", async () => {
    await expect(
      createOrganization(
        db,
        { isMaster: false, role: "admin", userId: crypto.randomUUID() },
        {
          name: "X",
          adminEmail: "a@b.com",
          adminName: "Fulano",
        },
      ),
    ).rejects.toThrow(/Master/);
  });

  it("fluxo completo: criar empresa, aceitar convite, logar, convidar vendedor, trocar de empresa", async () => {
    const { organization, invite, actor } = await setupOrg();
    const accepted = await acceptInvitation(db, {
      token: invite.token,
      name: "Admin",
      password: "senha1234",
    });
    expect(accepted.organizationId).toBe(organization.id);

    await expect(acceptInvitation(db, { token: invite.token, password: "senha1234" })).rejects.toThrow(
      /já foi usado/,
    );

    const { token } = await login(db, { email: "ADMIN@greencar.com", password: "senha1234" });
    const ctx = await getSession(db, token);
    expect(ctx?.organization?.id).toBe(organization.id);
    expect(ctx?.role).toBe("admin");

    const adminActor = { isMaster: false, role: "admin" as const, userId: ctx!.user.id };
    const inv2 = await createInvitation(db, adminActor, organization.id, {
      email: "vendedor@greencar.com",
      role: "seller",
    });
    await acceptInvitation(db, { token: inv2.token, name: "Vendedor", password: "venda1234" });
    const { members } = await listMembers(db, adminActor, organization.id);
    expect(members.map((m) => m.role).sort()).toEqual(["admin", "seller"]);

    // Segunda empresa com o mesmo vendedor
    const { organization: org2, invite: inv3 } = await createOrganization(db, actor, {
      name: "VitóriaMotors",
      adminEmail: "vendedor@greencar.com",
      adminName: "Vendedor",
    });
    await acceptInvitation(db, { token: inv3.token, password: "venda1234" });
    const vLogin = await login(db, { email: "vendedor@greencar.com", password: "venda1234" });
    const vCtx = await getSession(db, vLogin.token);
    const orgs = await listMyOrganizations(db, vCtx!.user.id, false);
    expect(orgs).toHaveLength(2);
    await switchOrganization(db, vCtx!, org2.id);
    const vCtx2 = await getSession(db, vLogin.token);
    expect(vCtx2?.organization?.id).toBe(org2.id);
    expect(vCtx2?.role).toBe("admin");
  });

  it("conta existente precisa da senha atual para aceitar convite", async () => {
    const { invite } = await setupOrg();
    await acceptInvitation(db, { token: invite.token, name: "Admin", password: "senha1234" });
    const master = await db.query.users.findFirst();
    const { organization: o2, invite: i2 } = await createOrganization(
      db,
      { isMaster: true, role: null, userId: master!.id },
      {
        name: "Outra",
        adminEmail: "admin@greencar.com",
        adminName: "Admin",
      },
    );
    await expect(acceptInvitation(db, { token: i2.token, password: "errada123" })).rejects.toThrow(
      /senha atual/,
    );
    const ok = await acceptInvitation(db, { token: i2.token, password: "senha1234" });
    expect(ok.organizationId).toBe(o2.id);
  });

  it("bloqueia após 5 tentativas erradas", async () => {
    await createMaster("m@x.com", "certa1234");
    for (let i = 0; i < 5; i++) {
      await expect(login(db, { email: "m@x.com", password: "errada" })).rejects.toThrow(/incorretos/);
    }
    await expect(login(db, { email: "m@x.com", password: "certa1234" })).rejects.toThrow(/Aguarde/);
  });

  it("empresa suspensa some do acesso de membros, mas não do master", async () => {
    const { organization, invite, actor } = await setupOrg();
    await acceptInvitation(db, { token: invite.token, name: "Admin", password: "senha1234" });
    const { token } = await login(db, { email: "admin@greencar.com", password: "senha1234" });
    await setOrganizationStatus(db, actor, organization.id, "suspended");
    const ctx = await getSession(db, token);
    expect(ctx?.organization).toBeNull();
    const masterOrgs = await listMyOrganizations(db, actor.userId, true);
    expect(masterOrgs).toHaveLength(1);
  });

  it("não deixa a empresa sem administrador", async () => {
    const { organization, invite } = await setupOrg();
    const acc = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "senha1234" });
    const admin = { isMaster: false, role: "admin" as const, userId: acc.userId };
    await expect(updateMember(db, admin, organization.id, acc.userId, { role: "seller" })).rejects.toThrow(
      /próprio/,
    );
  });

  it("vendedor não convida administrador", async () => {
    const { organization } = await setupOrg();
    await expect(
      createInvitation(
        db,
        { isMaster: false, role: "seller", userId: crypto.randomUUID() },
        organization.id,
        {
          email: "x@y.com",
          role: "admin",
        },
      ),
    ).rejects.toThrow(/não pode convidar/);
  });
});

describe("configuração inicial", () => {
  it("cria o master uma vez só e exige o token", async () => {
    const { setupMaster, masterExists } = await import("../src/index.js");
    const token = "t".repeat(32);
    await expect(
      setupMaster(db, {
        token: "errado",
        expectedToken: token,
        name: "G",
        email: "g@x.com",
        password: "senha1234",
      }),
    ).rejects.toThrow(/inválido/);
    await setupMaster(db, {
      token,
      expectedToken: token,
      name: "G",
      email: "g@x.com",
      password: "senha1234",
    });
    expect(await masterExists(db)).toBe(true);
    await expect(
      setupMaster(db, { token, expectedToken: token, name: "G", email: "h@x.com", password: "senha1234" }),
    ).rejects.toThrow(/já foi criado/);
  });
});
