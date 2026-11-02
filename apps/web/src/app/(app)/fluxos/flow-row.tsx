"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteFlowAction, duplicateFlowAction, setFlowActiveAction } from "@/app/actions/flows";
import { Badge, Button, Notice } from "@/components/ui";
import { DispatchPanel } from "./dispatch";

export function FlowRow({
  flow,
  tags,
  stages,
  dailyLimit,
}: {
  tags: { id: string; name: string; kind: "organize" | "dispatch" }[];
  stages: { id: string; name: string }[];
  dailyLimit: number;
  flow: {
    id: string;
    name: string;
    active: boolean;
    summary: string;
    running: number;
    finished: number;
    stopped: number;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const run = (fn: () => Promise<{ error?: string } | object>) =>
    start(async () => {
      setError(null);
      const r = (await fn()) as { error?: string };
      if (r?.error) setError(r.error);
    });
  return (
    <li className="rounded-[var(--radius-card)] bg-surface p-4" data-testid="fluxo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold">{flow.name}</p>
          <p className="text-[13px] text-ink-2">{flow.summary}</p>
          <p className="mt-1 text-[13px] text-ink-3">
            {flow.running} rodando · {flow.finished} concluídos · {flow.stopped} parados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={flow.active ? "ok" : "neutral"}>{flow.active ? "Ligado" : "Desligado"}</Badge>
          {flow.active && (
            <Button size="sm" onClick={() => setDispatching((v) => !v)}>
              Disparar
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => setFlowActiveAction(flow.id, !flow.active))}
          >
            {flow.active ? "Desligar" : "Ligar"}
          </Button>
          <Link href={`/fluxos/${flow.id}`}>
            <Button size="sm" variant="secondary">
              Editar
            </Button>
          </Link>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await duplicateFlowAction(flow.id);
                if (r.error) setError(r.error);
                else if (r.id) router.push(`/fluxos/${r.id}`);
              })
            }
          >
            Duplicar
          </Button>
          <Button
            size="sm"
            variant="plain"
            disabled={pending}
            onClick={() => confirm(`Excluir o fluxo "${flow.name}"?`) && run(() => deleteFlowAction(flow.id))}
          >
            Excluir
          </Button>
        </div>
      </div>
      {dispatching && (
        <DispatchPanel
          flowId={flow.id}
          flowName={flow.name}
          tags={tags}
          stages={stages}
          dailyLimit={dailyLimit}
          onClose={() => setDispatching(false)}
        />
      )}
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </li>
  );
}
