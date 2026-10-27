"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteFlowAction, setFlowActiveAction } from "@/app/actions/flows";
import { Badge, Button, Notice } from "@/components/ui";

export function FlowRow({
  flow,
}: {
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
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
            variant="plain"
            disabled={pending}
            onClick={() => confirm(`Excluir o fluxo "${flow.name}"?`) && run(() => deleteFlowAction(flow.id))}
          >
            Excluir
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </li>
  );
}
