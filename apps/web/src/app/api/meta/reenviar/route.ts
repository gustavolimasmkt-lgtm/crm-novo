import { backfillCapi } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (_req, ctx) =>
  Response.json({ queued: await backfillCapi(getDb(), ctx.actor, ctx.organizationId) }),
);
