import { listDeals } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { filtersFrom } from "./filters";

export const dynamic = "force-dynamic";

export const GET = withOrg(async (req, ctx) =>
  Response.json(
    await listDeals(getDb(), ctx.actor, ctx.organizationId, filtersFrom(new URL(req.url).searchParams)),
    { headers: { "cache-control": "no-store" } },
  ),
);
