import { listFlows, listPipelines, listTags } from "@crm/core";
import { getDb } from "@crm/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { FlowEditor } from "../flow-editor";

export const metadata = { title: "Fluxo" };
export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("settings.manage");
  const { id } = await params;
  const db = getDb();
  const [items, pipelines, tagList] = await Promise.all([
    listFlows(db, ctx.organization.id),
    listPipelines(db, ctx.organization.id),
    listTags(db, ctx.organization.id),
  ]);
  const flow = id === "novo" ? null : items.find((f) => f.id === id);
  if (id !== "novo" && !flow) notFound();
  return (
    <>
      <PageHeader
        title={flow ? flow.name : "Novo fluxo"}
        subtitle="Os passos rodam em ordem, um depois do outro"
      />
      <FlowEditor
        flow={
          flow
            ? {
                id: flow.id,
                name: flow.name,
                trigger: flow.trigger,
                triggerStageId: flow.triggerStageId,
                triggerTagId: flow.triggerTagId,
                stopOnReply: flow.stopOnReply,
                steps: flow.steps,
              }
            : null
        }
        stages={pipelines.flatMap((p) =>
          p.stages.map((s) => ({ id: s.id, name: pipelines.length > 1 ? `${p.name} · ${s.name}` : s.name })),
        )}
        tags={tagList.map((t) => ({ id: t.id, name: t.name }))}
      />
    </>
  );
}
