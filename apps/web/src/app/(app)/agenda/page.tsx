import {
  brParts,
  can,
  DEFAULT_REMINDER,
  getScheduleSettings,
  listAppointments,
  listAssignableUsers,
} from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { cx, PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { AgendaClient } from "./agenda-client";

export const metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; minhas?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireOrg();
  const db = getDb();
  const past = sp.ver === "passadas";
  const mine = sp.minhas === "1";
  // Meia-noite de hoje no horário de Brasília.
  const today = new Date(`${brParts(new Date()).date}T00:00:00-03:00`);
  const from = past ? new Date(today.getTime() - 30 * DAY) : today;
  const to = past ? today : new Date(today.getTime() + 60 * DAY);
  const [items, settings, people] = await Promise.all([
    listAppointments(db, ctx.actor, ctx.organization.id, { from, to, mine, status: "all" }),
    getScheduleSettings(db, ctx.organization.id),
    listAssignableUsers(db, ctx.organization.id),
  ]);
  const visible = past ? items.filter((a) => a.status !== "canceled").reverse() : items;
  const tab = (label: string, href: string, on: boolean) => (
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
  const q = (o: { ver?: string; minhas?: boolean }) => {
    const p = new URLSearchParams();
    if (o.ver) p.set("ver", o.ver);
    if (o.minhas) p.set("minhas", "1");
    const s = p.toString();
    return s ? `/agenda?${s}` : "/agenda";
  };
  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={settings.aiCanBook ? "Visitas · o agente de IA pode marcar" : "Visitas marcadas"}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {tab("Próximas", q({ minhas: mine }), !past)}
        {tab("Anteriores", q({ ver: "passadas", minhas: mine }), past)}
        <span className="mx-1 w-px bg-separator" />
        {tab("Todas", q({ ver: past ? "passadas" : undefined }), !mine)}
        {tab("Minhas", q({ ver: past ? "passadas" : undefined, minhas: true }), mine)}
      </div>
      <AgendaClient
        items={visible.map((a) => ({
          ...a,
          startsAt: a.startsAt.toISOString(),
          endsAt: a.endsAt.toISOString(),
        }))}
        past={past}
        people={people}
        meId={ctx.user.id}
        canReassign={can(ctx.actor, "deals.reassign")}
        canConfigure={can(ctx.actor, "settings.manage")}
        settings={{
          aiCanBook: settings.aiCanBook,
          durationMinutes: settings.durationMinutes,
          perSlot: settings.perSlot,
          hours: settings.hours,
          remindEnabled: settings.remindEnabled,
          remindHours: settings.remindHours,
          remindTemplate: settings.remindTemplate ?? "",
        }}
        defaultReminder={DEFAULT_REMINDER}
        todayIso={brParts(new Date()).date}
      />
    </>
  );
}
