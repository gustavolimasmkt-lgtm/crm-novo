import { dealEvents, deals, dealTags } from "@crm/db";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  bulkDeals,
  createDeal,
  createInvitation,
  createOrganization,
  deleteInactivityRule,
  exportDealsCsv,
  listDeals,
  listInactivityRules,
  listPipelines,
  previewInactivityRule,
  processInactivity,
  saveInactivityRule,
  saveTag,
  setDealQualification,
} from "../src/index.js";
import { createMaster, db, resetDb } from "./helpers.js";

beforeEach(resetDb);

async function setup() {
  const master = await createMaster();
  const { organization: org, invite } = await createOrganization(
    db,
    { isMaster: true, role: null, userId: master.id },
    { name: "Loja Lista", adminEmail: "admin@lista.com", adminName: "Admin" },
  );
  const a = await acceptInvitation(db, { token: invite.token, name: "Admin", password: "admin1234" });
  const admin = { isMaster: false, role: "admin" as const, userId: a.userId };
  const inv = await createInvitation(db, admin, org.id, { email: "v@lista.com", role: "seller" });
  const s = await acceptInvitation(db, { token: inv.token, name: "Vendedor", password: "senha1234" });
  const seller = { isMaster: false, role: "seller" as const, userId: s.userId };
  return { org, admin, seller };
}

/** Deixa a negociação parada há N dias. */
const age = (id: string, days: number) =>
  db
    .update(deals)
    .set({
      createdAt: sql`now() - make_interval(days => ${days})`,
      stageChangedAt: sql`now() - make_interval(days => ${days})`,
    })
    .where(eq(deals.id, id));

describe("lista do CRM", () => {
  it("filtra, ordena, pagina e respeita o que o vendedor vê", async () => {
    const { org, admin, seller } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 55; i++)
      ids.push(
        await createDeal(db, admin, org.id, {
          phone: `4899900${String(1000 + i)}`,
          contactName: `Cliente ${i}`,
          interest: i % 2 ? "Onix 2020" : "HR-V 2019",
          valueCents: i * 100,
          assignedUserId: i < 5 ? seller.userId : admin.userId,
        }),
      );
    const all = await listDeals(db, admin, org.id, {});
    expect(all.total).toBe(55);
    expect(all.rows).toHaveLength(50);
    expect((await listDeals(db, admin, org.id, { page: 2 })).rows).toHaveLength(5);
    expect((await listDeals(db, admin, org.id, { q: "onix" })).total).toBe(27);
    const byValue = await listDeals(db, admin, org.id, { sort: "value", dir: "desc" });
    expect(byValue.rows[0]?.valueCents).toBe(5400);
    // Vendedor: só as dele (as outras têm dono).
    expect((await listDeals(db, seller, org.id, {})).total).toBe(5);
    expect((await listDeals(db, admin, org.id, { assignedUserId: seller.userId })).total).toBe(5);

    await setDealQualification(db, admin, org.id, ids[0] ?? "", "qualified");
    expect((await listDeals(db, admin, org.id, { qualification: "qualified" })).total).toBe(1);
    expect((await listDeals(db, admin, org.id, { qualification: "none" })).total).toBe(54);

    await age(ids[1] ?? "", 10);
    const idle = await listDeals(db, admin, org.id, { idleDays: 7 });
    expect(idle.rows.map((r) => r.id)).toEqual([ids[1]]);
    expect(idle.rows[0]?.idleDays).toBe(10);

    const today = new Date().toISOString().slice(0, 10);
    expect((await listDeals(db, admin, org.id, { createdFrom: today })).total).toBe(54);
    await expect(listDeals(db, admin, org.id, { createdFrom: "ontem" })).rejects.toThrow();
  });

  it("exporta o filtrado (só gestor) com carro, etapa e dias parada", async () => {
    const { org, admin, seller } = await setup();
    await createDeal(db, admin, org.id, {
      phone: "48999001111",
      contactName: "Ana",
      interest: "Corolla 2019",
    });
    await createDeal(db, admin, org.id, { phone: "48999002222", contactName: "Beto", interest: "Onix" });
    const csv = await exportDealsCsv(db, admin, org.id, { q: "corolla" });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Carro / interesse");
    expect(lines[1]).toContain("Corolla 2019");
    expect(lines[1]).toContain("Novo lead");
    await expect(exportDealsCsv(db, seller, org.id, {})).rejects.toThrow(/exportam/);
  });

  it("ações em massa: move, atribui, etiqueta, qualifica e exclui com as mesmas regras", async () => {
    const { org, admin, seller } = await setup();
    const ids = await Promise.all(
      [1, 2, 3].map((i) => createDeal(db, admin, org.id, { phone: `4899900300${i}`, assignedUserId: null })),
    );
    const [p] = await listPipelines(db, org.id);
    const proposta = p?.stages.find((s) => s.name === "Proposta");
    expect(
      await bulkDeals(db, seller, org.id, { ids }, { type: "move", stageId: proposta?.id ?? "" }),
    ).toMatchObject({ total: 3, done: 3 });
    const moved = await db.select().from(dealEvents).where(eq(dealEvents.type, "stage"));
    expect(moved).toHaveLength(3);

    await expect(
      bulkDeals(db, seller, org.id, { ids }, { type: "assign", userId: seller.userId }),
    ).rejects.toThrow(/gestores/);
    await bulkDeals(
      db,
      admin,
      org.id,
      { filter: { stageId: proposta?.id } },
      { type: "assign", userId: seller.userId },
    );
    expect((await listDeals(db, admin, org.id, { assignedUserId: seller.userId })).total).toBe(3);

    await saveTag(db, admin, org.id, { name: "Feirão" });
    await bulkDeals(db, seller, org.id, { ids: ids.slice(0, 2) }, { type: "tag", name: "feirão" });
    expect(await db.select().from(dealTags)).toHaveLength(2);

    await bulkDeals(
      db,
      seller,
      org.id,
      { ids },
      { type: "qualify", value: "disqualified", reason: "Sem entrada" },
    );
    expect((await listDeals(db, admin, org.id, { qualification: "disqualified" })).total).toBe(3);

    await expect(bulkDeals(db, seller, org.id, { ids }, { type: "delete" })).rejects.toThrow(/excluem/);
    expect(await bulkDeals(db, admin, org.id, { ids: [...ids, "lixo"] }, { type: "delete" })).toMatchObject({
      done: 3,
    });
    expect(await db.select().from(deals)).toHaveLength(0);
    await expect(bulkDeals(db, admin, org.id, { ids: [] }, { type: "delete" })).rejects.toThrow(/Nenhuma/);
  });
});

describe("mover por inatividade", () => {
  it("move quem está parado, registra no histórico e não mexe em fechadas", async () => {
    const { org, admin, seller } = await setup();
    const [p] = await listPipelines(db, org.id);
    const stage = (n: string) => p?.stages.find((s) => s.name === n)?.id ?? "";
    const old = await createDeal(db, admin, org.id, { phone: "48999004001" });
    const fresh = await createDeal(db, admin, org.id, { phone: "48999004002" });
    const won = await createDeal(db, admin, org.id, { phone: "48999004003", stageId: stage("Ganho") });
    await age(old, 5);
    await age(won, 5);
    const rule = {
      pipelineId: p?.id ?? "",
      fromStageIds: [] as string[],
      days: 3,
      toStageId: stage("Perdido"),
    };
    await expect(saveInactivityRule(db, seller, org.id, rule)).rejects.toThrow(/gestores/);
    expect(await previewInactivityRule(db, admin, org.id, rule)).toBe(1);
    const id = await saveInactivityRule(db, admin, org.id, rule);
    expect(await listInactivityRules(db, org.id)).toHaveLength(1);

    expect(await processInactivity(db)).toBe(1);
    expect(await processInactivity(db)).toBe(0);
    const d = await db.query.deals.findFirst({ where: eq(deals.id, old) });
    expect(d?.stageId).toBe(stage("Perdido"));
    const ev = await db.select().from(dealEvents).where(eq(dealEvents.dealId, old));
    expect(ev.find((e) => e.type === "stage")?.data).toMatchObject({
      to: "Perdido",
      via: "parada há 3+ dias",
    });
    expect((await db.query.deals.findFirst({ where: eq(deals.id, fresh) }))?.stageId).toBe(
      stage("Novo lead"),
    );
    expect((await db.query.deals.findFirst({ where: eq(deals.id, won) }))?.stageId).toBe(stage("Ganho"));

    // Só das etapas escolhidas; destino de outro funil é recusado.
    await age(fresh, 5);
    await saveInactivityRule(db, admin, org.id, { ...rule, fromStageIds: [stage("Proposta")] }, id);
    expect(await processInactivity(db)).toBe(0);
    await expect(
      saveInactivityRule(db, admin, org.id, { ...rule, toStageId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(/mesmo funil/);
    await deleteInactivityRule(db, admin, org.id, id ?? "");
    expect(await listInactivityRules(db, org.id)).toHaveLength(0);
  });
});
