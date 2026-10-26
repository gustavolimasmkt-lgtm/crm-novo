"use client";

import { Trash2, Zap } from "lucide-react";
import { type FormEvent, startTransition, useActionState, useState, useTransition } from "react";
import { deleteQuickReplyAction, saveQuickReplyAction } from "@/app/actions/productivity";
import { Button, Field, Input, Notice } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Item = { id: string; shortcut: string; body: string };

export function QuickRepliesClient({ items, canEdit }: { items: Item[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Item | null>(null);
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<FormState, FormData>(async (s, fd) => {
    const r = await saveQuickReplyAction(s, fd);
    if (r.ok) {
      setEditing(null);
      setKey((k) => k + 1);
    }
    return r;
  }, {});
  const [deleting, startDelete] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        {items.length === 0 ? (
          <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
            <Zap className="mx-auto text-ink-3" size={32} />
            <p className="mt-3 text-[17px] font-semibold">Nenhuma resposta rápida</p>
            <p className="mt-1 text-[14px] text-ink-2">
              Cadastre as mensagens que a equipe repete todo dia: endereço, financiamento, documentos.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {items.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3" data-testid="resposta">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-accent">/{r.shortcut}</p>
                  <p className="whitespace-pre-wrap text-[14px] text-ink-2">{r.body}</p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                      Editar
                    </Button>
                    <button
                      type="button"
                      disabled={deleting}
                      aria-label={`Excluir /${r.shortcut}`}
                      onClick={() =>
                        confirm(`Excluir /${r.shortcut}?`) &&
                        startDelete(async () => {
                          await deleteQuickReplyAction(r.id);
                        })
                      }
                      className="rounded-full p-2 text-ink-3 hover:bg-fill"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit ? (
        <form
          key={`${key}-${editing?.id ?? "nova"}`}
          onSubmit={onSubmit}
          className="h-fit space-y-4 rounded-[var(--radius-card)] bg-surface p-5"
        >
          <h2 className="text-[17px] font-semibold">
            {editing ? `Editar /${editing.shortcut}` : "Nova resposta"}
          </h2>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <Field label="Atalho" hint="Ex.: endereco, financiamento, docs">
            <Input
              name="shortcut"
              defaultValue={editing?.shortcut ?? ""}
              required
              maxLength={31}
              placeholder="endereco"
            />
          </Field>
          <Field label="Mensagem" hint="Use {nome} para o primeiro nome do cliente.">
            <textarea
              name="body"
              defaultValue={editing?.body ?? ""}
              required
              rows={6}
              maxLength={4000}
              className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
            />
          </Field>
          {state.error && <Notice>{state.error}</Notice>}
          {state.ok && !editing && <Notice tone="ok">{state.message}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
            {editing && (
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <p className="text-[14px] text-ink-2">Só administradores e gestores cadastram respostas rápidas.</p>
      )}
    </div>
  );
}
