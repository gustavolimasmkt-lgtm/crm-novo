import { bulkDeals, type DealFilter } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { filtersFrom } from "../filters";

export const dynamic = "force-dynamic";

type Body = { ids?: string[]; query?: string; action?: Parameters<typeof bulkDeals>[4] };

export const POST = withOrg(async (req, ctx) => {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  // "Todos do filtro" chega como a mesma query string da tela.
  const filter: DealFilter | undefined =
    typeof b.query === "string"
      ? { ...filtersFrom(new URLSearchParams(b.query)), page: undefined }
      : undefined;
  const r = await bulkDeals(
    getDb(),
    ctx.actor,
    ctx.organizationId,
    filter ? { filter } : { ids: Array.isArray(b.ids) ? b.ids.map(String) : [] },
    (b.action ?? {}) as Parameters<typeof bulkDeals>[4],
  );
  return Response.json(r);
});
