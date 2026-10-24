import { can, listProducts, MAX_PHOTOS } from "@crm/core";
import { getDb } from "@crm/db";
import { PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { CatalogClient } from "./catalog-client";

export const metadata = { title: "Catálogo" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const ctx = await requireOrg();
  const items = await listProducts(getDb(), ctx.organization.id);
  const active = items.filter((p) => p.active).length;
  return (
    <>
      <PageHeader
        title="Catálogo"
        subtitle={`${active} ${active === 1 ? "item ativo" : "itens ativos"} · o agente de IA consulta esta lista`}
      />
      <CatalogClient
        initial={items.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() }))}
        canEdit={can(ctx.actor, "settings.manage")}
        maxPhotos={MAX_PHOTOS}
      />
    </>
  );
}
