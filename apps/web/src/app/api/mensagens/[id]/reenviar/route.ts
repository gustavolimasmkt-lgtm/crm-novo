import { retryMessage } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  await retryMessage(getDb(), getEvolution(), ctx.actor, ctx.organizationId, id);
  return Response.json({ ok: true });
});
