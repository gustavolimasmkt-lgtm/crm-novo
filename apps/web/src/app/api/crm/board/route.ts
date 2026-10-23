import { getBoard } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg(async (req, ctx) => {
  const u = new URL(req.url).searchParams;
  const board = await getBoard(getDb(), ctx.actor, ctx.organizationId, {
    pipelineId: u.get("funil") ?? undefined,
    q: u.get("q") ?? undefined,
    assignedUserId: u.get("responsavel") ?? undefined,
    tagId: u.get("etiqueta") ?? undefined,
  });
  return Response.json(board, { headers: { "cache-control": "no-store" } });
});
