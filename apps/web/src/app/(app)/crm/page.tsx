import { can, getBoard, listAssignableUsers, listSources, listTags } from "@crm/core";
import { getDb } from "@crm/db";
import { requireOrg } from "@/lib/session";
import { Board } from "./board";

export const metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ funil?: string; n?: string }>;
}) {
  const ctx = await requireOrg();
  const db = getDb();
  const sp = await searchParams;
  const [board, people, sources, tagList] = await Promise.all([
    getBoard(db, ctx.actor, ctx.organization.id, { pipelineId: sp.funil }),
    listAssignableUsers(db, ctx.organization.id),
    listSources(db, ctx.organization.id),
    listTags(db, ctx.organization.id),
  ]);
  return (
    <Board
      initial={JSON.parse(JSON.stringify(board))}
      initialOpen={sp.n ?? null}
      people={people}
      sources={sources.map((s) => ({ id: s.id, name: s.name }))}
      tags={tagList.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      me={ctx.user.id}
      canReassign={can(ctx.actor, "deals.reassign")}
      canDelete={can(ctx.actor, "deals.delete")}
      canSettings={can(ctx.actor, "settings.manage")}
    />
  );
}
