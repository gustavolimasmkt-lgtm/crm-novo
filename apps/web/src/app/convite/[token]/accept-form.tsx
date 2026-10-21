"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

export function AcceptForm({
  token,
  userExists,
  suggestedName,
}: {
  token: string;
  userExists: boolean;
  suggestedName: string;
}) {
  const [state, action, pending] = useActionState(acceptInviteAction, {});
  return (
    <form action={action} className="space-y-4 rounded-[20px] bg-surface p-6">
      <input type="hidden" name="token" value={token} />
      {!userExists && (
        <Field label="Seu nome">
          <Input name="name" required defaultValue={suggestedName} autoComplete="name" />
        </Field>
      )}
      <Field
        label={userExists ? "Sua senha atual" : "Crie uma senha"}
        hint={
          userExists
            ? "Você já tem conta: confirme com a sua senha."
            : "Mínimo de 8 caracteres, com letras e números."
        }
      >
        <Input
          name="password"
          type="password"
          required
          autoComplete={userExists ? "current-password" : "new-password"}
        />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      <Button size="lg" disabled={pending}>
        {pending ? "Entrando…" : "Aceitar e entrar"}
      </Button>
    </form>
  );
}
