"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4 rounded-[20px] bg-surface p-6">
      <Field label="E-mail">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.data?.email}
          placeholder="voce@empresa.com"
        />
      </Field>
      <Field label="Senha">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      <Button size="lg" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <p className="text-center text-[14px]">
        <Link href="/esqueci-senha" className="font-medium text-accent">
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}
