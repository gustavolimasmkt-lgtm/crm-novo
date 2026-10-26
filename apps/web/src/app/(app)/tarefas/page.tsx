import { brParts, can, listAssignableUsers, listTasks } from "@crm/core";
import { deals, getDb } from "@crm/db";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { cx, PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { TasksClient } from "./tasks-client";

export const metadata = { title: "Tarefas" };
export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; quem?: string; negociacao?: string }>;
}) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const db = getDb();
  const manager = can(ctx.actor, "deals.view_all");
  const done = sp.ver === "concluidas";
  const mine = !manager || sp.quem !== "todas";
  const dealId = sp.negociacao && /^[0-9a-f-]{36}$/i.test(sp.negociacao) ? sp.negociacao : undefined;
  const deal = dealId
    ? await db.query.deals.findFirst({
        where: and(eq(deals.id, dealId), eq(deals.organizationId, ctx.organization.id)),
      })
    : null;
  const [items, people] = await Promise.all([
    listTasks(db, ctx.actor, ctx.organization.id, {
      done,
      mine: deal ? false : mine,
      dealId: deal?.id,
      limit: done ? 50 : 300,
    }),
    listAssignableUsers(db, ctx.organization.id),
  ]);
  const q = (o: { ver?: string; quem?: string }) => {
    const p = new URLSearchParams();
    if (o.ver) p.set("ver", o.ver);
    if (o.quem) p.set("quem", o.quem);
    if (deal) p.set("negociacao", deal.id);
    const s = p.toString();
    return s ? `/tarefas?${s}` : "/tarefas";
  };
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
        title="Tarefas"
        subtitle={
          deal
            ? `Negociação #${deal.number} · ${deal.title}`
            : "Quem tem o WhatsApp em Conta recebe aviso na hora da tarefa"
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {chip("A fazer", q({ quem: sp.quem }), !done)}
        {chip("Concluídas", q({ ver: "concluidas", quem: sp.quem }), done)}
        {manager && !deal && (
          <>
            <span className="mx-1 w-px bg-separator" />
            {chip("Minhas", q({ ver: done ? "concluidas" : undefined }), mine)}
            {chip("Todas", q({ ver: done ? "concluidas" : undefined, quem: "todas" }), !mine)}
          </>
        )}
        {deal && chip("Ver todas as tarefas", "/tarefas", false)}
      </div>
      <TasksClient
        items={items.map((t) => ({
          ...t,
          dueAt: t.dueAt.toISOString(),
          doneAt: t.doneAt?.toISOString() ?? null,
        }))}
        done={done}
        people={people}
        meId={ctx.user.id}
        canAssign={can(ctx.actor, "deals.reassign")}
        showAssignee={manager}
        deal={deal ? { id: deal.id, number: deal.number, title: deal.title } : null}
        todayIso={brParts(new Date()).date}
      />
    </>
  );
}
