import { previewAudience } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (req, ctx) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return Response.json(await previewAudience(getDb(), ctx.actor, ctx.organizationId, b));
});
