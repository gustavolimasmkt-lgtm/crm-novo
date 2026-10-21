"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { inviteAction, updateMemberAction } from "@/app/actions/team";
import { Button, Field, Input, Notice, Select } from "@/components/ui";

const ROLES = [
  { value: "admin", label: "Administrador" },
  { value: "manager", label: "Gestor" },
  { value: "seller", label: "Vendedor" },
  { value: "agent", label: "Atendente" },
] as const;

export function InviteForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const [state, action, pending] = useActionState(inviteAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <aside>
      <h2 className="mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-ink-3">Convidar</h2>
      <form ref={formRef} action={action} className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
        <Field label="E-mail">
          <Input name="email" type="email" required placeholder="pessoa@empresa.com" />
        </Field>
        <Field label="Nome (opcional)">
          <Input name="name" />
        </Field>
        <Field label="Papel">
          <Select name="role" defaultValue="seller">
            {ROLES.filter((r) => canInviteAdmin || r.value === "seller" || r.value === "agent").map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        {state.error && <Notice>{state.error}</Notice>}
        {state.ok && (
          <div className="space-y-2">
            <Notice tone="ok">{state.message}</Notice>
            {state.data?.link && <CopyLink link={state.data.link} />}
          </div>
        )}
        <Button size="lg" disabled={pending}>
          {pending ? "Criando…" : "Criar convite"}
        </Button>
      </form>
    </aside>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-fill p-2 pl-3">
      <code className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{link}</code>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

export function MemberControls({ userId, role, active }: { userId: string; role: string; active: boolean }) {
  const [state, action, pending] = useActionState(updateMemberAction, {});
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <form action={action}>
          <input type="hidden" name="userId" value={userId} />
          <Select
            name="role"
            defaultValue={role}
            disabled={pending || !active}
            aria-label="Papel"
            className="h-8 w-[150px] text-[13px]"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </form>
        <form action={action}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="active" value={active ? "false" : "true"} />
          <Button size="sm" variant={active ? "danger" : "secondary"} disabled={pending}>
            {active ? "Desativar" : "Reativar"}
          </Button>
        </form>
      </div>
      {state.error && <p className="text-[12px] text-danger">{state.error}</p>}
    </div>
  );
}
