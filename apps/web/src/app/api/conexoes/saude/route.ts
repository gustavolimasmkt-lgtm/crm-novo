import { connectionAlerts } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg(async (_req, ctx) =>
  Response.json(
    { alerts: await connectionAlerts(getDb(), ctx.organizationId) },
    { headers: { "cache-control": "no-store" } },
  ),
);
