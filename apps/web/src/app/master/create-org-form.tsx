"use client";

import { useActionState } from "react";
import { CopyLink } from "@/app/(app)/equipe/team-forms";
import { createOrganizationAction } from "@/app/actions/team";
import { Button, Field, Input, Notice } from "@/components/ui";

export function CreateOrgForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, {});
  return (
    <aside>
      <h2 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-ink-3">Nova empresa</h2>
      <form action={action} className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
        <Field label="Nome da empresa">
          <Input name="name" required placeholder="Ex.: VitóriaMotors" />
        </Field>
        <Field label="Nome do administrador">
          <Input name="adminName" required />
        </Field>
        <Field label="E-mail do administrador" hint="Recebe o convite para criar a senha.">
          <Input name="adminEmail" type="email" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Conexões WhatsApp">
            <Input name="whatsappConnections" type="number" min={0} max={50} defaultValue={1} />
          </Field>
          <Field label="Créditos IA/mês" hint="1 crédito = 1.000 tokens">
            <Input name="aiCreditsMonthly" type="number" min={0} step={1000} defaultValue={50000} />
          </Field>
        </div>
        {state.error && <Notice>{state.error}</Notice>}
        {state.ok && (
          <div className="space-y-2">
            <Notice tone="ok">{state.message}</Notice>
            {state.data?.link && <CopyLink link={state.data.link} />}
          </div>
        )}
        <Button size="lg" disabled={pending}>
          {pending ? "Criando…" : "Criar empresa"}
        </Button>
      </form>
    </aside>
  );
}
