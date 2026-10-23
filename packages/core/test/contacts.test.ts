import { contacts, conversations } from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createConnection,
  createContact,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  deleteContact,
  exportContactsCsv,
  getContact,
  handleEvolutionWebhook,
  importContactsCsv,
  listContacts,
  parseCsv,
  phoneVariants,
  refreshConnection,
  updateContact,
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
  const masterActor = { isMaster: true, role: null, userId: master.id };
  const { organization: org, invite } = await createOrganization(db, masterActor, {
    name: "Loja Contatos",
    adminEmail: "admin@c.com",
    adminName: "Admin C",
  });
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin C", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const inv = await createInvitation(db, admin, org.id, { email: "v@c.com", role: "seller" });
  const s = await acceptInvitation(db, { token: inv.token, name: "Vendedor C", password: "venda1234" });
  const seller = { isMaster: false, role: "seller" as const, userId: s.userId };
  return { org, admin, seller, masterActor };
}

const EXPORT_ANTIGO = `﻿nome;email;telefone
Edileuza;;554899253654
Michael Imoveis;michael@imoveis.com;554898275000
554899794780;;554899794780
Cris diplomata;;554796529447
Duplicado;;5548999253654
Sem telefone;x@y.com;
Inválido;;12345
`;

describe("CSV", () => {
  it("lê ; ou , com aspas e BOM", () => {
    expect(parseCsv('﻿a;b\n"x;1";"di""z"\n')).toEqual([
      ["a", "b"],
      ["x;1", 'di"z'],
    ]);
    expect(parseCsv("a,b\r\n1,2\r\n\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("variações do 9", () => {
    expect(phoneVariants("5548999253654")).toEqual(["5548999253654", "554899253654"]);
    expect(phoneVariants("554899253654")).toEqual(["554899253654", "5548999253654"]);
    expect(phoneVariants("554834331234")).toEqual(["554834331234"]);
  });
});

describe("contatos", () => {
  it("cria, não duplica pelo telefone (com ou sem 9), edita e lista com busca", async () => {
    const { org, seller } = await setup();
    const id = await createContact(db, seller, org.id, {
      name: "Maria",
      phone: "(48) 99925-3654",
      email: "MARIA@X.COM",
    });
    await expect(createContact(db, seller, org.id, { name: "Outra", phone: "48 9925-3654" })).rejects.toThrow(
      /Já existe/,
    );
    await updateContact(db, seller, org.id, id, { name: "Maria Silva", email: "" });
    const c = await getContact(db, seller, org.id, id);
    expect(c).toMatchObject({ name: "Maria Silva", email: null, phone: "5548999253654", waVerified: false });
    await createContact(db, seller, org.id, { name: "João", phone: "11 98888-7777" });
    expect((await listContacts(db, seller, org.id, { q: "silva" })).items.map((x) => x.name)).toEqual([
      "Maria Silva",
    ]);
    expect((await listContacts(db, seller, org.id, { q: "98888" })).items.map((x) => x.name)).toEqual([
      "João",
    ]);
    expect((await listContacts(db, seller, org.id)).total).toBe(2);
  });

  it("importa o export do sistema antigo sem duplicar e relata linhas ruins", async () => {
    const { org, admin, seller } = await setup();
    await expect(importContactsCsv(db, seller, org.id, EXPORT_ANTIGO)).rejects.toThrow(
      /administradores e gestores/,
    );
    const r = await importContactsCsv(db, admin, org.id, EXPORT_ANTIGO);
    expect(r).toMatchObject({ total: 7, created: 4, existing: 1 });
    expect(r.invalid.map((i) => i.line)).toEqual([7, 8]);
    const list = await listContacts(db, admin, org.id);
    const byPhone = Object.fromEntries(list.items.map((c) => [c.phone, c]));
    expect(byPhone["554899253654"]?.name).toBe("Edileuza"); // guardado como veio, sem forçar o 9
    expect(byPhone["554899794780"]?.name).toBeNull(); // nome igual ao número vira sem nome
    expect(byPhone["554898275000"]?.email).toBe("michael@imoveis.com");

    // Reimportar não duplica; completa o que faltava
    const r2 = await importContactsCsv(
      db,
      admin,
      org.id,
      "nome;email;telefone\nIgor;igor@x.com;554899794780\n",
    );
    expect(r2).toMatchObject({ created: 0, existing: 1 });
    expect((await listContacts(db, admin, org.id, { q: "igor" })).items[0]?.email).toBe("igor@x.com");
  });

  it("aceita o modelo de importação e conta as linhas de negociação", async () => {
    const { org, admin } = await setup();
    const modelo = `nome;telefone;fixo;email;tipo;titulo_negociacao
Maria Silva;11 99999-9999;;maria@email.com;criar_negociacao;Consulta Maria
João Souza;11 3333-4444;sim;;apenas_contato;
`;
    const r = await importContactsCsv(db, admin, org.id, modelo);
    expect(r).toMatchObject({ created: 2, dealRows: 1 });
    const phones = (await listContacts(db, admin, org.id)).items.map((c) => c.phone).sort();
    expect(phones).toEqual(["551133334444", "5511999999999"]);
  });

  it("exporta no mesmo formato e só admin/gestor exporta ou exclui", async () => {
    const { org, admin, seller } = await setup();
    await importContactsCsv(db, admin, org.id, EXPORT_ANTIGO);
    const csv = await exportContactsCsv(db, admin, org.id);
    expect(csv.startsWith("﻿nome;email;telefone\r\n")).toBe(true);
    expect(csv).toContain("Edileuza;;554899253654");
    await expect(exportContactsCsv(db, seller, org.id)).rejects.toThrow(/administradores/);
    const [first] = (await listContacts(db, admin, org.id)).items;
    await expect(deleteContact(db, seller, org.id, first?.id ?? "")).rejects.toThrow(/administradores/);
    await deleteContact(db, admin, org.id, first?.id ?? "");
    expect((await listContacts(db, admin, org.id)).total).toBe(3);
  });

  it("contato importado sem o 9 vira o mesmo contato quando a pessoa escreve no WhatsApp", async () => {
    const { org, admin } = await setup();
    await importContactsCsv(db, admin, org.id, "nome;email;telefone\nEdileuza;;5548999253654\n");
    const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
    const row = await db.query.whatsappConnections.findFirst({ where: (t, { eq: e }) => e(t.id, conn.id) });
    await fake.scan(row?.instanceName ?? "");
    await refreshConnection(db, evo, admin, org.id, conn.id);
    const token =
      new URL(fake.instances.get(row?.instanceName ?? "")?.webhook ?? "").searchParams.get("t") ?? "";
    // O WhatsApp entrega o número sem o 9
    await handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance: row?.instanceName,
      data: {
        key: { id: "W1", remoteJid: "554899253654@s.whatsapp.net", fromMe: false },
        pushName: "Edi",
        message: { conversation: "oi" },
      },
    });
    const all = await db.select().from(contacts).where(eq(contacts.organizationId, org.id));
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      name: "Edileuza",
      waJid: "554899253654@s.whatsapp.net",
      waVerified: true,
    });
    const convs = await db
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, all[0]?.id ?? ""));
    expect(convs).toHaveLength(1);
  });

  it("empresa não vê contato de outra", async () => {
    const { org, admin, masterActor } = await setup();
    const id = await createContact(db, admin, org.id, { name: "Maria", phone: "48 99925-3654" });
    const other = await createOrganization(db, masterActor, {
      name: "Outra",
      adminEmail: "o@o.com",
      adminName: "Outro Admin",
    });
    await expect(getContact(db, masterActor, other.organization.id, id)).rejects.toThrow(/não encontrado/);
    await expect(updateContact(db, masterActor, other.organization.id, id, { name: "X" })).rejects.toThrow(
      /não encontrado/,
    );
  });
});
