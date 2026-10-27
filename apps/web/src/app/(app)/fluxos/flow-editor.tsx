"use client";

import { ArrowDown, ArrowUp, Bell, Clock, ListTodo, MessageSquare, MoveRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveFlowAction } from "@/app/actions/flows";
import { Button, cx, Field, Input, Notice, Select } from "@/components/ui";

type Step =
  | { type: "message"; text: string }
  | { type: "wait"; minutes: number }
  | { type: "move_stage"; stageId: string }
  | { type: "task"; title: string; dueMinutes: number }
  | { type: "notify"; text: string };
type Trigger = "manual" | "lead_created" | "stage_entered" | "tag_added";
type Flow = {
  id: string;
  name: string;
  trigger: Trigger;
  triggerStageId: string | null;
  triggerTagId: string | null;
  stopOnReply: boolean;
  steps: Step[];
};

const STEP_INFO: Record<Step["type"], { label: string; icon: React.ReactNode }> = {
  message: { label: "Mensagem", icon: <MessageSquare size={16} /> },
  wait: { label: "Esperar", icon: <Clock size={16} /> },
  move_stage: { label: "Mover etapa", icon: <MoveRight size={16} /> },
  task: { label: "Criar tarefa", icon: <ListTodo size={16} /> },
  notify: { label: "Avisar responsável", icon: <Bell size={16} /> },
};
const UNITS = [
  { id: "min", label: "minutos", mult: 1 },
  { id: "h", label: "horas", mult: 60 },
  { id: "d", label: "dias", mult: 1440 },
] as const;

function splitMinutes(m: number) {
  if (m % 1440 === 0) return { n: m / 1440, unit: "d" as const };
  if (m % 60 === 0) return { n: m / 60, unit: "h" as const };
  return { n: m, unit: "min" as const };
}

function Duration({
  minutes,
  onChange,
  label,
}: {
  minutes: number;
  onChange: (m: number) => void;
  label: string;
}) {
  const { n, unit } = splitMinutes(minutes);
  const mult = (u: string) => UNITS.find((x) => x.id === u)?.mult ?? 1;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        value={n}
        aria-label={label}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)) * mult(unit))}
        className="w-24"
      />
      <Select
        value={unit}
        aria-label={`${label} (unidade)`}
        onChange={(e) => onChange(n * mult(e.target.value))}
        className="w-32"
      >
        {UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function FlowEditor({
  flow,
  stages,
  tags,
}: {
  flow: Flow | null;
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState<Flow>(
    flow ?? {
      id: "",
      name: "",
      trigger: "lead_created",
      triggerStageId: null,
      triggerTagId: null,
      stopOnReply: true,
      steps: [{ type: "message", text: "Oi {nome}! " }],
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setStep = (i: number, s: Step) =>
    setF((x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? s : y)) }));
  const move = (i: number, d: -1 | 1) =>
    setF((x) => {
      const steps = [...x.steps];
      const [s] = steps.splice(i, 1);
      if (s) steps.splice(i + d, 0, s);
      return { ...x, steps };
    });
  const add = (type: Step["type"]) =>
    setF((x) => ({
      ...x,
      steps: [
        ...x.steps,
        type === "message"
          ? { type, text: "" }
          : type === "wait"
            ? { type, minutes: 1440 }
            : type === "move_stage"
              ? { type, stageId: stages[0]?.id ?? "" }
              : type === "task"
                ? { type, title: "", dueMinutes: 0 }
                : { type, text: "" },
      ],
    }));

  function save() {
    setError(null);
    start(async () => {
      const r = await saveFlowAction(flow?.id ?? null, {
        name: f.name,
        trigger: f.trigger,
        triggerStageId: f.triggerStageId,
        triggerTagId: f.triggerTagId,
        stopOnReply: f.stopOnReply,
        steps: f.steps,
      });
      if (r.error) return setError(r.error);
      router.push("/fluxos");
      router.refresh();
    });
  }

  return (
    <div className="max-w-[760px] space-y-5">
      <section className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
        <Field label="Nome do fluxo">
          <Input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            maxLength={80}
            placeholder="Boas-vindas lead novo"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Começa quando">
            <Select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value as Trigger })}>
              <option value="lead_created">Entra um lead novo</option>
              <option value="stage_entered">Negociação entra numa etapa</option>
              <option value="tag_added">Negociação ganha uma etiqueta</option>
              <option value="manual">Alguém inicia na conversa</option>
            </Select>
          </Field>
          {f.trigger === "stage_entered" && (
            <Field label="Etapa">
              <Select
                value={f.triggerStageId ?? ""}
                onChange={(e) => setF({ ...f, triggerStageId: e.target.value || null })}
              >
                <option value="">Escolha</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {f.trigger === "tag_added" && (
            <Field label="Etiqueta">
              <Select
                value={f.triggerTagId ?? ""}
                onChange={(e) => setF({ ...f, triggerTagId: e.target.value || null })}
              >
                <option value="">Escolha</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={f.stopOnReply}
            onChange={(e) => setF({ ...f, stopOnReply: e.target.checked })}
            className="size-4 accent-[var(--accent)]"
          />
          Parar o fluxo quando o cliente responder
        </label>
        <p className="text-[12px] text-ink-3">
          Também para se a negociação for ganha ou perdida, ou se o cliente pedir SAIR. Mensagens saem só no
          horário de envio e pela proteção contra bloqueio (Agente de IA → Follow-up).
        </p>
      </section>

      <ol className="space-y-3">
        {f.steps.map((s, i) => (
          <li
            key={`${i}-${s.type}`}
            className="rounded-[var(--radius-card)] bg-surface p-4"
            data-testid="passo"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
                {i + 1}
              </span>
              <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                {STEP_INFO[s.type].icon} {STEP_INFO[s.type].label}
              </span>
              <div className="ml-auto flex items-center">
                <button
                  type="button"
                  aria-label={`Subir passo ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded-full p-1.5 text-ink-2 hover:bg-fill disabled:opacity-30"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Descer passo ${i + 1}`}
                  disabled={i === f.steps.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded-full p-1.5 text-ink-2 hover:bg-fill disabled:opacity-30"
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Remover passo ${i + 1}`}
                  onClick={() => setF((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }))}
                  className="rounded-full p-1.5 text-ink-3 hover:bg-fill"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {s.type === "message" && (
              <textarea
                value={s.text}
                onChange={(e) => setStep(i, { ...s, text: e.target.value })}
                rows={3}
                maxLength={2000}
                aria-label={`Mensagem do passo ${i + 1}`}
                placeholder="Use {nome} para o primeiro nome do cliente"
                className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
              />
            )}
            {s.type === "wait" && (
              <Duration
                minutes={s.minutes}
                label={`Espera do passo ${i + 1}`}
                onChange={(m) => setStep(i, { ...s, minutes: m })}
              />
            )}
            {s.type === "move_stage" && (
              <Select
                value={s.stageId}
                aria-label={`Etapa do passo ${i + 1}`}
                onChange={(e) => setStep(i, { ...s, stageId: e.target.value })}
              >
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </Select>
            )}
            {s.type === "task" && (
              <div className="space-y-3">
                <Input
                  value={s.title}
                  onChange={(e) => setStep(i, { ...s, title: e.target.value })}
                  maxLength={200}
                  aria-label={`Tarefa do passo ${i + 1}`}
                  placeholder="Ligar para o cliente"
                />
                <div className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
                  Para daqui a
                  <Duration
                    minutes={s.dueMinutes}
                    label={`Prazo da tarefa do passo ${i + 1}`}
                    onChange={(m) => setStep(i, { ...s, dueMinutes: m })}
                  />
                </div>
              </div>
            )}
            {s.type === "notify" && (
              <textarea
                value={s.text}
                onChange={(e) => setStep(i, { ...s, text: e.target.value })}
                rows={2}
                maxLength={1000}
                aria-label={`Aviso do passo ${i + 1}`}
                placeholder="Cliente {nome} não respondeu, liga pra ele"
                className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(STEP_INFO) as Step["type"][]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => add(t)}
            className={cx(
              "flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[14px] font-medium hover:bg-fill-strong",
            )}
          >
            + {STEP_INFO[t].label}
          </button>
        ))}
      </div>

      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar fluxo"}
        </Button>
        <Button variant="secondary" onClick={() => router.push("/fluxos")}>
          Cancelar
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        Depois de salvar, ligue o fluxo na lista para ele começar a rodar.
      </p>
    </div>
  );
}
