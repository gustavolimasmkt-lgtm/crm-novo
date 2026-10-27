import { stopRun } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  await stopRun(getDb(), ctx.actor, ctx.organizationId, id);
  return Response.json({ ok: true });
});
