import { startFlow } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { conversationId?: string };
  const runId = await startFlow(getDb(), ctx.actor, ctx.organizationId, id, String(b.conversationId ?? ""));
  return Response.json({ id: runId });
});
