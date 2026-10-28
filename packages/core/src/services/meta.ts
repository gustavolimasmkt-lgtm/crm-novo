import { capiEvents, contacts, type Database, deals, metaAds, metaSettings } from "@crm/db";
import { and, eq, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { decryptSecret, encryptSecret, sha256 } from "../secret.js";
import { periodRange } from "./dashboard.js";
import { AppError } from "./errors.js";

type ActorU = Actor & { userId: string };

export function graphBase() {
  const base = (process.env.META_GRAPH_URL || "https://graph.facebook.com").replace(/\/$/, "");
  return `${base}/${process.env.META_GRAPH_VERSION || "v26.0"}`;
}

type FetchLike = typeof fetch;

async function graph<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const url = new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetchImpl(url, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `Meta respondeu ${r.status}`);
  return j;
}

function requireManage(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores configuram a integração com a Meta.");
}

export async function getMetaSettings(db: Database, organizationId: string) {
  const s = await db.query.metaSettings.findFirst({ where: eq(metaSettings.organizationId, organizationId) });
  return {
    capiEnabled: s?.capiEnabled ?? false,
    capiEnabledAt: s?.capiEnabledAt ?? null,
    datasetId: s?.datasetId ?? "",
    hasCapiToken: !!s?.capiTokenEnc,
    testEventCode: s?.testEventCode ?? "",
    wabaId: s?.wabaId ?? "",
    sendLead: s?.sendLead ?? true,
    sendSchedule: s?.sendSchedule ?? true,
    sendPurchase: s?.sendPurchase ?? true,
    sendQualified: s?.sendQualified ?? true,
    sendDisqualified: s?.sendDisqualified ?? true,
    adAccountId: s?.adAccountId ?? "",
    hasAdsToken: !!s?.adsTokenEnc,
  };
}

const digits = (v: string) => v.replace(/\D/g, "");
export const metaInput = z.object({
  capiEnabled: z.boolean(),
  datasetId: z.string().trim().transform(digits).pipe(z.string().max(30)),
  /** Vazio: mantém o token já guardado. */
  capiToken: z.string().trim().max(1000).default(""),
  testEventCode: z.string().trim().max(40).default(""),
  wabaId: z.string().trim().transform(digits).pipe(z.string().max(30)).default(""),
  sendLead: z.boolean().default(true),
  sendSchedule: z.boolean().default(true),
  sendPurchase: z.boolean().default(true),
  sendQualified: z.boolean().default(true),
  sendDisqualified: z.boolean().default(true),
  adAccountId: z
    .string()
    .trim()
    .transform((v) => digits(v.replace(/^act_/i, "")))
    .pipe(z.string().max(30))
    .default(""),
  adsToken: z.string().trim().max(1000).default(""),
  removeAdsToken: z.boolean().default(false),
});

export async function saveMetaSettings(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof metaInput>,
) {
  requireManage(actor);
  const input = metaInput.parse(raw);
  const cur = await db.query.metaSettings.findFirst({
    where: eq(metaSettings.organizationId, organizationId),
  });
  const capiTokenEnc = input.capiToken ? encryptSecret(input.capiToken) : (cur?.capiTokenEnc ?? null);
  const adsTokenEnc = input.removeAdsToken
    ? null
    : input.adsToken
      ? encryptSecret(input.adsToken)
      : (cur?.adsTokenEnc ?? null);
  if (input.capiEnabled && (!input.datasetId || !capiTokenEnc))
    throw new AppError(
      "validation",
      "Para ligar a API de Conversões, informe o ID do conjunto de dados (pixel) e o token.",
    );
  if (adsTokenEnc && !input.adAccountId)
    throw new AppError("validation", "Informe o ID da conta de anúncios junto com o token de leitura.");
  const values = {
    capiEnabled: input.capiEnabled,
    capiEnabledAt: input.capiEnabled ? (cur?.capiEnabled ? cur.capiEnabledAt : new Date()) : null,
    datasetId: input.datasetId || null,
    capiTokenEnc,
    testEventCode: input.testEventCode || null,
    wabaId: input.wabaId || null,
    sendLead: input.sendLead,
    sendSchedule: input.sendSchedule,
    sendPurchase: input.sendPurchase,
    sendQualified: input.sendQualified,
    sendDisqualified: input.sendDisqualified,
    adAccountId: input.adAccountId || null,
    adsTokenEnc,
    updatedAt: new Date(),
  };
  await db
    .insert(metaSettings)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({ target: metaSettings.organizationId, set: values });
}

/** Confere os dados com a Meta (sem enviar evento). Devolve uma linha por item. */
export async function testMetaConnection(
  db: Database,
  actor: ActorU,
  organizationId: string,
  fetchImpl: FetchLike = fetch,
) {
  requireManage(actor);
  const s = await db.query.metaSettings.findFirst({ where: eq(metaSettings.organizationId, organizationId) });
  const out: { item: string; ok: boolean; detail: string }[] = [];
  if (s?.datasetId && s.capiTokenEnc) {
    try {
      const r = await graph<{ name?: string; id: string }>(
        s.datasetId,
        decryptSecret(s.capiTokenEnc),
        { query: { fields: "name" } },
        fetchImpl,
      );
      out.push({ item: "API de Conversões", ok: true, detail: `Conjunto de dados: ${r.name ?? r.id}` });
    } catch (e) {
      const msg = (e as Error).message;
      // Token gerado no Gerenciador de Eventos só envia eventos; ler o nome do conjunto dá #100.
      if (/missing permission/i.test(msg))
        out.push({
          item: "API de Conversões",
          ok: true,
          detail:
            "Token aceito. Ele só tem permissão para enviar eventos (não lê o nome do conjunto), o que é normal no token do Gerenciador de Eventos. O primeiro envio confirma.",
        });
      else out.push({ item: "API de Conversões", ok: false, detail: msg });
    }
  }
  if (s?.adAccountId && s.adsTokenEnc) {
    try {
      const r = await graph<{ name?: string; currency?: string }>(
        `act_${s.adAccountId}`,
        decryptSecret(s.adsTokenEnc),
        { query: { fields: "name,currency" } },
        fetchImpl,
      );
      out.push({
        item: "Conta de anúncios",
        ok: true,
        detail: `${r.name ?? s.adAccountId} (${r.currency ?? "?"})`,
      });
    } catch (e) {
      out.push({ item: "Conta de anúncios", ok: false, detail: (e as Error).message });
    }
  }
  if (!out.length) throw new AppError("validation", "Salve os dados da Meta antes de testar.");
  return out;
}

// ---------------------------------------------------------------- API de Conversões

/**
 * Põe na fila os eventos novos: lead criado, negociação entrou em agendamento e venda ganha.
 * Lê o histórico da negociação (deal_events), então pega tudo, venha da IA, da agenda ou da tela.
 */
export async function queueCapiEvents(db: Database) {
  const rows = await db.execute(sql`
    insert into capi_events (organization_id, deal_id, event_name, event_time)
    select e.organization_id, e.deal_id,
      case when e.type = 'created' then 'Lead'
           when e.data->>'kind' = 'scheduled' then 'Schedule'
           else 'Purchase' end,
      e.created_at
    from deal_events e
    join meta_settings ms on ms.organization_id = e.organization_id and ms.capi_enabled
    where e.created_at >= ms.capi_enabled_at
      and e.created_at > now() - interval '6 days 22 hours'
      and (
        (e.type = 'created' and ms.send_lead) or
        (e.type = 'stage' and e.data->>'kind' = 'scheduled' and ms.send_schedule) or
        (e.type = 'stage' and e.data->>'kind' = 'won' and ms.send_purchase)
      )
    on conflict (deal_id, event_name) do nothing
    returning id
  `);
  return rows.length;
}

/**
 * Põe na fila os eventos dos últimos 7 dias (a Meta recusa mais antigos), como se a API estivesse ligada
 * desde então. Não duplica o que já foi. Devolve quantos entraram na fila.
 */
export async function backfillCapi(db: Database, actor: ActorU, organizationId: string) {
  requireManage(actor);
  const s = await db.query.metaSettings.findFirst({ where: eq(metaSettings.organizationId, organizationId) });
  if (!s?.capiEnabled) throw new AppError("validation", "Ligue a API de Conversões antes de enviar.");
  const since = new Date(Date.now() - 7 * 86_400_000 + 2 * 3600_000);
  if (!s.capiEnabledAt || s.capiEnabledAt > since)
    await db
      .update(metaSettings)
      .set({ capiEnabledAt: since })
      .where(eq(metaSettings.organizationId, organizationId));
  const before = await db.$count(capiEvents, eq(capiEvents.organizationId, organizationId));
  await queueCapiEvents(db);
  return (await db.$count(capiEvents, eq(capiEvents.organizationId, organizationId))) - before;
}

const BM_NAMES: Record<string, string> = {
  Lead: "LeadSubmitted",
  Schedule: "QualifiedLead",
  Qualified: "QualifiedLead",
  Purchase: "Purchase",
};
/** Nomes fora do modo de mensagens (eventos personalizados para os botões). */
const SYSTEM_NAMES: Record<string, string> = {
  Qualified: "QualifiedLead",
  Disqualified: "DisqualifiedLead",
};

/** Nome que a Meta recebe. Desqualificado não existe no modo de mensagens: vai como evento personalizado. */
export function capiMetaName(
  eventName: string,
  deal: { ctwaClid: string | null },
  s: { wabaId: string | null },
) {
  const bm = !!(s.wabaId && deal.ctwaClid) && eventName in BM_NAMES;
  return { name: bm ? (BM_NAMES[eventName] as string) : (SYSTEM_NAMES[eventName] ?? eventName), bm };
}

/** Monta o evento no formato da Meta. Com WABA + ctwa_clid usa o modo de mensagens; senão, telefone com hash. */
export function buildCapiEvent(
  ev: { id: string; eventName: string; eventTime: Date },
  deal: { title: string; valueCents: number; ctwaClid: string | null; contactId: string },
  contact: { phone: string | null; name: string | null; pushName: string | null } | null,
  s: { wabaId: string | null },
) {
  const phone = contact?.phone ? digits(contact.phone) : null;
  const first = (contact?.name ?? contact?.pushName ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const { name, bm: businessMessaging } = capiMetaName(ev.eventName, deal, s);
  const custom: Record<string, unknown> = { content_name: deal.title.slice(0, 100) };
  if (ev.eventName === "Purchase") {
    custom.currency = "BRL";
    custom.value = Math.round(Number(deal.valueCents)) / 100;
  }
  return {
    event_name: name,
    event_time: Math.floor(ev.eventTime.getTime() / 1000),
    event_id: ev.id,
    action_source: businessMessaging ? "business_messaging" : "system_generated",
    ...(businessMessaging ? { messaging_channel: "whatsapp" } : {}),
    user_data: {
      ...(phone ? { ph: [sha256(phone)] } : {}),
      external_id: [sha256(deal.contactId)],
      ...(first && /^\p{L}+$/u.test(first) ? { fn: [sha256(first)] } : {}),
      ...(businessMessaging ? { whatsapp_business_account_id: s.wabaId, ctwa_clid: deal.ctwaClid } : {}),
    },
    custom_data: custom,
  };
}

/** Envia os eventos pendentes (até 5 tentativas). Chamado por um timer. */
export async function processCapi(db: Database, fetchImpl: FetchLike = fetch, limit = 50) {
  await queueCapiEvents(db);
  const pending = await db
    .select({ ev: capiEvents, deal: deals, contact: contacts, s: metaSettings })
    .from(capiEvents)
    .innerJoin(deals, eq(deals.id, capiEvents.dealId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(metaSettings, eq(metaSettings.organizationId, capiEvents.organizationId))
    .where(
      and(
        eq(capiEvents.status, "pending"),
        lt(capiEvents.attempts, 5),
        lte(capiEvents.sendAfter, new Date()),
      ),
    )
    .limit(limit);
  let sent = 0;
  for (const { ev, deal, contact, s } of pending) {
    try {
      if (!s.capiEnabled || !s.datasetId || !s.capiTokenEnc) throw new Error("API de Conversões desligada");
      // Agendamento e botão Qualificado viram o mesmo QualifiedLead no modo de mensagens: manda um só.
      const meta = capiMetaName(ev.eventName, deal, s);
      const others = await db
        .select({ eventName: capiEvents.eventName })
        .from(capiEvents)
        .where(and(eq(capiEvents.dealId, deal.id), eq(capiEvents.status, "sent"), ne(capiEvents.id, ev.id)));
      if (others.some((o) => capiMetaName(o.eventName, deal, s).name === meta.name)) {
        await db
          .update(capiEvents)
          .set({ status: "sent", sentAt: new Date(), error: `Já enviado como ${meta.name}` })
          .where(eq(capiEvents.id, ev.id));
        continue;
      }
      const body: Record<string, unknown> = { data: [buildCapiEvent(ev, deal, contact, s)] };
      if (s.testEventCode) body.test_event_code = s.testEventCode;
      await graph(
        `${s.datasetId}/events`,
        decryptSecret(s.capiTokenEnc),
        { method: "POST", body },
        fetchImpl,
      );
      await db
        .update(capiEvents)
        .set({ status: "sent", sentAt: new Date(), attempts: ev.attempts + 1, error: null })
        .where(eq(capiEvents.id, ev.id));
      sent++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      await db
        .update(capiEvents)
        .set({ attempts: ev.attempts + 1, error: msg, status: ev.attempts + 1 >= 5 ? "failed" : "pending" })
        .where(eq(capiEvents.id, ev.id));
    }
  }
  return { found: pending.length, sent };
}

export async function capiStatus(db: Database, organizationId: string) {
  const rows = await db.execute<{ event_name: string; status: string; n: number }>(sql`
    select event_name, status, count(*)::int as n from capi_events
    where organization_id = ${organizationId}::uuid and created_at > now() - interval '30 days'
    group by 1, 2`);
  const [last] = await db.execute<{ error: string | null; created_at: string }>(sql`
    select error, created_at from capi_events where organization_id = ${organizationId}::uuid and error is not null and status <> 'sent'
    order by created_at desc limit 1`);
  return {
    counts: rows.map((r) => ({ eventName: r.event_name, status: r.status, n: Number(r.n) })),
    lastError: last?.error ?? null,
  };
}

// ---------------------------------------------------------------- anúncios (nomes e gasto)

type InsightRow = {
  ad_id: string;
  ad_name?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
};

async function fetchInsights(
  adAccountId: string,
  token: string,
  since: string,
  until: string,
  fetchImpl: FetchLike,
): Promise<InsightRow[]> {
  const out: InsightRow[] = [];
  let next: string | null = null;
  let page = await graph<{ data: InsightRow[]; paging?: { next?: string } }>(
    `act_${adAccountId}/insights`,
    token,
    {
      query: {
        level: "ad",
        fields: "ad_id,ad_name,adset_name,campaign_id,campaign_name,spend",
        time_range: JSON.stringify({ since, until }),
        limit: "500",
      },
    },
    fetchImpl,
  );
  for (let i = 0; i < 5; i++) {
    out.push(...(page.data ?? []));
    next = page.paging?.next ?? null;
    if (!next) break;
    const r = await fetchImpl(next, { signal: AbortSignal.timeout(15_000) });
    page = (await r.json()) as typeof page;
  }
  return out;
}

/** Busca na Meta o nome dos anúncios que trouxeram leads e ainda não estão no cache. */
export async function syncAdNames(db: Database, fetchImpl: FetchLike = fetch, limit = 20) {
  const missing = await db.execute<{ organization_id: string; ad_id: string; token: string }>(sql`
    select distinct d.organization_id, d.ad_id, ms.ads_token_enc as token
    from deals d join meta_settings ms on ms.organization_id = d.organization_id and ms.ads_token_enc is not null
    where d.ad_id is not null
      and not exists (select 1 from meta_ads a where a.organization_id = d.organization_id and a.ad_id = d.ad_id
                      and (a.error is null or a.fetched_at > now() - interval '1 day'))
    limit ${limit}`);
  for (const m of missing) {
    try {
      const r = await graph<{
        name?: string;
        adset?: { name?: string };
        campaign?: { id?: string; name?: string };
      }>(
        m.ad_id,
        decryptSecret(m.token),
        { query: { fields: "name,adset{name},campaign{id,name}" } },
        fetchImpl,
      );
      await upsertAd(db, m.organization_id, {
        ad_id: m.ad_id,
        ad_name: r.name,
        adset_name: r.adset?.name,
        campaign_id: r.campaign?.id,
        campaign_name: r.campaign?.name,
      });
    } catch (e) {
      await db
        .insert(metaAds)
        .values({
          organizationId: m.organization_id,
          adId: m.ad_id,
          error: String((e as Error).message).slice(0, 200),
        })
        .onConflictDoUpdate({
          target: [metaAds.organizationId, metaAds.adId],
          set: { error: String((e as Error).message).slice(0, 200), fetchedAt: new Date() },
        });
    }
  }
  return missing.length;
}

async function upsertAd(db: Database, organizationId: string, r: InsightRow) {
  const v = {
    name: r.ad_name ?? null,
    adsetName: r.adset_name ?? null,
    campaignId: r.campaign_id ?? null,
    campaignName: r.campaign_name ?? null,
    error: null,
    fetchedAt: new Date(),
  };
  await db
    .insert(metaAds)
    .values({ organizationId, adId: r.ad_id, ...v })
    .onConflictDoUpdate({ target: [metaAds.organizationId, metaAds.adId], set: v });
}

/**
 * Resultado por campanha e por anúncio no período: leads, visitas, vendas e receita do CRM,
 * mais o gasto da Meta (se houver token de leitura). Inclui campanhas que gastaram e não trouxeram lead.
 */
export async function getAdsReport(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { period?: string } = {},
  fetchImpl: FetchLike = fetch,
) {
  if (!can(actor, "reports.view")) throw new AppError("forbidden", "Sem permissão para ver relatórios.");
  const { id: period, from, to } = periodRange(opts.period ?? "30d");
  const s = await db.query.metaSettings.findFirst({ where: eq(metaSettings.organizationId, organizationId) });
  let spendError: string | null = null;
  let insights: InsightRow[] = [];
  if (s?.adsTokenEnc && s.adAccountId) {
    const day = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    try {
      insights = await fetchInsights(
        s.adAccountId,
        decryptSecret(s.adsTokenEnc),
        day(from),
        day(new Date(to.getTime() - 1)),
        fetchImpl,
      );
      for (const r of insights) await upsertAd(db, organizationId, r);
    } catch (e) {
      spendError = (e as Error).message;
    }
  }
  const rows = await db.execute<{
    ad_id: string | null;
    ad_title: string | null;
    ad_name: string | null;
    campaign_id: string | null;
    campaign_name: string | null;
    leads: number;
    qualified: number;
    disqualified: number;
    visits: number;
    won: number;
    won_cents: number;
  }>(sql`
    select d.ad_id, max(d.ad_title) as ad_title, max(a.name) as ad_name, max(a.campaign_id) as campaign_id,
           max(a.campaign_name) as campaign_name,
           count(*)::int as leads,
           count(*) filter (where d.qualification = 'qualified')::int as qualified,
           count(*) filter (where d.qualification = 'disqualified')::int as disqualified,
           count(*) filter (where exists (select 1 from appointments ap where ap.deal_id = d.id
                                          and ap.status <> 'canceled'))::int as visits,
           count(*) filter (where s.kind = 'won')::int as won,
           coalesce(sum(d.value_cents) filter (where s.kind = 'won'), 0)::bigint as won_cents
    from deals d
    join pipeline_stages s on s.id = d.stage_id
    left join deal_sources src on src.id = d.source_id
    left join meta_ads a on a.organization_id = d.organization_id and a.ad_id = d.ad_id
    where d.organization_id = ${organizationId}::uuid
      and d.created_at >= ${from.toISOString()}::timestamptz and d.created_at < ${to.toISOString()}::timestamptz
      and (d.ad_id is not null or d.ctwa_clid is not null or src.key = 'meta_ads')
    group by d.ad_id`);

  type Agg = {
    key: string;
    name: string;
    leads: number;
    qualified: number;
    disqualified: number;
    visits: number;
    won: number;
    wonCents: number;
    spend: number;
  };
  const campaigns = new Map<string, Agg>();
  const ads = new Map<string, Agg & { campaign: string }>();
  const bump = (m: Map<string, Agg>, key: string, name: string) => {
    let a = m.get(key);
    if (!a) {
      a = { key, name, leads: 0, qualified: 0, disqualified: 0, visits: 0, won: 0, wonCents: 0, spend: 0 };
      m.set(key, a);
    }
    return a;
  };
  for (const r of rows) {
    const campKey = r.campaign_id ?? (r.ad_id ? `ad:${r.ad_id}` : "sem-anuncio");
    const campName =
      r.campaign_name ?? (r.ad_id ? "Campanha não identificada" : "Meta Ads (sem anúncio identificado)");
    for (const a of [
      bump(campaigns, campKey, campName),
      ...(r.ad_id
        ? [
            Object.assign(
              bump(ads as Map<string, Agg>, r.ad_id, r.ad_name ?? r.ad_title ?? `Anúncio ${r.ad_id}`),
              { campaign: campName },
            ),
          ]
        : []),
    ]) {
      a.leads += Number(r.leads);
      a.qualified += Number(r.qualified);
      a.disqualified += Number(r.disqualified);
      a.visits += Number(r.visits);
      a.won += Number(r.won);
      a.wonCents += Number(r.won_cents);
    }
  }
  for (const i of insights) {
    const spend = Number(i.spend ?? 0);
    if (!spend) continue;
    bump(campaigns, i.campaign_id ?? `ad:${i.ad_id}`, i.campaign_name ?? "Campanha").spend += spend;
    const ad = bump(ads as Map<string, Agg>, i.ad_id, i.ad_name ?? `Anúncio ${i.ad_id}`) as Agg & {
      campaign?: string;
    };
    ad.spend += spend;
    ad.campaign ??= i.campaign_name ?? "";
  }
  const finish = <T extends Agg>(a: T) => ({
    ...a,
    cpl: a.spend && a.leads ? a.spend / a.leads : null,
    costPerQualified: a.spend && a.qualified ? a.spend / a.qualified : null,
    costPerSale: a.spend && a.won ? a.spend / a.won : null,
    roas: a.spend ? a.wonCents / 100 / a.spend : null,
  });
  const sortFn = (a: Agg, b: Agg) => b.spend - a.spend || b.leads - a.leads;
  const campaignList = [...campaigns.values()].sort(sortFn).map(finish);
  const total = campaignList.reduce(
    (t, c) => ({
      leads: t.leads + c.leads,
      qualified: t.qualified + c.qualified,
      disqualified: t.disqualified + c.disqualified,
      visits: t.visits + c.visits,
      won: t.won + c.won,
      wonCents: t.wonCents + c.wonCents,
      spend: t.spend + c.spend,
    }),
    { leads: 0, qualified: 0, disqualified: 0, visits: 0, won: 0, wonCents: 0, spend: 0 },
  );
  return {
    period,
    hasSpend: !!(s?.adsTokenEnc && s.adAccountId) && !spendError,
    spendError,
    total: finish({ key: "total", name: "Total", ...total }),
    campaigns: campaignList,
    ads: [...ads.values()]
      .sort(sortFn)
      .slice(0, 30)
      .map((a) => finish(a as Agg & { campaign: string })),
  };
}
