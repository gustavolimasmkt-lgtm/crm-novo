import { capiStatus, getMetaSettings } from "@crm/core";
import { getDb } from "@crm/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { MetaForm } from "./meta-form";

export const metadata = { title: "Integração Meta" };
export const dynamic = "force-dynamic";

export default async function MetaPage() {
  const ctx = await requirePermission("settings.manage");
  const db = getDb();
  const [settings, status] = await Promise.all([
    getMetaSettings(db, ctx.organization.id),
    capiStatus(db, ctx.organization.id),
  ]);
  return (
    <>
      <PageHeader
        title="Integração Meta"
        subtitle="Devolve visitas e vendas para a Meta otimizar os anúncios, e traz o gasto para calcular custo por lead e retorno"
      />
      <MetaForm
        settings={{ ...settings, capiEnabledAt: settings.capiEnabledAt?.toISOString() ?? null }}
        status={status}
        secretConfigured={Boolean(process.env.APP_SECRET && process.env.APP_SECRET.length >= 16)}
      />
    </>
  );
}
