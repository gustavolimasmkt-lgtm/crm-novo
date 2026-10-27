import { listFlows, listPipelines, listTags, waitLabel } from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { FlowRow } from "./flow-row";

export const metadata = { title: "Fluxos" };
export const dynamic = "force-dynamic";

const TRIGGER: Record<string, string> = {
  manual: "Iniciado na conversa",
  lead_created: "Lead novo",
  stage_entered: "Entrou na etapa",
  tag_added: "Ganhou a etiqueta",
};

export default async function FlowsPage() {
  const ctx = await requirePermission("settings.manage");
  const db = getDb();
  const [items, pipelines, tagList] = await Promise.all([
    listFlows(db, ctx.organization.id),
    listPipelines(db, ctx.organization.id),
    listTags(db, ctx.organization.id),
  ]);
  const stageName = (id: string | null) =>
    pipelines.flatMap((p) => p.stages).find((s) => s.id === id)?.name ?? "?";
  const tagName = (id: string | null) => tagList.find((t) => t.id === id)?.name ?? "?";
  return (
    <>
      <PageHeader
        title="Fluxos"
        subtitle="Sequências automáticas de mensagens, esperas, tarefas e avisos"
        actions={
          <Link href="/fluxos/novo">
            <Button>Novo fluxo</Button>
          </Link>
        }
      />
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
          <p className="text-[17px] font-semibold">Nenhum fluxo</p>
          <p className="mx-auto mt-1 max-w-md text-[14px] text-ink-2">
            Ex.: lead novo recebe boas-vindas na hora, outra mensagem no dia seguinte e, se não responder em 3
            dias, vira tarefa para o vendedor ligar.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((f) => {
            const trigger =
              f.trigger === "stage_entered"
                ? `${TRIGGER[f.trigger]}: ${stageName(f.triggerStageId)}`
                : f.trigger === "tag_added"
                  ? `${TRIGGER[f.trigger]}: ${tagName(f.triggerTagId)}`
                  : TRIGGER[f.trigger];
            const msgs = f.steps.filter((s) => s.type === "message").length;
            const waits = f.steps
              .flatMap((s) => (s.type === "wait" ? [s.minutes] : []))
              .reduce((a, b) => a + b, 0);
            return (
              <FlowRow
                key={f.id}
                flow={{
                  id: f.id,
                  name: f.name,
                  active: f.active,
                  summary: `${trigger} · ${f.steps.length} passos · ${msgs} mensagem(ns)${waits ? ` · duração ${waitLabel(waits)}` : ""}${f.stopOnReply ? " · para se o cliente responder" : ""}`,
                  running: f.running,
                  finished: f.finished,
                  stopped: f.stopped,
                }}
              />
            );
          })}
        </ul>
      )}
    </>
  );
}
