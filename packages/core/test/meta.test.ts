import { capiEvents, deals, metaSettings, pipelineStages, whatsappConnections } from "@crm/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  backfillCapi,
  createAppointment,
  createConnection,
  createEvolutionClient,
  createOrganization,
  getAdsReport,
  getDeal,
  getMetaSettings,
  handleEvolutionWebhook,
  processCapi,
  refreshConnection,
  saveMetaSettings,
  setDealQualification,
  syncAdNames,
  testMetaConnection,
} from "../src/index.js";
import { sha256 } from "../src/secret.js";
import { type FakeEvolution, startFakeEvolution } from "../src/testing/fake-evolution.js";
import { type FakeMeta, startFakeMeta } from "../src/testing/fake-meta.js";
import { createMaster, db, resetDb } from "./helpers.js";

let fake: FakeEvolution;
let meta: FakeMeta;
let evo: ReturnType<typeof createEvolutionClient>;
beforeAll(async () => {
  fake = await startFakeEvolution();
  meta = await startFakeMeta();
  evo = createEvolutionClient({ baseUrl: fake.url, apiKey: fake.apiKey });
  process.env.META_GRAPH_URL = meta.url;
  process.env.APP_SECRET = "segredo-de-teste-com-32-caracteres";
});
afterAll(async () => {
  await fake.close();
  await meta.close();
});
beforeEach(async () => {
  await resetDb();
  meta.events.length = 0;
  meta.failEvents = false;
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
  const fromAd = (from: string, adId = "120001", ctwa = "CLID-123") =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id: `A${++n}-${Date.now()}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
        pushName: "Joana Silva",
        message: {
          extendedTextMessage: {
            text: "Olá! Tenho interesse e queria mais informações, por favor.",
            contextInfo: {
              externalAdReply: {
                title: "HR-V prata 2020",
                body: "Taxa zero",
                sourceType: "ad",
                sourceId: adId,
                sourceUrl: "https://fb.me/abc",
                ctwaClid: ctwa,
              },
              entryPointConversionApp: "instagram",
              conversionSource: "FB_Ads",
            },
          },
        },
      },
    });
  const plain = (from: string) =>
    handleEvolutionWebhook(db, conn.id, token, {
      event: "messages.upsert",
      instance,
      data: {
        key: { id: `P${++n}-${Date.now()}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false },
        pushName: "Pedro",
        message: { conversation: "oi" },
      },
    });
  return { org, admin, fromAd, plain };
}

const settings = {
  capiEnabled: true,
  datasetId: "777000111",
  capiToken: "token-capi",
  testEventCode: "",
  wabaId: "",
  adAccountId: "act_555",
  adsToken: "token-ads",
};

describe("lead de anúncio", () => {
  it("guarda o anúncio, a origem Meta Ads e o ctwa_clid na negociação", async () => {
    const { fromAd, plain } = await setup();
    await fromAd("5548999990001");
    await plain("5548999990002");
    const ds = await db.select().from(deals).orderBy(deals.number);
    expect(ds[0]).toMatchObject({
      adId: "120001",
      adTitle: "HR-V prata 2020",
      adUrl: "https://fb.me/abc",
      adApp: "instagram",
      ctwaClid: "CLID-123",
    });
    expect(ds[1]?.adId).toBeNull();
    const src = await db.query.dealSources.findFirst({
      where: (t, { eq: e }) => e(t.id, ds[0]?.sourceId ?? ""),
    });
    expect(src?.key).toBe("meta_ads");
  });
});

describe("integração Meta", () => {
  it("guarda tokens criptografados, testa a conexão e exige APP_SECRET", async () => {
    const { org, admin } = await setup();
    const keep = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    await expect(saveMetaSettings(db, admin, org.id, settings)).rejects.toThrow(/APP_SECRET/);
    process.env.APP_SECRET = keep;
    await saveMetaSettings(db, admin, org.id, settings);
    const raw = await db.query.metaSettings.findFirst({ where: eq(metaSettings.organizationId, org.id) });
    expect(raw?.capiTokenEnc).not.toContain("token-capi");
    expect(raw?.adAccountId).toBe("555");
    expect(await getMetaSettings(db, org.id)).toMatchObject({
      hasCapiToken: true,
      hasAdsToken: true,
      datasetId: "777000111",
    });
    // Salvar sem token mantém o guardado.
    await saveMetaSettings(db, admin, org.id, { ...settings, capiToken: "", adsToken: "" });
    expect((await getMetaSettings(db, org.id)).hasCapiToken).toBe(true);
    expect(await testMetaConnection(db, admin, org.id)).toEqual([
      { item: "API de Conversões", ok: true, detail: "Conjunto de dados: Pixel da Loja" },
      { item: "Conta de anúncios", ok: true, detail: "Conta GreenCar (BRL)" },
    ]);
    await saveMetaSettings(db, admin, org.id, { ...settings, adsToken: "token-ruim" });
    const t = await testMetaConnection(db, admin, org.id);
    expect(t[1]).toMatchObject({ ok: false, detail: "Invalid OAuth access token." });
    await expect(saveMetaSettings(db, { ...admin, role: "seller" }, org.id, settings)).rejects.toThrow(
      /gestores/,
    );
  });

  it("API de Conversões: Lead, Schedule e Purchase com telefone em hash, uma vez cada", async () => {
    const { org, admin, fromAd, plain } = await setup();
    await plain("5548999990009"); // antes de ligar: não vai
    await saveMetaSettings(db, admin, org.id, settings);
    await new Promise((r) => setTimeout(r, 5));
    await fromAd("5548999990001");
    const deal = (await db.select().from(deals)).find((d) => d.adId);
    const later = new Date(Date.now() + 48 * 3600_000);
    await createAppointment(db, admin, org.id, {
      phone: "5548999990001",
      date: later.toISOString().slice(0, 10),
      time: "10:00",
    });
    const won = await db.query.pipelineStages.findFirst({
      where: and(eq(pipelineStages.pipelineId, deal?.pipelineId ?? ""), eq(pipelineStages.kind, "won")),
    });
    const { moveDeal } = await import("../src/index.js");
    await db
      .update(deals)
      .set({ valueCents: 8_990_000 })
      .where(eq(deals.id, deal?.id ?? ""));
    await moveDeal(db, admin, org.id, deal?.id ?? "", won?.id ?? "");

    expect(await processCapi(db)).toEqual({ found: 3, sent: 3 });
    expect(await processCapi(db)).toEqual({ found: 0, sent: 0 });
    const sent = meta.events.map(
      (e) => (e as { data: Record<string, unknown>[] }).data[0] as Record<string, unknown>,
    );
    expect(sent.map((e) => e.event_name).sort()).toEqual(["Lead", "Purchase", "Schedule"]);
    const purchase = sent.find((e) => e.event_name === "Purchase");
    expect(purchase).toMatchObject({
      action_source: "system_generated",
      custom_data: { currency: "BRL", value: 89900 },
      user_data: { ph: [sha256("5548999990001")], fn: [sha256("joana")] },
    });
    expect((meta.events[0] as { dataset: string }).dataset).toBe("777000111");

    // Com WABA e ctwa_clid: modo de mensagens comerciais.
    await saveMetaSettings(db, admin, org.id, { ...settings, wabaId: "4440001" });
    await fromAd("5548999990003", "120002", "CLID-999");
    meta.events.length = 0;
    await processCapi(db);
    const bm = (meta.events[0] as { data: Record<string, unknown>[] }).data[0];
    expect(bm).toMatchObject({
      event_name: "LeadSubmitted",
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: { whatsapp_business_account_id: "4440001", ctwa_clid: "CLID-999" },
    });
  });

  it("enviar os últimos 7 dias pega o que entrou antes de ligar, sem duplicar", async () => {
    const { org, admin, fromAd } = await setup();
    await fromAd("5548999990001"); // antes de ligar
    await expect(backfillCapi(db, admin, org.id)).rejects.toThrow(/Ligue/);
    await saveMetaSettings(db, admin, org.id, settings);
    expect(await processCapi(db)).toEqual({ found: 0, sent: 0 });
    expect(await backfillCapi(db, admin, org.id)).toBe(1);
    expect(await backfillCapi(db, admin, org.id)).toBe(0);
    expect(await processCapi(db)).toEqual({ found: 1, sent: 1 });
    await expect(backfillCapi(db, { ...admin, role: "seller" }, org.id)).rejects.toThrow(/gestores/);
  });

  it("erro da Meta: tenta de novo e desiste depois de 5", async () => {
    const { org, admin, fromAd } = await setup();
    await saveMetaSettings(db, admin, org.id, settings);
    await fromAd("5548999990001");
    meta.failEvents = true;
    for (let i = 0; i < 6; i++) await processCapi(db);
    const [ev] = await db.select().from(capiEvents);
    expect(ev).toMatchObject({ status: "failed", attempts: 5, error: "Invalid parameter" });
  });
});

describe("botão qualificado / desqualificado", () => {
  const due = () => db.update(capiEvents).set({ sendAfter: new Date(Date.now() - 1000) });
  const lastSent = () =>
    meta.events.map((e) => (e as { data: Record<string, unknown>[] }).data[0] as Record<string, unknown>);

  it("espera 5 min para desfazer, troca cancela o pendente e manda o evento certo", async () => {
    const { org, admin, fromAd } = await setup();
    await saveMetaSettings(db, admin, org.id, settings);
    await new Promise((r) => setTimeout(r, 5));
    await fromAd("5548999990001");
    const deal = (await db.select().from(deals))[0];
    const id = deal?.id ?? "";
    await processCapi(db); // Lead
    meta.events.length = 0;

    await setDealQualification(db, admin, org.id, id, "qualified");
    expect(await processCapi(db)).toEqual({ found: 0, sent: 0 }); // ainda dentro dos 5 min
    await setDealQualification(db, admin, org.id, id, "disqualified", "Sem entrada");
    const pend = await db.select().from(capiEvents).where(eq(capiEvents.status, "pending"));
    expect(pend.map((p) => p.eventName)).toEqual(["Disqualified"]);
    expect(pend[0]?.sendAfter.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    await due();
    expect(await processCapi(db)).toEqual({ found: 1, sent: 1 });
    expect(lastSent()[0]).toMatchObject({
      event_name: "DisqualifiedLead",
      action_source: "system_generated",
      user_data: { ph: [sha256("5548999990001")] },
    });
    const d = await getDeal(db, admin, org.id, id);
    expect(d).toMatchObject({ qualification: "disqualified", qualificationReason: "Sem entrada" });
    expect(d.qualifyMeta.events).toEqual([expect.objectContaining({ kind: "disqualified", status: "sent" })]);
    expect(d.events.some((e) => e.type === "qualification")).toBe(true);

    // Desmarcar não apaga o que já foi; marcar de novo não reenvia.
    await setDealQualification(db, admin, org.id, id, null);
    await setDealQualification(db, admin, org.id, id, "disqualified");
    await due();
    expect(await processCapi(db)).toEqual({ found: 0, sent: 0 });

    // Relatório de anúncios conta pelo botão.
    await setDealQualification(db, admin, org.id, id, "qualified");
    const r = await getAdsReport(db, admin, org.id, { period: "30d" });
    expect(r.total).toMatchObject({ leads: 1, qualified: 1, disqualified: 0 });

    // Envio desligado: só marca no CRM.
    await saveMetaSettings(db, admin, org.id, { ...settings, sendQualified: false });
    await setDealQualification(db, admin, org.id, id, null);
    await db.delete(capiEvents).where(eq(capiEvents.eventName, "Qualified"));
    await setDealQualification(db, admin, org.id, id, "qualified");
    expect(await db.select().from(capiEvents).where(eq(capiEvents.eventName, "Qualified"))).toHaveLength(0);
  });

  it("modo de mensagens: QualifiedLead uma vez só, mesmo com visita marcada depois", async () => {
    const { org, admin, fromAd } = await setup();
    await saveMetaSettings(db, admin, org.id, { ...settings, wabaId: "4440001" });
    await new Promise((r) => setTimeout(r, 5));
    await fromAd("5548999990001", "120002", "CLID-999");
    const id = (await db.select().from(deals))[0]?.id ?? "";
    await processCapi(db);
    meta.events.length = 0;
    await setDealQualification(db, admin, org.id, id, "qualified");
    await due();
    await processCapi(db);
    expect(lastSent()[0]).toMatchObject({ event_name: "QualifiedLead", action_source: "business_messaging" });
    meta.events.length = 0;
    await createAppointment(db, admin, org.id, {
      phone: "5548999990001",
      date: new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10),
      time: "10:00",
    });
    await processCapi(db);
    expect(meta.events).toHaveLength(0);
    const sch = await db.query.capiEvents.findFirst({ where: eq(capiEvents.eventName, "Schedule") });
    expect(sch).toMatchObject({ status: "sent", error: "Já enviado como QualifiedLead" });
  });
});

describe("resultado dos anúncios", () => {
  it("junta leads, visitas e vendas do CRM com o gasto da Meta por campanha", async () => {
    const { org, admin, fromAd } = await setup();
    await saveMetaSettings(db, admin, org.id, { ...settings, capiEnabled: false });
    await fromAd("5548999990001", "120001");
    await fromAd("5548999990002", "120001");
    expect(await syncAdNames(db)).toBe(1);
    const r = await getAdsReport(db, admin, org.id, { period: "30d" });
    expect(r.hasSpend).toBe(true);
    const seminovos = r.campaigns.find((c) => c.name === "Seminovos | WhatsApp");
    expect(seminovos).toMatchObject({ leads: 2, spend: 150, cpl: 75 });
    const feirao = r.campaigns.find((c) => c.name === "Feirão Outubro");
    expect(feirao).toMatchObject({ leads: 0, spend: 80.5, cpl: null });
    expect(r.total).toMatchObject({ leads: 2, spend: 230.5 });
    expect(r.ads.find((a) => a.key === "120001")).toMatchObject({ name: "HR-V prata vídeo", leads: 2 });
    await expect(getAdsReport(db, { ...admin, role: "seller" }, org.id)).rejects.toThrow(/permissão/);
  });
});
