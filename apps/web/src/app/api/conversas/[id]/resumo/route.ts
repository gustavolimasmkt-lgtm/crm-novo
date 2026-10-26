import { summarizeConversation } from "@crm/core";
import { getDb } from "@crm/db";
import { getAi } from "@/lib/ai";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  const summary = await summarizeConversation(getDb(), getAi(), ctx.organizationId, id, ctx.actor);
  return Response.json({ summary });
});
