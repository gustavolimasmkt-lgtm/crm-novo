"use client";

import { Check, ListTodo, MessageCircle, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useState, useTransition } from "react";
import { createTaskAction, deleteTaskAction, setTaskDoneAction } from "@/app/actions/productivity";
import { Button, cx, Field, Input, Notice, Select } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  doneAt: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dealNumber: number | null;
  contactName: string | null;
  conversationId: string | null;
};

const tz = "America/Sao_Paulo";
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: tz,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00-03:00`);
  return keyFmt.format(new Date(d.getTime() + n * 86_400_000));
}

export function TasksClient({
  items,
  done,
  people,
  meId,
  canAssign,
  showAssignee,
  deal,
  todayIso,
}: {
  items: Task[];
  done: boolean;
  people: { id: string; name: string }[];
  meId: string;
  canAssign: boolean;
  showAssignee: boolean;
  deal: { id: string; number: number; title: string } | null;
  todayIso: string;
}) {
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const tomorrow = addDays(todayIso, 1);

  const groups: { title: string; tone?: "danger"; list: Task[] }[] = done
    ? [{ title: "Concluídas", list: items }]
    : [
        { title: "Atrasadas", tone: "danger", list: items.filter((t) => new Date(t.dueAt).getTime() < now) },
        {
          title: "Hoje",
          list: items.filter(
            (t) => new Date(t.dueAt).getTime() >= now && keyFmt.format(new Date(t.dueAt)) === todayIso,
          ),
        },
        { title: "Amanhã", list: items.filter((t) => keyFmt.format(new Date(t.dueAt)) === tomorrow) },
        {
          title: "Próximas",
          list: items.filter((t) => keyFmt.format(new Date(t.dueAt)) > tomorrow),
        },
      ];

  function run(fn: () => Promise<{ error?: string } | undefined | object>) {
    setError(null);
    start(async () => {
      const r = (await fn()) as { error?: string } | undefined;
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="space-y-5">
      {!done && (
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> Nova tarefa
        </Button>
      )}
      {error && <Notice>{error}</Notice>}
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
          <ListTodo className="mx-auto text-ink-3" size={32} />
          <p className="mt-3 text-[17px] font-semibold">
            {done ? "Nenhuma tarefa concluída" : "Nada pendente"}
          </p>
          <p className="mt-1 text-[14px] text-ink-2">
            {done
              ? "As tarefas marcadas como feitas aparecem aqui."
              : "Crie lembretes de ligar, mandar proposta, cobrar documento."}
          </p>
        </div>
      ) : (
        groups
          .filter((g) => g.list.length)
          .map((g) => (
            <section key={g.title}>
              <h2
                className={cx(
                  "mb-2 px-1 text-[13px] font-medium uppercase tracking-wide",
                  g.tone === "danger" ? "text-danger" : "text-ink-3",
                )}
              >
                {g.title} · {g.list.length}
              </h2>
              <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
                {g.list.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-3" data-testid="tarefa">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setTaskDoneAction(t.id, !t.doneAt))}
                      aria-label={t.doneAt ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
                      className={cx(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                        t.doneAt ? "border-ok bg-ok text-white" : "border-separator hover:border-accent",
                      )}
                    >
                      {t.doneAt && <Check size={14} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cx("text-[15px] font-medium", t.doneAt && "text-ink-3 line-through")}>
                        {t.title}
                      </p>
                      <p
                        className={cx(
                          "text-[13px]",
                          !t.doneAt && new Date(t.dueAt).getTime() < now
                            ? "font-medium text-danger"
                            : "text-ink-2",
                        )}
                      >
                        {dateFmt.format(new Date(t.dueAt))} às {timeFmt.format(new Date(t.dueAt))}
                        {showAssignee && ` · ${t.assignedUserName ?? "sem responsável"}`}
                      </p>
                      {(t.contactName || t.dealNumber) && (
                        <p className="text-[13px] text-ink-2">
                          {t.dealNumber && (
                            <Link href={`/crm?n=${t.dealId}`} className="text-accent hover:underline">
                              #{t.dealNumber} {t.dealTitle}
                            </Link>
                          )}
                          {t.dealNumber && t.contactName && " · "}
                          {t.contactName}
                        </p>
                      )}
                      {t.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-2">{t.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {t.conversationId && (
                        <Link
                          href={`/conversas?c=${t.conversationId}`}
                          aria-label="Abrir conversa"
                          className="rounded-full p-2 text-accent hover:bg-accent-soft"
                        >
                          <MessageCircle size={18} />
                        </Link>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Excluir ${t.title}`}
                        onClick={() => confirm("Excluir esta tarefa?") && run(() => deleteTaskAction(t.id))}
                        className="rounded-full p-2 text-ink-3 hover:bg-fill"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}

      {creating && (
        <NewTask
          people={people}
          meId={meId}
          canAssign={canAssign}
          deal={deal}
          todayIso={todayIso}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function NewTask({
  people,
  meId,
  canAssign,
  deal,
  todayIso,
  onClose,
}: {
  people: { id: string; name: string }[];
  meId: string;
  canAssign: boolean;
  deal: { id: string; number: number; title: string } | null;
  todayIso: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(async (s, fd) => {
    const r = await createTaskAction(s, fd);
    if (r.ok) onClose();
    return r;
  }, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nova tarefa"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-bg p-5 md:max-w-[480px] md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">Nova tarefa</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-2 hover:bg-fill"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {deal && (
            <>
              <input type="hidden" name="dealId" value={deal.id} />
              <p className="rounded-xl bg-surface px-3 py-2 text-[14px] text-ink-2">
                Negociação #{deal.number} · {deal.title}
              </p>
            </>
          )}
          <Field label="O que fazer">
            <Input name="title" required maxLength={200} placeholder="Ligar para confirmar o financiamento" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Dia">
              <Input name="date" type="date" required defaultValue={todayIso} />
            </Field>
            <Field label="Hora">
              <Input name="time" type="time" required defaultValue="09:00" />
            </Field>
          </div>
          {canAssign && (
            <Field label="Responsável">
              <Select name="assignedUserId" defaultValue={meId}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Observação">
            <Input name="notes" maxLength={2000} />
          </Field>
          {state.error && <Notice>{state.error}</Notice>}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Criando..." : "Criar tarefa"}
          </Button>
        </form>
      </div>
    </div>
  );
}
