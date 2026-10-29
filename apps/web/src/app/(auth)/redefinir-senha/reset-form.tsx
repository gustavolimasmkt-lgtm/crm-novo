"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, {});
  return (
    <form action={action} className="space-y-4 rounded-[20px] bg-surface p-6">
      <input type="hidden" name="token" value={token} />
      <Field label="Nova senha" hint="Mínimo de 8 caracteres, com letras e números.">
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Repita a nova senha">
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      <Button size="lg" disabled={pending}>
        {pending ? "Salvando…" : "Salvar e entrar"}
      </Button>
    </form>
  );
}
