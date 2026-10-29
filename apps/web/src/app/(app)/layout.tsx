import { can, listMyOrganizations } from "@crm/core";
import { getDb } from "@crm/db";
import { Notifier } from "@/components/notifier";
import { Shell } from "@/components/shell";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const orgs = await listMyOrganizations(getDb(), ctx.user.id, ctx.user.isMaster);
  return (
    <Shell
      user={ctx.user}
      org={{ id: ctx.organization.id, name: ctx.organization.name }}
      orgs={orgs.filter((o) => o.status === "active").map((o) => ({ id: o.id, name: o.name }))}
      canSeeTeam={can(ctx.actor, "members.view")}
      canManageConnections={can(ctx.actor, "connections.manage")}
      canConfigure={can(ctx.actor, "settings.manage")}
    >
      <Notifier />
      {children}
    </Shell>
  );
}
