import { DASHBOARD_PERIODS, getDashboard, listAssignableUsers } from "@crm/core";
import { getDb, ROLE_LABELS } from "@crm/db";
import { Clock, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, cx, PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { PersonFilter } from "./person-filter";

export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const money = (cents: number) => brl.format(cents / 100);

function duration(seconds: number | null) {
  if (seconds == null) return "–";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.round(h / 24)} dias`;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ "sem-permissao"?: string; p?: string; pessoa?: string }>;
}) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const db = getDb();
  const g = await getDashboard(db, ctx.actor, ctx.organization.id, { period: sp.p, userId: sp.pessoa });
  const people = g.manager ? await listAssignableUsers(db, ctx.organization.id) : [];
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date()),
  );
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const scope = g.manager
    ? g.userId
      ? people.find((p) => p.id === g.userId)?.name
      : "toda a empresa"
    : "seus números";
  const periodLink = (id: string) => {
    const p = new URLSearchParams({ p: id });
    if (g.userId && g.manager) p.set("pessoa", g.userId);
    return `/?${p.toString()}`;
  };
  const maxFunnel = Math.max(1, ...g.funnel.map((f) => f.count));
  const maxSource = Math.max(1, ...g.sources.map((s) => s.leads));

  return (
    <>
      <PageHeader
        title={`${greeting}, ${ctx.user.name.split(" ")[0]}`}
        subtitle={`${ctx.organization.name} · ${ctx.user.isMaster && !ctx.role ? "Master" : ROLE_LABELS[ctx.role ?? "seller"]}`}
      />
      {sp["sem-permissao"] && (
        <p className="mb-6 rounded-xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
          Seu papel não tem acesso àquela área.
        </p>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="filtros-painel">
        {DASHBOARD_PERIODS.map((p) => (
          <Link
            key={p.id}
            href={periodLink(p.id)}
            className={cx(
              "rounded-full px-3 py-1.5 text-[14px] font-medium",
              g.period === p.id ? "bg-ink text-bg" : "bg-fill text-ink-2 hover:bg-fill-strong",
            )}
          >
            {p.label}
          </Link>
        ))}
        {g.manager && <PersonFilter people={people} value={g.userId ?? ""} period={g.period} />}
        <span className="text-[13px] text-ink-3">Mostrando {scope}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpis">
        <Stat label="Leads novos" value={String(g.kpi.leads)} hint="negociações criadas" />
        <Stat
          label="Visitas"
          value={String(g.kpi.visitsBooked)}
          hint={`marcadas · ${g.kpi.visitsAttended} vieram${g.kpi.showRate != null ? ` (${pct(g.kpi.showRate)})` : ""}`}
        />
        <Stat label="Vendas" value={String(g.kpi.won)} hint={money(g.kpi.wonCents)} />
        <Stat label="Conversão" value={pct(g.kpi.conversion)} hint="vendas ÷ leads do período" />
      </div>
      {g.kpi.visitsUnmarked > 0 && (
        <Link
          href="/agenda?ver=passadas"
          className="mt-3 block rounded-xl bg-warn-soft px-4 py-2.5 text-[14px] text-warn"
        >
          {g.kpi.visitsUnmarked} visita(s) já passaram e estão sem resultado. Marque se o cliente veio.
        </Link>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel
          title="Esperando resposta agora"
          right={
            <Badge tone={g.waiting.count ? "danger" : "ok"}>
              {g.waiting.count ? `${g.waiting.count} cliente(s)` : "em dia"}
            </Badge>
          }
          testId="esperando"
        >
          {g.waiting.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-ink-2">
              Nenhum cliente esperando há mais de 10 minutos.
            </p>
          ) : (
            <ul className="divide-y divide-separator">
              {g.waiting.items.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/conversas?c=${w.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-fill/60"
                  >
                    <MessageCircle size={18} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{w.name}</span>
                      <span className="block truncate text-[13px] text-ink-2">
                        {w.assignee ?? "Sem responsável"}
                        {w.preview ? ` · ${w.preview}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-danger">
                      <Clock size={14} />
                      {duration((Date.now() - w.since.getTime()) / 1000)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {g.waiting.count > g.waiting.items.length && (
            <Link href="/conversas" className="block px-4 py-3 text-[14px] font-medium text-accent">
              Ver todas as conversas
            </Link>
          )}
        </Panel>

        <Panel title="Tempo de resposta" testId="sla">
          <div className="grid grid-cols-2 gap-4 p-4">
            <Mini label="1ª resposta (mediana)" value={duration(g.sla.medianSeconds)} />
            <Mini
              label="Respondidos em até 5 min"
              value={g.sla.total ? pct(g.sla.within5 / g.sla.total) : "–"}
            />
            <Mini label="1ª resposta de uma pessoa" value={duration(g.sla.medianHumanSeconds)} />
            <Mini
              label="Sem nenhuma resposta"
              value={String(g.sla.total - g.sla.answered)}
              tone={g.sla.total - g.sla.answered ? "danger" : undefined}
            />
          </div>
          <p className="px-4 pb-4 text-[12px] text-ink-3">
            Clientes que escreveram pela primeira vez no período ({g.sla.total}). Conta resposta da IA e da
            equipe.
          </p>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Funil agora" testId="funil">
          {g.funnel.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-ink-2">Sem funil configurado.</p>
          ) : (
            <ul className="space-y-3 p-4">
              {g.funnel.map((f) => (
                <Bar
                  key={f.name}
                  label={f.name}
                  value={f.count}
                  max={maxFunnel}
                  right={`${f.count}${f.cents ? ` · ${money(f.cents)}` : ""}`}
                />
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="De onde vieram os leads" testId="origens">
          {g.sources.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-ink-2">Nenhum lead no período.</p>
          ) : (
            <ul className="space-y-3 p-4">
              {g.sources.map((s) => (
                <Bar
                  key={s.name}
                  label={s.name}
                  value={s.leads}
                  max={maxSource}
                  right={`${s.leads} lead${s.leads === 1 ? "" : "s"} · ${s.won} venda${s.won === 1 ? "" : "s"}`}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {g.manager && !g.userId && g.team.length > 0 && (
        <Panel title="Equipe no período" className="mt-6" testId="equipe-painel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2 font-medium">Pessoa</th>
                  <th className="px-2 py-2 text-right font-medium">Leads</th>
                  <th className="px-2 py-2 text-right font-medium">Visitas</th>
                  <th className="px-2 py-2 text-right font-medium">Vendas</th>
                  <th className="px-2 py-2 text-right font-medium">Valor</th>
                  <th className="px-2 py-2 text-right font-medium">Em aberto</th>
                  <th className="px-4 py-2 text-right font-medium">Esperando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {g.team.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/?p=${g.period}&pessoa=${t.id}`} className="font-medium hover:text-accent">
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.leads}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.visits}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.won}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {t.wonCents ? money(t.wonCents) : "–"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{t.open}</td>
                    <td
                      className={cx(
                        "px-4 py-2.5 text-right tabular-nums",
                        t.waiting > 0 && "font-semibold text-danger",
                      )}
                    >
                      {t.waiting}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {g.manager && (
        <Panel title="Agente de IA no período" className="mt-6" testId="ia-painel">
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
            <Mini label="Mensagens enviadas" value={String(g.ai.messages)} />
            <Mini label="Conversas atendidas" value={String(g.ai.conversations)} />
            <Mini label="Passadas para a equipe" value={String(g.ai.transfers)} />
            <Mini label="Visitas marcadas" value={String(g.ai.visits)} />
            <Mini
              label="Créditos do mês"
              value={`${(g.ai.usedCredits ?? 0).toLocaleString("pt-BR")} / ${(g.ai.limitCredits ?? 0).toLocaleString("pt-BR")}`}
            />
          </div>
        </Panel>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-surface p-4">
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <p className="mt-1 text-[30px] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[13px] text-ink-3">{hint}</p>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className={cx("text-[20px] font-semibold tabular-nums", tone === "danger" && "text-danger")}>
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  right,
  className,
  testId,
  children,
}: {
  title: string;
  right?: ReactNode;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cx("overflow-hidden rounded-[var(--radius-card)] bg-surface", className)}
      data-testid={testId}
    >
      <header className="flex items-center justify-between gap-3 border-b border-separator px-4 py-3">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function Bar({ label, value, max, right }: { label: string; value: number; max: number; right: string }) {
  return (
    <li title={`${label}: ${right}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[14px]">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-ink-2">{right}</span>
      </div>
      <div className="h-2 rounded-full bg-fill">
        <div
          className="h-2 rounded-full bg-accent"
          style={{ width: `${value ? Math.max(2, (value / max) * 100) : 0}%` }}
        />
      </div>
    </li>
  );
}
