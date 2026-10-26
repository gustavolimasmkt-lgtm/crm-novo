import { testMetaConnection } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (_req, ctx) =>
  Response.json({ results: await testMetaConnection(getDb(), ctx.actor, ctx.organizationId) }),
);
