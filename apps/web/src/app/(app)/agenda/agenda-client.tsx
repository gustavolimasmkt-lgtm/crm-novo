"use client";

import { Bot, CalendarPlus, MessageCircle, Settings2, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useState, useTransition } from "react";
import {
  createAppointmentAction,
  saveScheduleAction,
  setAppointmentStatusAction,
} from "@/app/actions/agenda";
import { Badge, Button, Field, Input, Notice, Select } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Status = "scheduled" | "attended" | "no_show" | "canceled";
type Item = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: Status;
  notes: string | null;
  createdByAi: boolean;
  contactName: string | null;
  contactPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  conversationId: string | null;
};
type Settings = {
  aiCanBook: boolean;
  durationMinutes: number;
  perSlot: number;
  hours: Record<string, [string, string] | null>;
};

const STATUS: Record<Status, { label: string; tone: "accent" | "ok" | "warn" | "neutral" }> = {
  scheduled: { label: "Marcada", tone: "accent" },
  attended: { label: "Compareceu", tone: "ok" },
  no_show: { label: "Não veio", tone: "warn" },
  canceled: { label: "Cancelada", tone: "neutral" },
};
const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const tz = "America/Sao_Paulo";
const dayFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: tz,
  weekday: "long",
  day: "2-digit",
  month: "long",
});
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });

export function AgendaClient({
  items,
  past,
  people,
  meId,
  canReassign,
  canConfigure,
  settings,
  todayIso,
}: {
  items: Item[];
  past: boolean;
  people: { id: string; name: string }[];
  meId: string;
  canReassign: boolean;
  canConfigure: boolean;
  settings: Settings;
  todayIso: string;
}) {
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [pending, startStatus] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const groups = new Map<string, Item[]>();
  for (const a of items) {
    const k = keyFmt.format(new Date(a.startsAt));
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  function setStatus(id: string, status: Status) {
    setError(null);
    startStatus(async () => {
      const r = await setAppointmentStatusAction(id, status);
      if (r && "error" in r && r.error) setError(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCreating(true)}>
          <CalendarPlus size={16} /> Marcar visita
        </Button>
        {canConfigure && (
          <Button variant="secondary" onClick={() => setConfiguring(true)}>
            <Settings2 size={16} /> Horários e IA
          </Button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}

      {items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
          <p className="text-[17px] font-semibold">
            {past ? "Nenhuma visita nos últimos 30 dias" : "Nenhuma visita marcada"}
          </p>
          <p className="mt-1 text-[14px] text-ink-2">
            {settings.aiCanBook
              ? "Quando o agente de IA ou alguém da equipe marcar, aparece aqui."
              : "Marque pelo botão acima. Para a IA marcar sozinha, ligue em Horários e IA."}
          </p>
        </div>
      ) : (
        [...groups.entries()].map(([k, list]) => (
          <section key={k}>
            <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-ink-3">
              {k === todayIso ? "Hoje · " : ""}
              {dayFmt.format(new Date(list[0]?.startsAt ?? k))}
            </h2>
            <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
              {list.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid="visita">
                  <div className="w-14 shrink-0 pt-0.5 text-[17px] font-semibold tabular-nums">
                    {timeFmt.format(new Date(a.startsAt))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[15px] font-medium ${a.status === "canceled" ? "line-through text-ink-3" : ""}`}
                    >
                      {a.contactName || a.contactPhone || a.title}
                    </p>
                    <p className="text-[13px] text-ink-2">
                      {[a.contactPhone, a.assignedUserName ? `com ${a.assignedUserName}` : "sem responsável"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {a.notes && <p className="mt-1 text-[13px] text-ink-2">{a.notes}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                      {a.createdByAi && (
                        <Badge>
                          <Bot size={12} className="mr-1" /> Marcada pela IA
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.conversationId && (
                      <Link
                        href={`/conversas?c=${a.conversationId}`}
                        aria-label="Abrir conversa"
                        className="rounded-full p-2 text-accent hover:bg-accent-soft"
                      >
                        <MessageCircle size={18} />
                      </Link>
                    )}
                    {a.status === "scheduled" ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setStatus(a.id, "attended")}
                        >
                          Compareceu
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setStatus(a.id, "no_show")}
                        >
                          Não veio
                        </Button>
                        <Button
                          size="sm"
                          variant="plain"
                          disabled={pending}
                          onClick={() => confirm("Cancelar esta visita?") && setStatus(a.id, "canceled")}
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="plain"
                        disabled={pending}
                        onClick={() => setStatus(a.id, "scheduled")}
                      >
                        Reabrir
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {creating && (
        <Sheet title="Marcar visita" onClose={() => setCreating(false)}>
          <NewAppointment
            people={people}
            meId={meId}
            canReassign={canReassign}
            todayIso={todayIso}
            onDone={() => setCreating(false)}
          />
        </Sheet>
      )}
      {configuring && (
        <Sheet title="Horários e IA" onClose={() => setConfiguring(false)}>
          <ScheduleForm settings={settings} />
        </Sheet>
      )}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-bg p-5 md:max-w-[520px] md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-2 hover:bg-fill"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useForm(fn: (s: FormState, fd: FormData) => Promise<FormState>) {
  const [state, action, pending] = useActionState<FormState, FormData>(fn, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  return { state, pending, onSubmit };
}

function NewAppointment({
  people,
  meId,
  canReassign,
  todayIso,
  onDone,
}: {
  people: { id: string; name: string }[];
  meId: string;
  canReassign: boolean;
  todayIso: string;
  onDone: () => void;
}) {
  const { state, pending, onSubmit } = useForm(async (s, fd) => {
    const r = await createAppointmentAction(s, fd);
    if (r.ok) onDone();
    return r;
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Telefone do cliente">
          <Input name="phone" required inputMode="tel" placeholder="(48) 99999-9999" />
        </Field>
        <Field label="Nome" hint="Se o contato ainda não existir">
          <Input name="contactName" maxLength={80} />
        </Field>
        <Field label="Dia">
          <Input name="date" type="date" required min={todayIso} defaultValue={todayIso} />
        </Field>
        <Field label="Hora">
          <Input name="time" type="time" required step={300} defaultValue="10:00" />
        </Field>
      </div>
      {canReassign && (
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
        <Input name="notes" maxLength={2000} placeholder="Quer ver o HR-V prata" />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Marcando..." : "Marcar"}
      </Button>
    </form>
  );
}

function ScheduleForm({ settings }: { settings: Settings }) {
  const { state, pending, onSubmit } = useForm(saveScheduleAction);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="flex items-center justify-between gap-4 rounded-xl bg-surface px-4 py-3">
        <span>
          <span className="block text-[15px] font-semibold">IA pode marcar visitas</span>
          <span className="block text-[13px] text-ink-2">
            O agente consulta os horários livres e marca sozinho. Quem é responsável pelo cliente recebe
            aviso.
          </span>
        </span>
        <input
          type="checkbox"
          name="aiCanBook"
          defaultChecked={settings.aiCanBook}
          className="size-5 accent-[var(--accent)]"
        />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Duração da visita (min)">
          <Input
            name="durationMinutes"
            type="number"
            min={10}
            max={240}
            defaultValue={settings.durationMinutes}
          />
        </Field>
        <Field label="Visitas no mesmo horário">
          <Input name="perSlot" type="number" min={1} max={50} defaultValue={settings.perSlot} />
        </Field>
      </div>
      <div className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
        {DAYS.map((name, d) => {
          const h = settings.hours[String(d)];
          return (
            <div key={name} className="flex items-center gap-3 px-4 py-2.5">
              <label className="flex w-28 items-center gap-2 text-[15px]">
                <input
                  type="checkbox"
                  name={`open${d}`}
                  defaultChecked={!!h}
                  className="size-4 accent-[var(--accent)]"
                />
                {name}
              </label>
              <Input
                name={`from${d}`}
                type="time"
                defaultValue={h?.[0] ?? "08:00"}
                className="w-28"
                aria-label={`${name} início`}
              />
              <span className="text-ink-3">até</span>
              <Input
                name={`to${d}`}
                type="time"
                defaultValue={h?.[1] ?? "18:00"}
                className="w-28"
                aria-label={`${name} fim`}
              />
            </div>
          );
        })}
      </div>
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && <Notice tone="ok">{state.message}</Notice>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}
