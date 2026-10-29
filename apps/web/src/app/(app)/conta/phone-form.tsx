"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { setMyPhoneAction } from "@/app/actions/agenda";
import { Button, Field, Input, Notice } from "@/components/ui";
import type { FormState } from "@/lib/form";

export function PhoneForm({ phone }: { phone: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setMyPhoneAction, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
      <div>
        <h2 className="text-[17px] font-semibold">Seu WhatsApp para avisos</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Recebe aqui: lead novo do rodízio, cliente que a IA passou para você e visita marcada pela IA.
          Também é por aqui que chega o link de Esqueci minha senha. Deixe vazio para não receber.
        </p>
      </div>
      <Field label="Telefone com DDD">
        <Input name="phone" defaultValue={phone ?? ""} inputMode="tel" placeholder="(48) 99999-9999" />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar telefone"}
      </Button>
    </form>
  );
}
