"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction } from "@/app/actions/auth";
import { Button, Field, Input, Notice } from "@/components/ui";

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, {});
  return (
    <form action={action} className="space-y-4 rounded-[20px] bg-surface p-6">
      {state.ok ? (
        <>
          <Notice tone="ok">{state.message}</Notice>
          <p className="text-[14px] text-ink-2">
            Não chegou? Peça ao administrador da sua empresa: em Equipe ele gera um link de nova senha para
            você.
          </p>
        </>
      ) : (
        <>
          <Field label="E-mail">
            <Input name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com" />
          </Field>
          <Button size="lg" disabled={pending}>
            {pending ? "Enviando…" : "Mandar link"}
          </Button>
        </>
      )}
      <p className="text-center text-[14px]">
        <Link href="/login" className="font-medium text-accent">
          Voltar para o login
        </Link>
      </p>
    </form>
  );
}
