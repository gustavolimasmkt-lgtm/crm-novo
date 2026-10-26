import { DASHBOARD_PERIODS, getAdsReport } from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { cx, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";

export const metadata = { title: "Anúncios" };
export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v: number | null) => (v == null ? "–" : brl.format(v));

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ctx = await requirePermission("reports.view");
  const sp = await searchParams;
  const r = await getAdsReport(getDb(), ctx.actor, ctx.organization.id, { period: sp.p ?? "30d" });
  const cols = (spend: boolean) =>
    [
      "Leads",
      ...(spend ? ["Gasto", "Custo/lead"] : []),
      "Visitas",
      "Vendas",
      "Receita",
      ...(spend ? ["Custo/venda", "Retorno"] : []),
    ] as const;
  type Row = {
    key: string;
    name: string;
    leads: number;
    visits: number;
    won: number;
    wonCents: number;
    spend: number;
    cpl: number | null;
    costPerSale: number | null;
    roas: number | null;
  };
  const cells = (x: Row) => [
    String(x.leads),
    ...(r.hasSpend ? [money(x.spend), money(x.cpl)] : []),
    String(x.visits),
    String(x.won),
    money(x.wonCents / 100),
    ...(r.hasSpend ? [money(x.costPerSale), x.roas == null ? "–" : `${x.roas.toFixed(1)}x`] : []),
  ];
  const table = (title: string, rows: (Row & { campaign?: string })[], testId: string) => (
    <section className="overflow-hidden rounded-[var(--radius-card)] bg-surface" data-testid={testId}>
      <h2 className="border-b border-separator px-4 py-3 text-[16px] font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] text-ink-2">Nenhum lead de anúncio no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wide text-ink-3">
                <th className="px-4 py-2 font-medium">Nome</th>
                {cols(r.hasSpend).map((c) => (
                  <th key={c} className="px-2 py-2 text-right font-medium last:pr-4">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-separator">
              {rows.map((x) => (
                <tr key={x.key}>
                  <td className="max-w-[280px] px-4 py-2.5">
                    <span className="block truncate font-medium">{x.name}</span>
                    {x.campaign && (
                      <span className="block truncate text-[12px] text-ink-3">{x.campaign}</span>
                    )}
                  </td>
                  {cells(x).map((v, i) => (
                    <td key={`${x.key}-${i}`} className="px-2 py-2.5 text-right tabular-nums last:pr-4">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-fill/50 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                {cells(r.total).map((v, i) => (
                  <td key={`t-${i}`} className="px-2 py-2.5 text-right tabular-nums last:pr-4">
                    {v}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
  return (
    <>
      <PageHeader title="Anúncios" subtitle="Leads que vieram de anúncios da Meta e o que viraram" />
      <div className="mb-5 flex flex-wrap gap-2">
        {DASHBOARD_PERIODS.map((p) => (
          <Link
            key={p.id}
            href={`/anuncios?p=${p.id}`}
            className={cx(
              "rounded-full px-3 py-1.5 text-[14px] font-medium",
              r.period === p.id ? "bg-ink text-bg" : "bg-fill text-ink-2 hover:bg-fill-strong",
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
      {!r.hasSpend && (
        <div className="mb-5">
          <Notice tone="accent">
            {r.spendError
              ? `Não consegui ler o gasto na Meta: ${r.spendError}`
              : "Para ver gasto, custo por lead e retorno, conecte a conta de anúncios em Integração Meta."}
          </Notice>
        </div>
      )}
      <div className="space-y-6">
        {table("Por campanha", r.campaigns, "por-campanha")}
        {table("Por anúncio", r.ads, "por-anuncio")}
      </div>
      <p className="mt-4 text-[12px] text-ink-3">
        Lead de anúncio é quem chegou pelo botão do anúncio (clique para WhatsApp) ou tem a origem Meta Ads.
        Visitas contam negociações com visita marcada; vendas e receita contam o que já foi ganho.
      </p>
    </>
  );
}
