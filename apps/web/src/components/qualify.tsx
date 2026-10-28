"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";

export type Qualification = "qualified" | "disqualified" | null;
export type QualifyMeta = {
  enabled: boolean;
  sendQualified: boolean;
  sendDisqualified: boolean;
  events: {
    kind: "qualified" | "disqualified";
    status: "pending" | "sent" | "failed";
    sendAfter: string;
    sentAt: string | null;
    error: string | null;
  }[];
};

export const DISQUALIFY_REASONS = [
  "Sem crédito aprovado",
  "Sem entrada",
  "Só pesquisando preço",
  "Fora da região",
  "Procura outro produto",
  "Não responde",
  "Número errado ou spam",
];

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function metaLine(value: Qualification, meta: QualifyMeta) {
  if (!value) return null;
  if (!meta.enabled) return { tone: "muted", text: "API de Conversões desligada: fica marcado só no CRM." };
  const on = value === "qualified" ? meta.sendQualified : meta.sendDisqualified;
  if (!on) return { tone: "muted", text: "Envio deste evento desligado em Integração Meta." };
  const ev = meta.events.find((e) => e.kind === value);
  if (!ev) return { tone: "muted", text: "Marcado antes de o envio estar ligado: não foi para a Meta." };
  if (ev.status === "sent") {
    if (ev.error) return { tone: "muted", text: ev.error };
    return { tone: "ok", text: `Enviado para a Meta${ev.sentAt ? ` às ${time(ev.sentAt)}` : ""}.` };
  }
  if (ev.status === "failed") return { tone: "danger", text: `Não foi para a Meta: ${ev.error ?? "erro"}` };
  if (new Date(ev.sendAfter).getTime() > Date.now())
    return { tone: "muted", text: `Vai para a Meta às ${time(ev.sendAfter)}. Até lá dá para desfazer.` };
  return {
    tone: ev.error ? "danger" : "muted",
    text: ev.error ? `Tentando de novo: ${ev.error}` : "Enviando para a Meta…",
  };
}

/** Botões Qualificado / Desqualificado de uma negociação. */
export function QualifyButtons({
  dealId,
  value,
  reason,
  meta,
  compact = false,
  onChanged,
}: {
  dealId: string;
  value: Qualification;
  reason: string | null;
  meta?: QualifyMeta;
  compact?: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: Qualification, why: string | null = null) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/crm/negociacoes/${dealId}`, {
        method: "POST",
        body: JSON.stringify({ action: "qualify", qualification: next, reason: why }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Erro.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const btn = (kind: "qualified" | "disqualified") => {
    const active = value === kind;
    const Icon = kind === "qualified" ? ThumbsUp : ThumbsDown;
    const label = kind === "qualified" ? "Qualificado" : "Desqualificado";
    return (
      <button
        type="button"
        disabled={busy}
        aria-pressed={active}
        title={active ? `Desmarcar ${label.toLowerCase()}` : `Marcar como ${label.toLowerCase()}`}
        onClick={() => save(active ? null : kind)}
        className={cx(
          "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:opacity-50",
          compact ? "h-7 px-2.5 text-[12px]" : "h-9 flex-1 px-3 text-[14px]",
          active
            ? kind === "qualified"
              ? "bg-ok text-white"
              : "bg-danger text-white"
            : kind === "qualified"
              ? "bg-ok-soft text-ok"
              : "bg-danger-soft text-danger",
        )}
      >
        <Icon size={compact ? 13 : 15} /> {label}
      </button>
    );
  };

  const line = meta ? metaLine(value, meta) : null;
  return (
    <div
      className={cx(compact ? "flex flex-wrap items-center gap-1.5" : "space-y-2")}
      data-testid="qualificacao"
    >
      <div className={cx("flex gap-1.5", !compact && "w-full")}>
        {btn("qualified")}
        {btn("disqualified")}
      </div>
      {value === "disqualified" && (
        <select
          aria-label="Motivo da desqualificação"
          value={reason ?? ""}
          disabled={busy}
          onChange={(e) => save("disqualified", e.target.value || null)}
          className={cx(
            "rounded-full bg-fill text-ink-2 outline-none",
            compact ? "h-7 max-w-[11rem] px-2 text-[12px]" : "h-9 w-full px-3 text-[14px]",
          )}
        >
          <option value="">Motivo (opcional)</option>
          {[...DISQUALIFY_REASONS, ...(reason && !DISQUALIFY_REASONS.includes(reason) ? [reason] : [])].map(
            (r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ),
          )}
        </select>
      )}
      {line && (
        <p
          className={cx(
            "text-[12px]",
            line.tone === "ok" ? "text-ok" : line.tone === "danger" ? "text-danger" : "text-ink-3",
          )}
          data-testid="qualificacao-meta"
        >
          {line.text}
        </p>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
