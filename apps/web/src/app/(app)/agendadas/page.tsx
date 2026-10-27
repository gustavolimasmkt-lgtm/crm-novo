import { can, listUpcoming } from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { cx, PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { UpcomingList } from "./upcoming-list";

export const metadata = { title: "Mensagens agendadas" };
export const dynamic = "force-dynamic";

export default async function UpcomingPage({ searchParams }: { searchParams: Promise<{ minhas?: string }> }) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const manager = can(ctx.actor, "deals.view_all");
  const mine = !manager || sp.minhas === "1";
  const items = await listUpcoming(getDb(), ctx.actor, ctx.organization.id, { mine });
  const chip = (label: string, href: string, on: boolean) => (
    <Link
      href={href}
      className={cx(
        "rounded-full px-3 py-1.5 text-[14px] font-medium",
        on ? "bg-ink text-bg" : "bg-fill text-ink-2 hover:bg-fill-strong",
      )}
    >
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Mensagens agendadas"
        subtitle="Tudo que vai sair: mensagens agendadas nas conversas e próximos passos dos fluxos"
      />
      {manager && (
        <div className="mb-4 flex gap-2">
          {chip("Todas", "/agendadas", !mine)}
          {chip("Minhas", "/agendadas?minhas=1", mine)}
        </div>
      )}
      <UpcomingList items={items.map((i) => ({ ...i, at: i.at.toISOString() }))} />
    </>
  );
}
