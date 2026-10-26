"use client";

import { Megaphone, Plus, X } from "lucide-react";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createCampaignAction, setCampaignStatusAction } from "@/app/actions/productivity";
import { Badge, Button, cx, Field, Input, Notice, Select } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Campaign = {
  id: string;
  name: string;
  body: string;
  status: "running" | "paused" | "done" | "canceled";
  startAt: string;
  finishedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  connectionName: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  replied: number;
};

const STATUS: Record<Campaign["status"], { label: string; tone: "accent" | "warn" | "ok" | "neutral" }> = {
  running: { label: "Enviando", tone: "accent" },
  paused: { label: "Pausada", tone: "warn" },
  done: { label: "Concluída", tone: "ok" },
  canceled: { label: "Cancelada", tone: "neutral" },
};
const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function CampaignsClient({
  items,
  connections,
  stages,
  tags,
  dailyLimit,
  footer,
}: {
  items: Campaign[];
  connections: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  dailyLimit: number;
  footer: string;
}) {
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (id: string, status: "running" | "paused" | "canceled") =>
    start(async () => {
      setError(null);
      const r = (await setCampaignStatusAction(id, status)) as { error?: string };
      if (r?.error) setError(r.error);
    });

  return (
    <div className="space-y-4">
      <Button onClick={() => setCreating(true)} disabled={!connections.length}>
        <Plus size={16} /> Nova campanha
      </Button>
      {!connections.length && <Notice>Conecte um WhatsApp em Conexões antes de criar campanhas.</Notice>}
      {error && <Notice>{error}</Notice>}
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
          <Megaphone className="mx-auto text-ink-3" size={32} />
          <p className="mt-3 text-[17px] font-semibold">Nenhuma campanha</p>
          <p className="mt-1 text-[14px] text-ink-2">
            Avise clientes de feirão, carro novo no estoque ou condição especial. Quem responder cai no funil
            normalmente.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => {
            const done = c.sent + c.failed + c.skipped;
            const pct = c.total ? Math.round((done / c.total) * 100) : 0;
            const left = c.total - done;
            return (
              <li key={c.id} className="rounded-[var(--radius-card)] bg-surface p-4" data-testid="campanha">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold">{c.name}</p>
                    <p className="text-[13px] text-ink-2">
                      {c.connectionName ?? "sem conexão"} · {c.createdByName ?? ""} · início{" "}
                      {fmt.format(new Date(c.startAt))}
                    </p>
                  </div>
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[14px] text-ink-2">{c.body}</p>
                <div className="mt-3 h-2 rounded-full bg-fill">
                  <div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-[13px] tabular-nums text-ink-2">
                  {c.sent} enviadas de {c.total} · {c.replied} responderam
                  {c.skipped ? ` · ${c.skipped} puladas` : ""}
                  {c.failed ? ` · ${c.failed} falharam` : ""}
                  {c.status === "running" && left > 0 && ` · faltam ~${Math.ceil(left / dailyLimit)} dia(s)`}
                </p>
                {(c.status === "running" || c.status === "paused") && (
                  <div className="mt-3 flex gap-2">
                    {c.status === "running" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => act(c.id, "paused")}
                      >
                        Pausar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => act(c.id, "running")}
                      >
                        Retomar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="plain"
                      disabled={pending}
                      onClick={() =>
                        confirm("Cancelar a campanha? Quem ainda não recebeu não vai receber.") &&
                        act(c.id, "canceled")
                      }
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <NewCampaign
          connections={connections}
          stages={stages}
          tags={tags}
          dailyLimit={dailyLimit}
          footer={footer}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function NewCampaign({
  connections,
  stages,
  tags,
  dailyLimit,
  footer,
  onClose,
}: {
  connections: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  dailyLimit: number;
  footer: string;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(async (s, fd) => {
    const r = await createCampaignAction(s, fd);
    if (r.ok) onClose();
    return r;
  }, {});
  const [body, setBody] = useState("Oi {nome}! ");
  const [withFooter, setWithFooter] = useState(true);
  const [aud, setAud] = useState<{ count: number; capped: boolean; sample: string[] } | null>(null);
  const [audErr, setAudErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Conta o público sempre que um filtro muda.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick muda quando os filtros mudam
  useEffect(() => {
    const t = setTimeout(async () => {
      const fd = new FormData(formRef.current ?? undefined);
      try {
        const r = await fetch("/api/campanhas/publico", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            stageIds: fd.getAll("stageIds").map(String),
            tagIds: fd.getAll("tagIds").map(String),
            lastContactDays: fd.get("lastContactDays") ? Number(fd.get("lastContactDays")) : null,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Erro ao contar o público.");
        setAud(j);
        setAudErr(null);
      } catch (e) {
        setAudErr((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [tick]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (aud && !confirm(`Enviar para ${aud.count} contato(s)?`)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  const preview = body.replace(/\{nome\}/gi, "Maria").trim() + (withFooter ? `\n\n${footer}` : "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nova campanha"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-bg p-5 md:max-w-[620px] md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">Nova campanha</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-2 hover:bg-fill"
          >
            <X size={20} />
          </button>
        </div>
        <form ref={formRef} onSubmit={onSubmit} onChange={() => setTick((t) => t + 1)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome (só para você)">
              <Input name="name" required maxLength={80} placeholder="Feirão de sábado" />
            </Field>
            <Field label="Enviar pelo número">
              <Select name="connectionId" defaultValue={connections[0]?.id}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="Mensagem"
            hint="{nome} vira o primeiro nome do cliente. Evite links e textos iguais a spam."
          >
            <textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={5}
              maxLength={2000}
              className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
            />
          </Field>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              name="optOutFooter"
              checked={withFooter}
              onChange={(e) => setWithFooter(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Incluir "responda SAIR" no fim (recomendado: reduz denúncias)
          </label>
          <div className="rounded-xl bg-surface p-3">
            <p className="mb-1 text-[12px] font-medium text-ink-3">Prévia</p>
            <p className="whitespace-pre-wrap text-[14px]">{preview}</p>
          </div>

          <fieldset className="space-y-3 rounded-xl bg-surface p-3">
            <legend className="px-1 text-[14px] font-semibold">Público</legend>
            <p className="text-[12px] text-ink-2">
              Sem filtro: todos os contatos. Quem respondeu SAIR e a equipe ficam fora.
            </p>
            {stages.length > 0 && (
              <div>
                <p className="mb-1 text-[13px] font-medium">Com negociação em</p>
                <div className="flex flex-wrap gap-2">
                  {stages.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-[13px]"
                    >
                      <input type="checkbox" name="stageIds" value={s.id} className="size-3.5" />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {tags.length > 0 && (
              <div>
                <p className="mb-1 text-[13px] font-medium">Com a etiqueta</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-1.5 rounded-full bg-fill px-3 py-1 text-[13px]"
                    >
                      <input type="checkbox" name="tagIds" value={t.id} className="size-3.5" />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Field label="Sem conversa há pelo menos (dias)" hint="Vazio: não filtra">
              <Input name="lastContactDays" type="number" min={1} max={3650} className="w-32" />
            </Field>
            <p
              className={cx("text-[14px] font-semibold", aud?.count ? "text-accent" : "text-ink-2")}
              data-testid="publico"
            >
              {audErr
                ? audErr
                : aud
                  ? `${aud.count} contato(s)${aud.capped ? " (limite atingido, filtre mais)" : ""}${
                      aud.count ? ` · ~${Math.ceil(aud.count / dailyLimit)} dia(s) para enviar tudo` : ""
                    }`
                  : "Contando..."}
            </p>
            {aud && aud.sample.length > 0 && (
              <p className="text-[12px] text-ink-3">Ex.: {aud.sample.join(", ")}</p>
            )}
          </fieldset>

          <Field label="Começar em" hint="Vazio: começa agora (dentro do horário de envio)">
            <Input name="startAt" type="datetime-local" className="w-60" />
          </Field>
          {state.error && <Notice>{state.error}</Notice>}
          <Button type="submit" size="lg" disabled={pending || !aud?.count}>
            {pending ? "Criando..." : "Criar campanha"}
          </Button>
        </form>
      </div>
    </div>
  );
}
