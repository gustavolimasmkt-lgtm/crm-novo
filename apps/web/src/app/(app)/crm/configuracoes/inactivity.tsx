"use client";

import { Clock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx, Input, Notice, Select } from "@/components/ui";

type Stage = { id: string; name: string; kind: string };
type Pipeline = { id: string; name: string; stages: Stage[] };
type Rule = {
  id: string;
  pipelineId: string;
  fromStageIds: string[];
  days: number;
  toStageId: string;
  active: boolean;
};

async function post<T>(body: unknown): Promise<T> {
  const r = await fetch("/api/crm/inatividade", { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Falhou.");
  return j as T;
}

export function InactivityRules({ pipelines, rules }: { pipelines: Pipeline[]; rules: Rule[] }) {
  const router = useRouter();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [from, setFrom] = useState<string[]>([]);
  const [days, setDays] = useState("3");
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pipe = pipelines.find((p) => p.id === pipelineId);
  const stageName = (id: string) =>
    pipelines.flatMap((p) => p.stages).find((s) => s.id === id)?.name ?? "etapa removida";
  const rule = { pipelineId, fromStageIds: from, days: Number(days), toStageId: to, active: true };
  const openStages = (pipe?.stages ?? []).filter((s) => s.kind === "open" || s.kind === "scheduled");

  async function check() {
    setError(null);
    try {
      setPreview((await post<{ count: number }>({ action: "preview", rule })).count);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "save", rule });
      setFrom([]);
      setTo("");
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(r: Rule) {
    try {
      await post({ action: "save", id: r.id, rule: { ...r, active: !r.active } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(id: string) {
    try {
      await post({ action: "delete", id });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="mt-8 space-y-4" data-testid="inatividade">
      <div>
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-ink-3">Mover por inatividade</h2>
        <p className="mt-1 text-[14px] text-ink-2">
          Move sozinho a negociação parada: sem mensagem do cliente e sem mudar de etapa há X dias. O
          movimento fica no histórico e dispara os fluxos da etapa de destino.
        </p>
      </div>

      {rules.length > 0 && (
        <ul className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[14px]">
              <Clock size={16} className={r.active ? "text-accent" : "text-ink-3"} />
              <span className={cx("min-w-0 flex-1", !r.active && "text-ink-3")}>
                {r.fromStageIds.length ? r.fromStageIds.map(stageName).join(", ") : "Qualquer etapa aberta"}
                {" → "}
                <b>{stageName(r.toStageId)}</b> depois de {r.days} dia{r.days > 1 ? "s" : ""} parada
                {pipelines.length > 1 && (
                  <span className="text-ink-3"> ({pipelines.find((p) => p.id === r.pipelineId)?.name})</span>
                )}
              </span>
              <Button size="sm" variant="secondary" onClick={() => toggle(r)}>
                {r.active ? "Pausar" : "Ligar"}
              </Button>
              <button
                type="button"
                aria-label="Excluir regra"
                onClick={() => remove(r.id)}
                className="rounded-full p-1.5 text-danger hover:bg-danger-soft"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-[var(--radius-card)] bg-surface p-4 text-[14px]">
        <p className="font-medium">Nova regra</p>
        {pipelines.length > 1 && (
          <Select
            aria-label="Funil da regra"
            value={pipelineId}
            onChange={(e) => {
              setPipelineId(e.target.value);
              setFrom([]);
              setTo("");
              setPreview(null);
            }}
            className="h-9 sm:w-64"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <div>
          <p className="mb-1.5 text-[13px] text-ink-2">
            Quando estiver em (nenhuma marcada = qualquer etapa aberta):
          </p>
          <div className="flex flex-wrap gap-2">
            {openStages
              .filter((s) => s.id !== to)
              .map((s) => (
                <label
                  key={s.id}
                  className={cx(
                    "flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1",
                    from.includes(s.id) ? "bg-accent text-white" : "bg-fill",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={from.includes(s.id)}
                    onChange={() => {
                      setPreview(null);
                      setFrom((f) => (f.includes(s.id) ? f.filter((x) => x !== s.id) : [...f, s.id]));
                    }}
                  />
                  {s.name}
                </label>
              ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>parada há</span>
          <Input
            aria-label="Dias parada"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setPreview(null);
            }}
            className="h-9 w-20"
          />
          <span>dias, mover para</span>
          <Select
            aria-label="Mover para"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setFrom((f) => f.filter((x) => x !== e.target.value));
              setPreview(null);
            }}
            className="h-9 w-48"
          >
            <option value="">Etapa…</option>
            {(pipe?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        {error && <Notice>{error}</Notice>}
        {preview !== null && (
          <Notice tone={preview > 20 ? "accent" : "ok"}>
            {preview === 0
              ? "Hoje nenhuma negociação se encaixa. A regra passa a valer para as que ficarem paradas."
              : `Assim que salvar, ${preview} ${preview > 1 ? "negociações serão movidas" : "negociação será movida"} (até 50 a cada 5 min).${preview > 20 ? " Se a etapa de destino tiver fluxo ligado, todas recebem a mensagem." : ""}`}
          </Notice>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={!to || !days} onClick={check}>
            Ver quantas mudam
          </Button>
          <Button size="sm" disabled={!to || !days || preview === null || busy} onClick={save}>
            Salvar regra
          </Button>
        </div>
      </div>
    </section>
  );
}
