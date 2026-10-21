"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
      <h2 className="text-[17px] font-semibold">Trocar senha</h2>
      <Field label="Senha atual">
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Nova senha" hint="Mínimo de 8 caracteres, com letras e números.">
        <Input name="next" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Repita a nova senha">
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      <Button disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
    </form>
  );
}
