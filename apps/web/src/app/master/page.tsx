import { listOrganizationsForMaster } from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { logoutAction, switchOrgAction } from "@/app/actions/auth";
import { setOrgStatusAction } from "@/app/actions/team";
import { Badge, GroupedList, PageHeader } from "@/components/ui";
import { requireMaster } from "@/lib/session";
import { CreateOrgForm } from "./create-org-form";
import { LimitsForm } from "./limits-form";

export const metadata = { title: "Master" };
export const dynamic = "force-dynamic";

export default async function MasterPage() {
  const ctx = await requireMaster();
  const orgs = await listOrganizationsForMaster(getDb());
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-8 md:px-10 md:pt-12">
      <div className="mb-2 flex items-center justify-between">
        {ctx.organization ? (
          <Link href="/" className="text-[15px] font-medium text-accent">
            ‹ Voltar para {ctx.organization.name}
          </Link>
        ) : (
          <span />
        )}
        <form action={logoutAction}>
          <button className="text-[15px] font-medium text-accent">Sair</button>
        </form>
      </div>
      <PageHeader title="Painel Master" subtitle={`${orgs.length} empresas`} />
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <GroupedList
          title="Empresas"
          footer="Empresa suspensa fica inacessível para os membros; o Master continua entrando."
        >
          {orgs.length === 0 && (
            <p className="px-4 py-6 text-[15px] text-ink-2">
              Nenhuma empresa ainda. Crie a primeira ao lado.
            </p>
          )}
          {orgs.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[16px] font-medium">
                  {o.name}
                  {o.status === "suspended" && <Badge tone="danger">Suspensa</Badge>}
                </p>
                <p className="text-[13px] text-ink-2">
                  {o.members} membros · {o.limits.whatsappConnections} conexões WhatsApp ·{" "}
                  {o.limits.aiCreditsMonthly.toLocaleString("pt-BR")} créditos/mês · desde{" "}
                  {fmt.format(o.createdAt)}
                </p>
              </div>
              <form action={switchOrgAction}>
                <input type="hidden" name="organizationId" value={o.id} />
                <button className="h-8 rounded-full bg-fill px-3 text-[13px] font-medium hover:bg-fill-strong">
                  Entrar
                </button>
              </form>
              <LimitsForm
                organizationId={o.id}
                orgName={o.name}
                whatsappConnections={o.limits.whatsappConnections}
                aiCreditsMonthly={o.limits.aiCreditsMonthly}
              />
              <form action={setOrgStatusAction}>
                <input type="hidden" name="organizationId" value={o.id} />
                <input type="hidden" name="status" value={o.status === "active" ? "suspended" : "active"} />
                <button
                  className={`h-8 rounded-full px-3 text-[13px] font-medium ${o.status === "active" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}
                >
                  {o.status === "active" ? "Suspender" : "Reativar"}
                </button>
              </form>
            </div>
          ))}
        </GroupedList>
        <CreateOrgForm />
      </div>
    </main>
  );
}
