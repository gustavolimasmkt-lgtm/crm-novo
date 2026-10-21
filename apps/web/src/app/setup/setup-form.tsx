"use client";

import { useActionState } from "react";
import { setupAction } from "@/app/actions/setup";
import { Button, Field, Input, Notice } from "@/components/ui";

export function SetupForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(setupAction, {});
  return (
    <form action={action} className="space-y-4 rounded-[20px] bg-surface p-6">
      <input type="hidden" name="token" value={token} />
      <Field label="Seu nome">
        <Input name="name" required autoComplete="name" />
      </Field>
      <Field label="E-mail">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Senha" hint="Mínimo de 8 caracteres, com letras e números.">
        <Input name="password" type="password" required autoComplete="new-password" />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      <Button size="lg" disabled={pending}>
        {pending ? "Criando…" : "Criar conta Master"}
      </Button>
    </form>
  );
}
