"use client";

import { Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, cx, Input, Notice } from "@/components/ui";

type Opt = { id: string; name: string };
type TagOpt = Opt & { kind: "organize" | "dispatch" };

/** Disparar o fluxo para um público: etiqueta, etapa e sem conversa há X dias. */
export function DispatchPanel({
  flowId,
  flowName,
  tags,
  stages,
  dailyLimit,
  onClose,
}: {
  flowId: string;
  flowName: string;
  tags: TagOpt[];
  stages: Opt[];
  dailyLimit: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [days, setDays] = useState("");
  const lists = tags.filter((t) => t.kind === "dispatch");
  const labels = tags.filter((t) => t.kind !== "dispatch");
  const [more, setMore] = useState(lists.length === 0);
  const [aud, setAud] = useState<{ count: number; capped: boolean; sample: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filter = { tagIds, stageIds, lastContactDays: days ? Number(days) : null };
  const key = JSON.stringify(filter);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recalcula quando o filtro muda
  useEffect(() => {
    let off = false;
    setAud(null);
    const t = setTimeout(async () => {
      const r = await fetch("/api/campanhas/publico", { method: "POST", body: key });
      const j = await r.json().catch(() => ({}));
      if (!off) {
        if (r.ok) setAud(j);
        else setError(j.error ?? "Não consegui contar o público.");
      }
    }, 250);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [key]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const noFilter = !tagIds.length && !stageIds.length && !days;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/fluxos/${flowId}/disparar`, { method: "POST", body: key });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Não deu certo.");
      setDone(
        `${j.queued} cliente(s) na fila do disparo${j.skipped ? `; ${j.skipped} já estavam nesse fluxo e ficaram de fora` : ""}. Os envios saem um cliente por vez, no horário de envio, e aparecem em Agendadas.`,
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) =>
    cx(
      "flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[13px]",
      on ? "bg-accent text-white" : "bg-fill",
    );

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-fill/60 p-3" data-testid="disparo">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold">Disparar "{flowName}" para</p>
        <button type="button" aria-label="Fechar disparo" onClick={onClose} className="text-ink-2">
          <X size={18} />
        </button>
      </div>
      {done ? (
        <Notice tone="ok">{done}</Notice>
      ) : (
        <>
          {lists.length > 0 ? (
            <div>
              <p className="mb-1 text-[13px] font-medium">Lista de disparo</p>
              <div className="flex flex-wrap gap-2">
                {lists.map((t) => (
                  <label key={t.id} className={chip(tagIds.includes(t.id))}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={tagIds.includes(t.id)}
                      onChange={() => toggle(tagIds, setTagIds, t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-ink-2">
              Dica: crie listas de disparo em CRM, Configurar (ou marque uma etiqueta como lista) para separar
              o público do disparo das etiquetas de organização.
            </p>
          )}
          {!more && (
            <button
              type="button"
              className="text-[13px] font-medium text-accent"
              onClick={() => setMore(true)}
            >
              Mais filtros (etiqueta, etapa, dias sem conversa)
            </button>
          )}
          {more && labels.length > 0 && (
            <div>
              <p className="mb-1 text-[13px] font-medium">Com a etiqueta</p>
              <div className="flex flex-wrap gap-2">
                {labels.map((t) => (
                  <label key={t.id} className={chip(tagIds.includes(t.id))}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={tagIds.includes(t.id)}
                      onChange={() => toggle(tagIds, setTagIds, t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {more && stages.length > 0 && (
            <div>
              <p className="mb-1 text-[13px] font-medium">Com negociação em</p>
              <div className="flex flex-wrap gap-2">
                {stages.map((s) => (
                  <label key={s.id} className={chip(stageIds.includes(s.id))}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={stageIds.includes(s.id)}
                      onChange={() => toggle(stageIds, setStageIds, s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {more && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span>Sem conversa há pelo menos</span>
              <Input
                aria-label="Dias sem conversa"
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="h-9 w-20"
              />
              <span>dias (vazio: não filtra)</span>
            </div>
          )}
          <p className="text-[14px] font-semibold" data-testid="publico-disparo">
            {aud
              ? `${aud.count} cliente(s)${aud.capped ? " (limite atingido, filtre mais)" : ""}${
                  aud.count
                    ? ` · cerca de ${Math.max(1, Math.ceil(aud.count / Math.max(1, dailyLimit)))} dia(s) para enviar tudo`
                    : ""
                }`
              : "Contando…"}
          </p>
          {aud?.sample.length ? <p className="text-[12px] text-ink-3">Ex.: {aud.sample.join(", ")}</p> : null}
          {noFilter && (
            <Notice tone="accent">
              Sem filtro o disparo vai para todos os contatos. Escolha uma lista de disparo.
            </Notice>
          )}
          <p className="text-[12px] text-ink-3">
            Cada cliente recebe os passos seguidos; os clientes vão um por vez pela fila anti-bloqueio e só no
            horário de envio. Quem pediu SAIR, a equipe e quem já está nesse fluxo ficam de fora.
          </p>
          {error && <Notice>{error}</Notice>}
          <Button size="sm" disabled={busy || !aud?.count || aud.capped} onClick={send}>
            <Send size={14} /> {busy ? "Disparando…" : `Disparar para ${aud?.count ?? 0}`}
          </Button>
        </>
      )}
    </div>
  );
}
