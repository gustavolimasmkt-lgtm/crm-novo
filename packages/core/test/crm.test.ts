import { dealEvents, deals, whatsappConnections } from "@crm/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  addDealNote,
  addStage,
  assignConversation,
  assignDeal,
  createConnection,
  createDeal,
  createEvolutionClient,
  createInvitation,
  createOrganization,
  deleteDeal,
  deletePipeline,
  deleteStage,
  formatCents,
  getBoard,
  getDeal,
  handleEvolutionWebhook,
  importDealsCsv,
  listConversations,
  listPipelines,
  moveDeal,
  moveStage,
  parseBrDate,
  parseMoneyToCents,
  refreshConnection,
  setDealTags,
  updateDeal,
  updatePipeline,
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
    name: "Loja CRM",
    adminEmail: "admin@crm.com",
    adminName: "Admin CRM",
  });
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin CRM", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const mk = async (email: string, name: string, role: "seller" | "agent" | "manager") => {
    const inv = await createInvitation(db, admin, org.id, { email, role });
    const u = await acceptInvitation(db, { token: inv.token, name, password: "senha1234" });
    return { isMaster: false, role, userId: u.userId };
  };
  return { org, admin, masterActor, mk };
}

async function withConnection(
  org: { id: string },
  admin: { isMaster: boolean; role: "admin"; userId: string },
) {
  const conn = await createConnection(db, evo, admin, org.id, { name: "Loja" }, "https://crm.exemplo.com");
  const row = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, conn.id) });
  const instance = row?.instanceName ?? "";
  await fake.scan(instance);
  await refreshConnection(db, evo, admin, org.id, conn.id);
  const token = new URL(fake.instances.get(instance)?.webhook ?? "").searchParams.get("t") ?? "";
  const say = (id: string, from: string, text: string) =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
        pushName: "Cliente",
        message: { conversation: text },
      },
    });
  return { conn, say };
}

describe("valores e datas", () => {
  it("converte dinheiro e datas brasileiras", () => {
    expect(parseMoneyToCents("1.500,00")).toBe(150000);
    expect(parseMoneyToCents("1500")).toBe(150000);
    expect(parseMoneyToCents("R$ 64.900")).toBe(6490000);
    expect(parseMoneyToCents("1500.5")).toBe(150050);
    expect(parseMoneyToCents("")).toBe(0);
    expect(formatCents(6490000).replace(/\s/g, " ")).toBe("R$ 64.900,00");
    expect(parseBrDate("20/10/2026, 11:10")?.toISOString()).toBe("2026-10-20T14:10:00.000Z");
    expect(parseBrDate("15/03/2025")?.toISOString()).toBe("2025-03-15T03:00:00.000Z");
    expect(parseBrDate("ontem")).toBeNull();
  });
});

describe("funil e negociações", () => {
  it("cria funil padrão e lead automático para quem escreve pela primeira vez", async () => {
    const { org, admin } = await setup();
    const { say } = await withConnection(org, admin);
    await say("A1", "5548999990001", "Oi, quero o Tiggo");
    await say("A2", "5548999990001", "Ainda tem?");
    const board = await getBoard(db, admin, org.id);
    expect(board.pipeline.name).toBe("Funil de Vendas");
    expect(board.stages.map((s) => s.name)).toEqual([
      "Novo lead",
      "Em atendimento",
      "Qualificado",
      "Visita agendada",
      "Proposta",
      "Ganho",
      "Perdido",
    ]);
    expect(board.stages[0]?.deals).toHaveLength(1);
    const d = await getDeal(db, admin, org.id, board.stages[0]?.deals[0]?.id ?? "");
    expect(d).toMatchObject({ number: 1, title: "Cliente", contact: { phone: "5548999990001" } });
    expect(d.conversationId).toBeTruthy();

    // Perdeu: nova mensagem não cria outra sozinha
    const lost = board.stages.find((s) => s.kind === "lost");
    await moveDeal(db, admin, org.id, d.id, lost?.id ?? "");
    await say("A3", "5548999990001", "voltei");
    expect(await db.select().from(deals)).toHaveLength(1);
    expect((await getDeal(db, admin, org.id, d.id)).closedAt).toBeInstanceOf(Date);
  });

  it("cria por telefone, numera em sequência, move, anota e guarda histórico", async () => {
    const { org, mk } = await setup();
    const seller = await mk("v@crm.com", "Vendedor Um", "seller");
    const id1 = await createDeal(db, seller, org.id, {
      phone: "48 99888-7766",
      contactName: "Paulo",
      valueCents: 6490000,
    });
    const id2 = await createDeal(db, seller, org.id, { phone: "48 99888-7755", title: "Onix 2020" });
    const d1 = await getDeal(db, seller, org.id, id1);
    expect(d1).toMatchObject({
      number: 1,
      title: "Paulo",
      valueCents: 6490000,
      assignedUserId: seller.userId,
    });
    expect((await getDeal(db, seller, org.id, id2)).number).toBe(2);
    const [p] = await listPipelines(db, org.id);
    const proposta = p?.stages.find((s) => s.name === "Proposta");
    await moveDeal(db, seller, org.id, id1, proposta?.id ?? "");
    await updateDeal(db, seller, org.id, id1, { valueCents: 6300000 });
    await addDealNote(db, seller, org.id, id1, "Cliente pediu desconto");
    const ev = await db.select().from(dealEvents).where(eq(dealEvents.dealId, id1));
    expect(ev.map((e) => e.type).sort()).toEqual(["created", "note", "stage", "value"]);
  });

  it("carro / interesse: grava, aparece no card, entra na busca e no histórico", async () => {
    const { org, mk } = await setup();
    const seller = await mk("v@crm.com", "Vendedor Um", "seller");
    const id = await createDeal(db, seller, org.id, { phone: "48 99888-7766", interest: "HR-V prata 2020" });
    expect((await getDeal(db, seller, org.id, id)).interest).toBe("HR-V prata 2020");
    await updateDeal(db, seller, org.id, id, { interest: "Corolla 2019" });
    const card = (await getBoard(db, seller, org.id)).stages.flatMap((s) => s.deals).find((d) => d.id === id);
    expect(card?.interest).toBe("Corolla 2019");
    const found = (await getBoard(db, seller, org.id, { q: "corolla" })).stages.flatMap((s) => s.deals);
    expect(found.map((d) => d.id)).toEqual([id]);
    await updateDeal(db, seller, org.id, id, { interest: "" });
    expect((await getDeal(db, seller, org.id, id)).interest).toBeNull();
    const ev = await db.select().from(dealEvents).where(eq(dealEvents.dealId, id));
    expect(ev.filter((e) => e.type === "interest")).toHaveLength(2);
  });

  it("vendedor vê as dele e sem dono; atendente não vê valores; só gestor redistribui", async () => {
    const { org, admin, mk } = await setup();
    const s1 = await mk("s1@crm.com", "Vendedor A", "seller");
    const s2 = await mk("s2@crm.com", "Vendedor B", "seller");
    const ag = await mk("ag@crm.com", "Atendente", "agent");
    const mine = await createDeal(db, s1, org.id, { phone: "48 99000-0001", valueCents: 100 });
    const other = await createDeal(db, s2, org.id, { phone: "48 99000-0002", valueCents: 200 });
    const free = await createDeal(db, admin, org.id, {
      phone: "48 99000-0003",
      valueCents: 300,
      assignedUserId: null,
    });
    const ids = (await getBoard(db, s1, org.id)).stages.flatMap((s) => s.deals.map((d) => d.id)).sort();
    expect(ids).toEqual([mine, free].sort());
    await expect(getDeal(db, s1, org.id, other)).rejects.toThrow(/não encontrada/);
    const agBoard = await getBoard(db, ag, org.id);
    expect(agBoard.showValues).toBe(false);
    expect(agBoard.stages[0]?.deals.every((d) => d.valueCents === null)).toBe(true);
    await expect(updateDeal(db, ag, org.id, free, { valueCents: 1 })).rejects.toThrow(/valores/);

    await expect(assignDeal(db, s1, org.id, free, s2.userId)).rejects.toThrow(/só pode assumir/);
    await assignDeal(db, s1, org.id, free, s1.userId);
    const mgr = await mk("g@crm.com", "Gestor", "manager");
    await assignDeal(db, mgr, org.id, free, s2.userId);
    expect((await getDeal(db, mgr, org.id, free)).assignedUserId).toBe(s2.userId);
    await expect(deleteDeal(db, s1, org.id, mine)).rejects.toThrow(/administradores e gestores/);
    await deleteDeal(db, mgr, org.id, mine);
  });

  it("puxar a conversa leva junto a negociação sem dono", async () => {
    const { org, admin, mk } = await setup();
    const seller = await mk("v2@crm.com", "Vendedor Dois", "seller");
    const { say } = await withConnection(org, admin);
    await say("B1", "5548999990002", "Oi");
    const [c] = await listConversations(db, seller, org.id);
    await assignConversation(db, seller, org.id, c?.id ?? "", seller.userId);
    const board = await getBoard(db, seller, org.id);
    expect(board.stages[0]?.deals[0]?.assignedUserId).toBe(seller.userId);
  });

  it("etiquetas: todos aplicam as existentes; só gestor/admin cria novas", async () => {
    const { org, admin, mk } = await setup();
    const seller = await mk("v3@crm.com", "Vendedor Tres", "seller");
    const id = await createDeal(db, seller, org.id, { phone: "48 99000-0010" });
    await setDealTags(db, admin, org.id, id, ["Lead quente", "Tem troca"]);
    await setDealTags(db, seller, org.id, id, ["lead quente", "Inventada"]);
    expect((await getDeal(db, seller, org.id, id)).tags.map((t) => t.name)).toEqual(["Lead quente"]);
    const board = await getBoard(db, seller, org.id, {
      tagId: (await getDeal(db, seller, org.id, id)).tags[0]?.id,
    });
    expect(board.stages[0]?.deals).toHaveLength(1);
  });

  it("configura etapas e funis com proteções", async () => {
    const { org, admin, mk } = await setup();
    const seller = await mk("v4@crm.com", "Vendedor Quatro", "seller");
    const [p] = await listPipelines(db, org.id);
    const pid = p?.id ?? "";
    await expect(addStage(db, seller, org.id, pid, { name: "X" })).rejects.toThrow(/configuram/);
    const sid = await addStage(db, admin, org.id, pid, {
      name: "Financiamento",
      kind: "open",
      color: "#ff0000",
    });
    await moveStage(db, admin, org.id, sid ?? "", "up");
    const names = (await listPipelines(db, org.id))[0]?.stages.map((s) => s.name);
    expect(names?.at(-2)).toBe("Financiamento");
    const dealId = await createDeal(db, admin, org.id, { phone: "48 99000-0020", stageId: sid });
    await expect(deleteStage(db, admin, org.id, sid ?? "")).rejects.toThrow(/tem 1 negociações/);
    await deleteDeal(db, admin, org.id, dealId);
    await deleteStage(db, admin, org.id, sid ?? "");
    await expect(deletePipeline(db, admin, org.id, pid)).rejects.toThrow(/padrão/);
    const { createPipeline } = await import("../src/index.js");
    const p2 = await createPipeline(db, admin, org.id, "Pós-venda");
    await updatePipeline(db, admin, org.id, p2, { isDefault: true });
    const all = await listPipelines(db, org.id);
    expect(all.filter((x) => x.isDefault).map((x) => x.name)).toEqual(["Pós-venda"]);
    await deletePipeline(db, admin, org.id, pid);
    expect((await listPipelines(db, org.id)).map((x) => x.name)).toEqual(["Pós-venda"]);
  });
});

describe("importação de negociações", () => {
  const EXPORT = `﻿ID;Título;Valor;Funil;Etapa;Fonte;Responsável;Departamento;Anúncio;Score;Etiquetas;Produtos;Contato;Telefone;E-mail;Criado em;Atualizado em;Cidade;Veículo de Interesse
3922203;554896960229;0;Funil Comercial Automotivo;NOVO LEAD;;Kauã;;;;;;554896960229;554896960229;;20/10/2026, 11:10;20/10/2026, 11:10;;
3918370;Edileuza;64900;Funil Comercial Automotivo;NOVO LEAD;FB_Ads;Admin CRM;;👉 Chama;;LEAD QUENTE;;Edileuza;554899253654;;20/10/2026, 08:57;20/10/2026, 08:57;Criciúma;Tiggo 2
3900001;Paulo;1.250,50;Funil Comercial Automotivo;VENDA GANHA;Indicação;;;;;;;Paulo;554888887777;paulo@x.com;01/10/2026, 10:00;;;
3900002;Sem fone;0;Funil Comercial Automotivo;PERDIDO;;;;;;;;Sem fone;;;01/10/2026;;;
`;

  it("importa o export antigo criando funil, etapas, fontes e etiquetas; reimportar não duplica", async () => {
    const { org, admin } = await setup();
    const r = await importDealsCsv(db, admin, org.id, EXPORT);
    expect(r).toMatchObject({ total: 4, created: 3, skipped: 0 });
    expect(r.invalid.map((i) => i.line)).toEqual([5]);
    expect(r.unknownOwners).toEqual(["Kauã"]);
    expect(r.createdStages).toEqual([
      "Funil Funil Comercial Automotivo",
      "Funil Comercial Automotivo → NOVO LEAD",
      "Funil Comercial Automotivo → VENDA GANHA",
    ]);

    const all = await listPipelines(db, org.id);
    const auto = all.find((p) => p.name === "Funil Comercial Automotivo");
    expect(auto?.stages.map((s) => [s.name, s.kind])).toEqual([
      ["NOVO LEAD", "open"],
      ["VENDA GANHA", "won"],
    ]);
    const board = await getBoard(db, admin, org.id, { pipelineId: auto?.id });
    const edi = board.stages[0]?.deals.find((d) => d.title === "Edileuza");
    const d = await getDeal(db, admin, org.id, edi?.id ?? "");
    expect(d).toMatchObject({
      valueCents: 6490000,
      assignedUserId: admin.userId,
      contact: { name: "Edileuza", phone: "554899253654" },
    });
    expect(d.tags.map((t) => t.name)).toEqual(["LEAD QUENTE"]);
    expect(d.extra).toMatchObject({
      "ID de origem": "3918370",
      Cidade: "Criciúma",
      "Veículo de Interesse": "Tiggo 2",
    });
    expect(d.createdAt.toISOString()).toBe("2026-10-20T11:57:00.000Z");
    const paulo = board.stages[1]?.deals[0];
    expect(paulo?.valueCents).toBe(125050);

    const again = await importDealsCsv(db, admin, org.id, EXPORT);
    expect(again).toMatchObject({ created: 0, skipped: 3 });
  });

  it("aceita o modelo: só contato, negociação, recorrente", async () => {
    const { org, admin, mk } = await setup();
    const seller = await mk("vv@crm.com", "Vendedor Modelo", "seller");
    await expect(importDealsCsv(db, seller, org.id, "telefone\n1")).rejects.toThrow(/configuram/);
    const modelo = `nome;telefone;fixo;email;tipo;titulo_negociacao;valor;funil;estagio;fonte;etiquetas;produtos;id_usuario;id_departamento;id_whatsapp;descricao;tipo_valor;valor_implantacao;valor_mensalidade;data_criacao;campo:Plano
Maria Silva;11 99999-9999;;maria@email.com;criar_negociacao;Consulta Maria;1500;;;Site;"VIP;Indicação";;admin@crm.com;;;Pediu orçamento;recorrente;1000;100;15/03/2025;Premium
João Souza;11 3333-4444;sim;;apenas_contato;;;;;;;;;;;;;;;;
`;
    const r = await importDealsCsv(db, admin, org.id, modelo);
    expect(r).toMatchObject({ created: 1, contactsOnly: 1 });
    const board = await getBoard(db, admin, org.id);
    const d = await getDeal(db, admin, org.id, board.stages[0]?.deals[0]?.id ?? "");
    expect(d).toMatchObject({
      title: "Consulta Maria",
      valueType: "recurring",
      valueCents: 220000,
      setupCents: 100000,
      monthlyCents: 10000,
      description: "Pediu orçamento",
    });
    expect(d.tags.map((t) => t.name).sort()).toEqual(["Indicação", "VIP"]);
    expect(d.extra).toMatchObject({ Plano: "Premium" });
  });
});
