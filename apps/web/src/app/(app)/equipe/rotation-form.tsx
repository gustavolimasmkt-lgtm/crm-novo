"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { saveRotationAction } from "@/app/actions/agenda";
import { Badge, Button, Notice } from "@/components/ui";
import type { FormState } from "@/lib/form";

export function RotationForm({
  enabled,
  notify,
  userIds,
  people,
  canEdit,
}: {
  enabled: boolean;
  notify: boolean;
  userIds: string[];
  people: { id: string; name: string; phone: string | null }[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRotationAction, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
      <div>
        <h2 className="text-[17px] font-semibold">Distribuição de leads (rodízio)</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Cada lead novo do WhatsApp vai para a próxima pessoa da lista, em ordem. Quando a IA passa um
          atendimento, o responsável recebe aviso.
        </p>
      </div>
      <fieldset disabled={!canEdit} className="space-y-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-[15px]">Rodízio ligado</span>
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            className="size-5 accent-[var(--accent)]"
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-[15px]">Avisar por WhatsApp</span>
          <input
            type="checkbox"
            name="notify"
            defaultChecked={notify}
            className="size-5 accent-[var(--accent)]"
          />
        </label>
        <div className="divide-y divide-separator rounded-xl bg-fill/60">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                name="userIds"
                value={p.id}
                defaultChecked={userIds.includes(p.id)}
                className="size-4 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1 truncate text-[15px]">{p.name}</span>
              {p.phone ? <Badge tone="ok">avisos ok</Badge> : <Badge tone="warn">sem telefone</Badge>}
            </label>
          ))}
        </div>
        <p className="text-[12px] text-ink-3">
          Cada pessoa cadastra o próprio WhatsApp em Conta para receber os avisos. Os avisos saem pela conexão
          de WhatsApp da empresa.
        </p>
      </fieldset>
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar rodízio"}
        </Button>
      )}
    </form>
  );
}
