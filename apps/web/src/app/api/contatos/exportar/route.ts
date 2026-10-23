import { exportContactsCsv } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg(async (_req, ctx) => {
  const csv = await exportContactsCsv(getDb(), ctx.actor, ctx.organizationId);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contatos-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
});
