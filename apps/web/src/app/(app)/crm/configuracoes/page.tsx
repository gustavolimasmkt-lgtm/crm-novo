import { listInactivityRules, listPipelines, listSources, listTags } from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { InactivityRules } from "./inactivity";
import { Settings } from "./settings";

export const metadata = { title: "Configurar CRM" };
export const dynamic = "force-dynamic";

export default async function CrmSettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const db = getDb();
  const [pipes, tagList, sources, rules] = await Promise.all([
    listPipelines(db, ctx.organization.id),
    listTags(db, ctx.organization.id),
    listSources(db, ctx.organization.id),
    listInactivityRules(db, ctx.organization.id),
  ]);
  return (
    <>
      <Link href="/crm" className="text-[15px] font-medium text-accent">
        ‹ CRM
      </Link>
      <PageHeader
        title="Configurar CRM"
        subtitle="Funis, etapas, etiquetas, fontes e regras de inatividade"
      />
      <Settings
        pipelines={pipes.map((p) => ({
          id: p.id,
          name: p.name,
          isDefault: p.isDefault,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, kind: s.kind })),
        }))}
        tags={tagList.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        sources={sources.map((s) => ({ id: s.id, name: s.name, key: s.key }))}
      />
      <InactivityRules
        key={rules.map((r) => `${r.id}${r.active}`).join()}
        pipelines={pipes.map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        }))}
        rules={rules.map((r) => ({
          id: r.id,
          pipelineId: r.pipelineId,
          fromStageIds: r.fromStageIds,
          days: r.days,
          toStageId: r.toStageId,
          active: r.active,
        }))}
      />
    </>
  );
}
