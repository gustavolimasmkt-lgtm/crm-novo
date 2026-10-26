import type { Database } from "@crm/db";
import { type SQL, sql } from "drizzle-orm";
import { type Actor, can } from "../auth/permissions.js";
import { getAiUsage } from "./agent.js";
import { brParts } from "./schedule.js";

type ActorU = Actor & { userId: string };
const DAY = 86_400_000;

export const DASHBOARD_PERIODS = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "mes-passado", label: "Mês passado" },
] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["id"];

/** Intervalo do período no horário de Brasília. */
export function periodRange(p: string, now = new Date()) {
  const today = new Date(`${brParts(now).date}T00:00:00-03:00`);
  const [y, m] = brParts(now).date.split("-").map(Number) as [number, number];
  const monthStart = (yy: number, mm: number) =>
    new Date(`${yy}-${String(mm).padStart(2, "0")}-01T00:00:00-03:00`);
  switch (p) {
    case "hoje":
      return { id: "hoje", from: today, to: now };
    case "30d":
      return { id: "30d", from: new Date(today.getTime() - 29 * DAY), to: now };
    case "mes":
      return { id: "mes", from: monthStart(y, m), to: now };
    case "mes-passado":
      return {
        id: "mes-passado",
        from: m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1),
        to: monthStart(y, m),
      };
    default:
      return { id: "7d", from: new Date(today.getTime() - 6 * DAY), to: now };
  }
}

const n = (v: unknown) => Number(v ?? 0);
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Números do painel. Gestor vê a empresa (ou uma pessoa, com userId); vendedor vê só o que é dele.
 * "Leads" = negociações criadas no período; "vendas" = negociações ganhas (fechadas) no período.
 */
export async function getDashboard(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { period?: string; userId?: string | null } = {},
) {
  const { id: period, from, to } = periodRange(opts.period ?? "7d");
  const manager = can(actor, "reports.view");
  const userId = manager
    ? opts.userId && /^[0-9a-f-]{36}$/i.test(opts.userId)
      ? opts.userId
      : null
    : actor.userId;
  const org = sql`${organizationId}::uuid`;
  const byUser = (col: SQL) => (userId ? sql`and ${col} = ${userId}::uuid` : sql``);
  const inRange = (col: SQL) => sql`${col} >= ${ts(from)} and ${col} < ${ts(to)}`;

  const [kpi] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from deals d where d.organization_id = ${org} and ${inRange(sql`d.created_at`)}
         ${byUser(sql`d.assigned_user_id`)}) as leads,
      (select count(*) from deals d join pipeline_stages s on s.id = d.stage_id
         where d.organization_id = ${org} and s.kind = 'won' and ${inRange(sql`d.closed_at`)}
         ${byUser(sql`d.assigned_user_id`)}) as won,
      (select coalesce(sum(d.value_cents), 0) from deals d join pipeline_stages s on s.id = d.stage_id
         where d.organization_id = ${org} and s.kind = 'won' and ${inRange(sql`d.closed_at`)}
         ${byUser(sql`d.assigned_user_id`)}) as won_cents,
      (select count(*) from deals d join pipeline_stages s on s.id = d.stage_id
         where d.organization_id = ${org} and s.kind = 'lost' and ${inRange(sql`d.closed_at`)}
         ${byUser(sql`d.assigned_user_id`)}) as lost,
      (select count(*) from appointments a where a.organization_id = ${org} and a.status <> 'canceled'
         and ${inRange(sql`a.created_at`)} ${byUser(sql`a.assigned_user_id`)}) as visits_booked,
      (select count(*) from appointments a where a.organization_id = ${org} and a.status = 'attended'
         and ${inRange(sql`a.starts_at`)} ${byUser(sql`a.assigned_user_id`)}) as visits_attended,
      (select count(*) from appointments a where a.organization_id = ${org} and a.status = 'no_show'
         and ${inRange(sql`a.starts_at`)} ${byUser(sql`a.assigned_user_id`)}) as visits_no_show,
      (select count(*) from appointments a where a.organization_id = ${org} and a.status = 'scheduled'
         and a.starts_at < now() ${byUser(sql`a.assigned_user_id`)}) as visits_unmarked
  `);

  // Primeira resposta: conversas cujo primeiro contato do cliente caiu no período.
  const [sla] = await db.execute<Record<string, unknown>>(sql`
    with f as (
      select c.id,
        (select min(m.sent_at) from messages m where m.conversation_id = c.id and m.direction = 'in') as first_in
      from conversations c
      where c.organization_id = ${org} ${byUser(sql`c.assigned_user_id`)}
    ), r as (
      select f.first_in,
        (select min(m.sent_at) from messages m where m.conversation_id = f.id and m.direction = 'out'
           and m.sent_at >= f.first_in) as first_out,
        (select min(m.sent_at) from messages m where m.conversation_id = f.id and m.direction = 'out'
           and not m.sent_by_ai and m.sent_at >= f.first_in) as first_human
      from f where ${inRange(sql`f.first_in`)}
    )
    select count(*) as total,
      count(first_out) as answered,
      count(*) filter (where first_out - first_in <= interval '5 minutes') as within5,
      percentile_cont(0.5) within group (order by extract(epoch from first_out - first_in))
        filter (where first_out is not null) as median_s,
      percentile_cont(0.5) within group (order by extract(epoch from first_human - first_in))
        filter (where first_human is not null) as median_human_s
    from r
  `);

  // Aguardando resposta agora (cliente falou por último há mais de 10 min e a IA não vai responder).
  const waiting = await db.execute<{
    id: string;
    contact_name: string | null;
    phone: string | null;
    last_message_at: string;
    preview: string | null;
    assignee: string | null;
  }>(sql`
    select c.id, coalesce(ct.name, ct.push_name) as contact_name, ct.phone, c.last_message_at,
           c.last_message_preview as preview, u.name as assignee
    from conversations c
    join contacts ct on ct.id = c.contact_id
    left join users u on u.id = c.assigned_user_id
    where c.organization_id = ${org} and c.status = 'open' and c.last_message_from_me = false
      and c.last_message_at < now() - interval '10 minutes'
      and not exists (select 1 from ai_jobs j where j.conversation_id = c.id)
      and not exists (select 1 from users tu join memberships tm on tm.user_id = tu.id
                      where tm.organization_id = c.organization_id and tu.phone = ct.phone)
      ${userId ? (manager ? sql`and c.assigned_user_id = ${userId}::uuid` : sql`and (c.assigned_user_id = ${userId}::uuid or c.assigned_user_id is null)`) : sql``}
    order by c.last_message_at
    limit 8
  `);
  const [waitingCount] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from conversations c join contacts ct on ct.id = c.contact_id
    where c.organization_id = ${org} and c.status = 'open' and c.last_message_from_me = false
      and c.last_message_at < now() - interval '10 minutes'
      and not exists (select 1 from ai_jobs j where j.conversation_id = c.id)
      and not exists (select 1 from users tu join memberships tm on tm.user_id = tu.id
                      where tm.organization_id = c.organization_id and tu.phone = ct.phone)
      ${userId ? (manager ? sql`and c.assigned_user_id = ${userId}::uuid` : sql`and (c.assigned_user_id = ${userId}::uuid or c.assigned_user_id is null)`) : sql``}
  `);

  // Funil agora (negociações abertas do funil padrão).
  const funnel = await db.execute<{
    name: string;
    color: string;
    kind: string;
    count: number;
    cents: number;
  }>(sql`
    select s.name, s.color, s.kind, count(d.id)::int as count, coalesce(sum(d.value_cents), 0)::bigint as cents
    from pipelines p
    join pipeline_stages s on s.pipeline_id = p.id and s.kind in ('open', 'scheduled')
    left join deals d on d.stage_id = s.id ${byUser(sql`d.assigned_user_id`)}
    where p.organization_id = ${org} and p.is_default
    group by s.id, s.name, s.color, s.kind, s.position
    order by s.position
  `);

  // Origem dos leads do período (e quantos desses já viraram venda).
  const sources = await db.execute<{ name: string; leads: number; won: number }>(sql`
    select coalesce(src.name, 'Sem origem') as name, count(*)::int as leads,
           count(*) filter (where s.kind = 'won')::int as won
    from deals d
    join pipeline_stages s on s.id = d.stage_id
    left join deal_sources src on src.id = d.source_id
    where d.organization_id = ${org} and ${inRange(sql`d.created_at`)} ${byUser(sql`d.assigned_user_id`)}
    group by 1 order by 2 desc limit 8
  `);

  // Por pessoa (só gestor).
  const team = manager
    ? await db.execute<{
        id: string;
        name: string;
        leads: number;
        visits: number;
        won: number;
        won_cents: number;
        open: number;
        waiting: number;
      }>(sql`
        select u.id, u.name,
          (select count(*)::int from deals d where d.organization_id = ${org} and d.assigned_user_id = u.id
             and ${inRange(sql`d.created_at`)}) as leads,
          (select count(*)::int from appointments a where a.organization_id = ${org} and a.assigned_user_id = u.id
             and a.status = 'attended' and ${inRange(sql`a.starts_at`)}) as visits,
          (select count(*)::int from deals d join pipeline_stages s on s.id = d.stage_id
             where d.organization_id = ${org} and d.assigned_user_id = u.id and s.kind = 'won'
             and ${inRange(sql`d.closed_at`)}) as won,
          (select coalesce(sum(d.value_cents), 0)::bigint from deals d join pipeline_stages s on s.id = d.stage_id
             where d.organization_id = ${org} and d.assigned_user_id = u.id and s.kind = 'won'
             and ${inRange(sql`d.closed_at`)}) as won_cents,
          (select count(*)::int from deals d join pipeline_stages s on s.id = d.stage_id
             where d.organization_id = ${org} and d.assigned_user_id = u.id and s.kind in ('open', 'scheduled')) as open,
          (select count(*)::int from conversations c where c.organization_id = ${org} and c.assigned_user_id = u.id
             and c.status = 'open' and c.last_message_from_me = false
             and c.last_message_at < now() - interval '10 minutes'
             and not exists (select 1 from ai_jobs j where j.conversation_id = c.id)) as waiting
        from memberships m join users u on u.id = m.user_id
        where m.organization_id = ${org} and m.active
        order by won_cents desc, won desc, leads desc, u.name
      `)
    : [];

  // Agente de IA no período.
  const [ai] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from messages m where m.organization_id = ${org} and m.sent_by_ai
         and ${inRange(sql`m.sent_at`)}) as messages,
      (select count(distinct m.conversation_id) from messages m where m.organization_id = ${org} and m.sent_by_ai
         and ${inRange(sql`m.sent_at`)}) as conversations,
      (select count(*) from deal_events e where e.organization_id = ${org} and e.type = 'note'
         and e.data->>'text' like 'IA transferiu%' and ${inRange(sql`e.created_at`)}) as transfers,
      (select count(*) from appointments a where a.organization_id = ${org} and a.created_by_ai
         and a.status <> 'canceled' and ${inRange(sql`a.created_at`)}) as visits
  `);
  const usage = manager ? await getAiUsage(db, organizationId) : null;

  const attended = n(kpi?.visits_attended);
  const noShow = n(kpi?.visits_no_show);
  const leads = n(kpi?.leads);
  const won = n(kpi?.won);
  return {
    period,
    from,
    to,
    manager,
    userId,
    kpi: {
      leads,
      won,
      wonCents: n(kpi?.won_cents),
      lost: n(kpi?.lost),
      conversion: leads ? won / leads : null,
      visitsBooked: n(kpi?.visits_booked),
      visitsAttended: attended,
      visitsNoShow: noShow,
      visitsUnmarked: n(kpi?.visits_unmarked),
      showRate: attended + noShow ? attended / (attended + noShow) : null,
    },
    sla: {
      total: n(sla?.total),
      answered: n(sla?.answered),
      within5: n(sla?.within5),
      medianSeconds: sla?.median_s == null ? null : n(sla.median_s),
      medianHumanSeconds: sla?.median_human_s == null ? null : n(sla.median_human_s),
    },
    waiting: {
      count: n(waitingCount?.n),
      items: waiting.map((w) => ({
        id: w.id,
        name: w.contact_name || w.phone || "Sem nome",
        since: new Date(w.last_message_at),
        preview: w.preview,
        assignee: w.assignee,
      })),
    },
    funnel: funnel.map((f) => ({ name: f.name, color: f.color, count: n(f.count), cents: n(f.cents) })),
    sources: sources.map((s) => ({ name: s.name, leads: n(s.leads), won: n(s.won) })),
    team: team.map((t) => ({
      id: t.id,
      name: t.name,
      leads: n(t.leads),
      visits: n(t.visits),
      won: n(t.won),
      wonCents: n(t.won_cents),
      open: n(t.open),
      waiting: n(t.waiting),
    })),
    ai: {
      messages: n(ai?.messages),
      conversations: n(ai?.conversations),
      transfers: n(ai?.transfers),
      visits: n(ai?.visits),
      usedCredits: usage?.usedCredits ?? null,
      limitCredits: usage?.limitCredits ?? null,
    },
  };
}
