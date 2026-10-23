"use client";

import { Bot, SendHorizontal, Upload } from "lucide-react";
import { type FormEvent, startTransition, useActionState, useRef, useState } from "react";
import { saveAgentAction } from "@/app/actions/agent";
import { Badge, Button, cx, Field, Input, Notice, Select } from "@/components/ui";
import type { FormState } from "@/lib/form";

type AgentData = {
  name: string;
  active: boolean;
  connectionId: string;
  model: string;
  instructions: string;
  replyDelaySeconds: number;
  historyMessages: number;
  handoffMessage: string;
};

export function AgentForm({
  agent,
  models,
  connections,
  usage,
  tokensPerCredit,
  defaultHandoff,
  keyConfigured,
}: {
  agent: AgentData;
  models: { id: string; label: string }[];
  connections: { id: string; name: string }[];
  usage: { tokens: number; usedCredits: number; limitCredits: number; exhausted: boolean };
  tokensPerCredit: number;
  defaultHandoff: string;
  keyConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveAgentAction, {});
  const [form, setForm] = useState(agent);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof AgentData>(k: K, v: AgentData[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pct = usage.limitCredits
    ? Math.min(100, Math.round((usage.usedCredits / usage.limitCredits) * 100))
    : 100;

  async function importLegacy(file: File) {
    setImportMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/agente/importar", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) return setImportMsg(j.error ?? "Não consegui ler o arquivo.");
    setForm((f) => ({
      ...f,
      name: j.name,
      instructions: j.instructions,
      replyDelaySeconds: j.replyDelaySeconds,
      historyMessages: j.historyMessages,
    }));
    setImportMsg("Instruções importadas. Revise, teste no simulador e clique em Salvar.");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
      {/* onSubmit (e não action) para o React não limpar o formulário depois de salvar. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => action(fd));
        }}
        className="space-y-5"
      >
        {!keyConfigured && (
          <Notice>A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.</Notice>
        )}
        <div className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-[17px] font-semibold">Agente ligado</span>
              <span className="block text-[14px] text-ink-2">
                Responde sozinho as conversas novas e as que estiverem com a IA ativa.
              </span>
            </span>
            <input
              type="checkbox"
              name="active"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="h-6 w-6 accent-[var(--accent)]"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">
              <Input
                name="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                maxLength={60}
                required
              />
            </Field>
            <Field label="Atende a conexão">
              <Select
                name="connectionId"
                value={form.connectionId}
                onChange={(e) => set("connectionId", e.target.value)}
              >
                <option value="">Todas</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Modelo de IA" hint="Quanto mais capaz, mais créditos gasta por resposta.">
            <Select name="model" value={form.model} onChange={(e) => set("model", e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="space-y-3 rounded-[var(--radius-card)] bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[17px] font-semibold">Instruções</h2>
            <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Importar do sistema antigo
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="agent-import"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importLegacy(f);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-[14px] text-ink-2">
            Quem é a empresa, o que vende, como falar, o que perguntar e quando passar para um vendedor. A IA
            só usa o que estiver aqui; o que não souber, ela passa para a equipe.
          </p>
          {importMsg && (
            <Notice tone={importMsg.startsWith("Instruções") ? "ok" : "danger"}>{importMsg}</Notice>
          )}
          <textarea
            name="instructions"
            value={form.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            rows={16}
            maxLength={60_000}
            aria-label="Instruções do agente"
            placeholder="Ex.: Você é o assistente da Loja X, que vende carros seminovos em Criciúma. Cumprimente, pergunte o nome e qual carro a pessoa procura..."
            className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] leading-relaxed outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
          />
          <p className="text-right text-[12px] text-ink-3">
            {form.instructions.length.toLocaleString("pt-BR")} caracteres
          </p>
        </div>

        <div className="grid gap-4 rounded-[var(--radius-card)] bg-surface p-5 sm:grid-cols-2">
          <Field
            label="Esperar antes de responder (segundos)"
            hint="Junta mensagens enviadas em sequência numa resposta só."
          >
            <Input
              name="replyDelaySeconds"
              type="number"
              min={0}
              max={180}
              value={form.replyDelaySeconds}
              onChange={(e) => set("replyDelaySeconds", Number(e.target.value))}
            />
          </Field>
          <Field label="Mensagens de histórico" hint="Quantas mensagens anteriores a IA lê.">
            <Input
              name="historyMessages"
              type="number"
              min={4}
              max={60}
              value={form.historyMessages}
              onChange={(e) => set("historyMessages", Number(e.target.value))}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Mensagem ao passar para um humano"
              hint="Usada se a IA não escrever a própria despedida."
            >
              <Input
                name="handoffMessage"
                value={form.handoffMessage}
                onChange={(e) => set("handoffMessage", e.target.value)}
                placeholder={defaultHandoff}
                maxLength={500}
              />
            </Field>
          </div>
        </div>

        {state.error && <Notice>{state.error}</Notice>}
        {state.ok && <Notice tone="ok">{state.message}</Notice>}
        <Button size="lg" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </form>

      <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-[var(--radius-card)] bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">Uso neste mês</h2>
            {usage.exhausted && <Badge tone="danger">Esgotado</Badge>}
          </div>
          <p className="mt-2 text-[28px] font-semibold tracking-tight">
            {usage.usedCredits.toLocaleString("pt-BR")}
            <span className="text-[15px] font-normal text-ink-2">
              {" "}
              de {usage.limitCredits.toLocaleString("pt-BR")} créditos
            </span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-fill">
            <div
              className={cx("h-full rounded-full", pct >= 90 ? "bg-danger" : "bg-accent")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[13px] text-ink-3">
            1 crédito = {tokensPerCredit.toLocaleString("pt-BR")} tokens. Ao acabar, a IA para e as conversas
            ficam para a equipe. O limite é definido pelo administrador da plataforma.
          </p>
        </section>
        <Simulator instructions={form.instructions} model={form.model} />
      </aside>
    </div>
  );
}

type SimMsg = { role: "user" | "assistant"; content: string; note?: string };

function Simulator({ instructions, model }: { instructions: string; model: string }) {
  const [msgs, setMsgs] = useState<SimMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const next: SimMsg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/agente/simular", {
        method: "POST",
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
          instructions,
          model,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erro no simulador.");
      const notes = [
        j.movedTo ? `moveu para ${j.movedTo}` : "",
        j.transferred ? `passou para humano: ${j.reason}` : "",
        j.ended ? "encerrou o atendimento" : "",
      ].filter(Boolean);
      setMsgs([
        ...next,
        { role: "assistant", content: j.text || "(sem texto)", note: notes.join(" · ") || undefined },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col rounded-[var(--radius-card)] bg-surface p-5" aria-label="Simulador">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <Bot size={18} /> Simulador
        </h2>
        {msgs.length > 0 && (
          <button type="button" onClick={() => setMsgs([])} className="text-[13px] font-medium text-accent">
            Recomeçar
          </button>
        )}
      </div>
      <p className="mb-3 text-[13px] text-ink-3">
        Teste as instruções do formulário (mesmo sem salvar). Gasta créditos e não manda nada no WhatsApp.
      </p>
      <div
        className="mb-3 max-h-[420px] min-h-40 space-y-2 overflow-y-auto rounded-xl bg-bg p-3"
        data-testid="sim-messages"
      >
        {msgs.length === 0 && (
          <p className="py-10 text-center text-[13px] text-ink-3">Escreva como se fosse um cliente.</p>
        )}
        {msgs.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cx(
                "max-w-[85%] whitespace-pre-wrap rounded-[16px] px-3 py-2 text-[14px]",
                m.role === "user" ? "bg-accent text-white" : "bg-fill",
              )}
            >
              {m.content}
              {m.note && <p className="mt-1 text-[12px] font-medium text-warn">{m.note}</p>}
            </div>
          </div>
        ))}
        {busy && <p className="text-[13px] text-ink-3">Pensando…</p>}
      </div>
      {error && (
        <div className="mb-2">
          <Notice>{error}</Notice>
        </div>
      )}
      <form onSubmit={send} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mensagem do cliente"
          aria-label="Mensagem de teste"
          className="h-10"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Enviar teste"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-30"
        >
          <SendHorizontal size={17} />
        </button>
      </form>
    </section>
  );
}
