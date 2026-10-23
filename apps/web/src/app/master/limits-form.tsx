"use client";

import { useActionState, useState } from "react";
import { updateLimitsAction } from "@/app/actions/connections";
import { Button, Field, Input, Notice } from "@/components/ui";

export function LimitsForm({
  organizationId,
  orgName,
  whatsappConnections,
  aiCreditsMonthly,
}: {
  organizationId: string;
  orgName: string;
  whatsappConnections: number;
  aiCreditsMonthly: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateLimitsAction, {});
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-8 rounded-full bg-fill px-3 text-[13px] font-medium hover:bg-fill-strong"
      >
        Limites
      </button>
    );
  return (
    <form
      action={action}
      className="mt-2 flex w-full flex-wrap items-end gap-2"
      aria-label={`Limites de ${orgName}`}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <Field label="Conexões WhatsApp">
        <Input
          name="whatsappConnections"
          type="number"
          min={0}
          max={50}
          defaultValue={whatsappConnections}
          className="h-9 w-28"
        />
      </Field>
      <Field label="Créditos IA/mês (1 = 1.000 tokens)">
        <Input
          name="aiCreditsMonthly"
          type="number"
          min={0}
          step={1000}
          defaultValue={aiCreditsMonthly}
          className="h-9 w-36"
        />
      </Field>
      <Button size="sm" disabled={pending}>
        Salvar limites
      </Button>
      <Button type="button" size="sm" variant="plain" onClick={() => setOpen(false)}>
        Fechar
      </Button>
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
    </form>
  );
}
