"use client";

import { CalendarClock, MessageCircle, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Notice } from "@/components/ui";

type Item = {
  kind: "scheduled" | "flow";
  id: string;
  at: string;
  text: string;
  contactName: string | null;
  conversationId: string | null;
  detail: string;
};
const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function UpcomingList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function cancel(i: Item) {
    if (!confirm(i.kind === "flow" ? "Parar este fluxo para o cliente?" : "Cancelar esta mensagem agendada?"))
      return;
    setError(null);
    start(async () => {
      const r = await fetch(
        i.kind === "flow" ? `/api/fluxos/execucoes/${i.id}/parar` : `/api/agendadas/${i.id}`,
        {
          method: i.kind === "flow" ? "POST" : "DELETE",
        },
      );
      if (!r.ok)
        setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não deu certo.");
      router.refresh();
    });
  }
  if (!items.length)
    return (
      <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
        <CalendarClock className="mx-auto text-ink-3" size={32} />
        <p className="mt-3 text-[17px] font-semibold">Nada programado</p>
        <p className="mt-1 text-[14px] text-ink-2">
          Agende pela conversa (botão de relógio) ou crie um fluxo em Fluxos.
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {error && <Notice>{error}</Notice>}
      <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {items.map((i) => (
          <li
            key={`${i.kind}-${i.id}`}
            className="flex flex-wrap items-start gap-3 px-4 py-3"
            data-testid="programada"
          >
            <div className="w-28 shrink-0 text-[14px] font-semibold tabular-nums">
              {fmt.format(new Date(i.at))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[15px] font-medium">
                {i.contactName ?? "Cliente"}
                <Badge tone={i.kind === "flow" ? "accent" : "neutral"}>
                  {i.kind === "flow" ? (
                    <>
                      <Workflow size={12} className="mr-1" /> Fluxo
                    </>
                  ) : (
                    "Agendada"
                  )}
                </Badge>
              </p>
              <p className="line-clamp-2 text-[14px] text-ink-2">{i.text}</p>
              <p className="text-[12px] text-ink-3">{i.detail}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {i.conversationId && (
                <Link
                  href={`/conversas?c=${i.conversationId}`}
                  aria-label="Abrir conversa"
                  className="rounded-full p-2 text-accent hover:bg-accent-soft"
                >
                  <MessageCircle size={18} />
                </Link>
              )}
              <Button size="sm" variant="plain" disabled={pending} onClick={() => cancel(i)}>
                {i.kind === "flow" ? "Parar" : "Cancelar"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
