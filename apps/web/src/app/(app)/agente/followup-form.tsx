"use client";

import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, startTransition, useActionState, useState } from "react";
import { saveFollowupAction } from "@/app/actions/agent";
import { Button, Field, Input, Notice } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Step = { hours: number; text: string | null };

export function FollowupForm({
  settings,
}: {
  settings: {
    enabled: boolean;
    steps: Step[];
    windowStart: string;
    windowEnd: string;
    sundays: boolean;
    gapMinSeconds: number;
    gapMaxSeconds: number;
    dailyLimit: number;
  };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFollowupAction, {});
  const [steps, setSteps] = useState(settings.steps.map((s, i) => ({ ...s, key: i })));
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5"
      data-testid="followup"
    >
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-[17px] font-semibold">Follow-up automático</span>
          <span className="block text-[13px] text-ink-2">
            Quando o cliente para de responder à IA, ela retoma a conversa. Nunca entra em conversa em que um
            vendedor falou por último, nem em cliente com visita marcada ou negociação encerrada.
          </span>
        </span>
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
          aria-label="Follow-up ligado"
          className="size-5 shrink-0 accent-[var(--accent)]"
        />
      </label>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.key} className="space-y-2 rounded-xl bg-fill/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium">{i + 1}º follow-up após</span>
              <Input
                name="stepHours"
                type="number"
                min={1}
                max={720}
                defaultValue={s.hours}
                className="w-24"
                aria-label={`Horas do ${i + 1}º follow-up`}
              />
              <span className="text-[14px] text-ink-2">horas sem resposta</span>
              <button
                type="button"
                onClick={() => setSteps((x) => x.filter((y) => y.key !== s.key))}
                aria-label={`Remover ${i + 1}º follow-up`}
                className="ml-auto rounded-full p-2 text-ink-3 hover:bg-fill"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <textarea
              name="stepText"
              defaultValue={s.text ?? ""}
              rows={2}
              maxLength={1000}
              aria-label={`Texto do ${i + 1}º follow-up`}
              placeholder="Vazio: a IA escreve com base na conversa. Ou um texto fixo, ex.: Oi {nome}, ainda procurando carro?"
              className="w-full rounded-xl bg-surface px-3 py-2 text-[14px] outline-none focus:shadow-[0_0_0_4px_var(--accent-soft)]"
            />
          </li>
        ))}
      </ol>
      {steps.length < 5 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setSteps((x) => [
              ...x,
              {
                hours: (x.at(-1)?.hours ?? 24) * 2,
                text: null,
                key: Math.max(0, ...x.map((y) => y.key)) + 1,
              },
            ])
          }
        >
          <Plus size={14} /> Adicionar follow-up
        </Button>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Enviar a partir de">
          <Input name="windowStart" type="time" defaultValue={settings.windowStart} />
        </Field>
        <Field label="Até">
          <Input name="windowEnd" type="time" defaultValue={settings.windowEnd} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          name="sundays"
          defaultChecked={settings.sundays}
          className="size-4 accent-[var(--accent)]"
        />
        Enviar também aos domingos
      </label>
      <fieldset className="space-y-3 rounded-xl bg-fill/60 p-3">
        <legend className="px-1 text-[14px] font-semibold">Proteção contra bloqueio do número</legend>
        <p className="text-[12px] text-ink-2">
          Vale para follow-ups e lembretes de visita. Mensagens saem uma de cada vez por número, com intervalo
          aleatório, e param ao bater o limite do dia. Respostas da IA a quem acabou de escrever não esperam.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Intervalo mín. (s)">
            <Input
              name="gapMinSeconds"
              type="number"
              min={10}
              max={3600}
              defaultValue={settings.gapMinSeconds}
            />
          </Field>
          <Field label="Intervalo máx. (s)">
            <Input
              name="gapMaxSeconds"
              type="number"
              min={10}
              max={3600}
              defaultValue={settings.gapMaxSeconds}
            />
          </Field>
          <Field label="Limite por dia">
            <Input name="dailyLimit" type="number" min={1} max={1000} defaultValue={settings.dailyLimit} />
          </Field>
        </div>
      </fieldset>
      <p className="text-[12px] text-ink-3">
        Cada follow-up conta a partir da última mensagem. Se o cliente responder, a contagem recomeça.
        Follow-up escrito pela IA gasta créditos.
      </p>
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar follow-up"}
      </Button>
    </form>
  );
}
