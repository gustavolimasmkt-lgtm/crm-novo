import { can, listMembers, rotationOverview } from "@crm/core";
import { getDb, ROLE_LABELS } from "@crm/db";
import { revokeInviteAction } from "@/app/actions/team";
import { Avatar, Badge, GroupedList, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { RotationForm } from "./rotation-form";
import { InviteForm, MemberControls } from "./team-forms";

export const metadata = { title: "Equipe" };

export default async function TeamPage() {
  const ctx = await requirePermission("members.view");
  const [{ members, pending }, rotation] = await Promise.all([
    listMembers(getDb(), ctx.actor, ctx.organization.id),
    rotationOverview(getDb(), ctx.organization.id),
  ]);
  const canManage = can(ctx.actor, "members.manage");
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

  return (
    <>
      <PageHeader title="Equipe" subtitle={`${members.filter((m) => m.active).length} pessoas ativas`} />
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div>
          <GroupedList title="Pessoas">
            {members.map((m) => (
              <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[16px] font-medium ${m.active ? "" : "text-ink-3 line-through"}`}
                  >
                    {m.name}
                  </p>
                  <p className="truncate text-[13px] text-ink-2">{m.email}</p>
                </div>
                {canManage && m.userId !== ctx.user.id ? (
                  <MemberControls userId={m.userId} role={m.role} active={m.active} />
                ) : (
                  <Badge tone={m.role === "admin" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                )}
              </div>
            ))}
          </GroupedList>
          {pending.length > 0 && (
            <GroupedList title="Convites pendentes">
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{p.name || p.email}</p>
                    <p className="truncate text-[13px] text-ink-2">
                      {ROLE_LABELS[p.role]} · expira {fmt.format(p.expiresAt)}
                    </p>
                  </div>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="invitationId" value={p.id} />
                    <button className="text-[14px] font-medium text-danger">Cancelar</button>
                  </form>
                </div>
              ))}
            </GroupedList>
          )}
        </div>
        <div className="space-y-6">
          <InviteForm canInviteAdmin={canManage} />
          <RotationForm
            enabled={rotation.enabled}
            notify={rotation.notify}
            userIds={rotation.userIds}
            people={rotation.people}
            canEdit={can(ctx.actor, "settings.manage")}
          />
        </div>
      </div>
    </>
  );
}
