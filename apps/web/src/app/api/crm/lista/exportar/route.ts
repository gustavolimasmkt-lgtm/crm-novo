import { exportDealsCsv } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { filtersFrom } from "../filters";

export const dynamic = "force-dynamic";

export const GET = withOrg(async (req, ctx) => {
  const csv = await exportDealsCsv(
    getDb(),
    ctx.actor,
    ctx.organizationId,
    filtersFrom(new URL(req.url).searchParams),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="negociacoes-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
});
