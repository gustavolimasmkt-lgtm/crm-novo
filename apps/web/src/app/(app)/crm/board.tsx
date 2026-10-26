"use client";

import { ListTodo, MessageCircle, Plus, Search, Settings2, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, cx, Field, Input, Notice, Select } from "@/components/ui";
import { formatPhone } from "@/lib/format";

type Deal = {
  id: string;
  number: number;
  title: string;
  valueCents: number | null;
  stageId: string;
  contactId: string;
  contactPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  updatedAt: string;
  createdAt: string;
  tagIds: string[];
};
type Stage = {
  id: string;
  name: string;
  color: string;
  kind: "open" | "scheduled" | "won" | "lost";
  count: number;
  totalCents: number | null;
  deals: Deal[];
};
type BoardData = {
  pipelines: { id: string; name: string; isDefault: boolean }[];
  pipeline: { id: string; name: string };
  stages: Stage[];
  showValues: boolean;
};
type Person = { id: string; name: string };
type Tag = { id: string; name: string; color: string };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (c: number | null | undefined) => brl.format((c ?? 0) / 100);
const centsToInput = (c: number | null | undefined) =>
  ((c ?? 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Erro inesperado.");
  return j as T;
}

function daysSince(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "1 dia" : `${d} dias`;
}

export function Board({
  initial,
  initialOpen,
  people,
  sources,
  tags,
  me,
  canReassign,
  canDelete,
  canSettings,
}: {
  initial: BoardData;
  initialOpen: string | null;
  people: Person[];
  sources: { id: string; name: string }[];
  tags: Tag[];
  me: string;
  canReassign: boolean;
  canDelete: boolean;
  canSettings: boolean;
}) {
  const [board, setBoard] = useState(initial);
  const [pipelineId, setPipelineId] = useState(initial.pipeline.id);
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [tagId, setTagId] = useState("");
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ funil: pipelineId });
    if (q.trim()) p.set("q", q.trim());
    if (owner) p.set("responsavel", owner);
    if (tagId) p.set("etiqueta", tagId);
    try {
      setBoard(await api<BoardData>(`/api/crm/board?${p}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pipelineId, q, owner, tagId]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("funil", pipelineId);
    if (open) url.searchParams.set("n", open);
    else url.searchParams.delete("n");
    window.history.replaceState(null, "", url);
  }, [pipelineId, open]);

  useEffect(() => {
    const es = new EventSource("/api/eventos");
    let t: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = () => {
      if (t) clearTimeout(t);
      t = setTimeout(load, 400);
    };
    return () => {
      es.close();
      if (t) clearTimeout(t);
    };
  }, [load]);

  async function move(dealId: string, stageId: string) {
    const from = board.stages.find((s) => s.deals.some((d) => d.id === dealId));
    if (!from || from.id === stageId) return;
    // Otimista: move na tela e confirma no servidor.
    setBoard((b) => {
      const deal = from.deals.find((d) => d.id === dealId);
      if (!deal) return b;
      return {
        ...b,
        stages: b.stages.map((s) => {
          if (s.id === from.id)
            return {
              ...s,
              count: s.count - 1,
              totalCents: s.totalCents === null ? null : s.totalCents - (deal.valueCents ?? 0),
              deals: s.deals.filter((d) => d.id !== dealId),
            };
          if (s.id === stageId)
            return {
              ...s,
              count: s.count + 1,
              totalCents: s.totalCents === null ? null : s.totalCents + (deal.valueCents ?? 0),
              deals: [{ ...deal, stageId }, ...s.deals],
            };
          return s;
        }),
      };
    });
    try {
      await api(`/api/crm/negociacoes/${dealId}`, { action: "move", stageId });
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  }

  const tagById = Object.fromEntries(tags.map((t) => [t.id, t]));

  return (
    <div className="md:-mx-4 md:-mt-4">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="large-title mr-2">CRM</h1>
        <Select
          aria-label="Funil"
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="h-9 w-full text-[14px] sm:w-64"
        >
          {board.pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canSettings && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                <Upload size={15} /> Importar
              </Button>
              <Link
                href="/crm/configuracoes"
                className="inline-flex h-8 items-center gap-2 rounded-full bg-fill px-3 text-[13px] font-medium hover:bg-fill-strong"
              >
                <Settings2 size={15} /> Configurar
              </Link>
            </>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={15} /> Nova negociação
          </Button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-56 sm:flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar título, contato, telefone ou número"
            className="h-9 pl-9"
            aria-label="Buscar negociações"
          />
        </div>
        <Select
          aria-label="Responsável"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="h-9 w-full text-[14px] sm:w-56"
        >
          <option value="">Todos os responsáveis</option>
          <option value="none">Sem responsável</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {tags.length > 0 && (
          <Select
            aria-label="Etiqueta"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className="h-9 w-full text-[14px] sm:w-56"
          >
            <option value="">Todas as etiquetas</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {error && (
        <div className="mb-3">
          <Notice>{error}</Notice>
        </div>
      )}

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0" data-testid="board">
        {board.stages.map((s) => (
          <section
            key={s.id}
            aria-label={`Etapa ${s.name}`}
            data-testid="stage"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = dragging.current ?? e.dataTransfer.getData("text/plain");
              if (id) move(id, s.id);
            }}
            className={cx(
              "flex max-h-[calc(100dvh-15rem)] w-[280px] shrink-0 flex-col rounded-[var(--radius-card)] bg-fill/60 transition-colors md:max-h-[calc(100dvh-13rem)]",
              over === s.id && "bg-accent-soft",
            )}
          >
            <div className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{s.name}</h2>
              <span className="text-[13px] text-ink-3">{s.count}</span>
            </div>
            {board.showValues && <p className="px-3 pb-2 text-[12px] text-ink-2">{money(s.totalCents)}</p>}
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {s.deals.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  draggable
                  data-testid="deal-card"
                  onDragStart={(e) => {
                    dragging.current = d.id;
                    e.dataTransfer.setData("text/plain", d.id);
                  }}
                  onDragEnd={() => {
                    dragging.current = null;
                  }}
                  onClick={() => setOpen(d.id)}
                  className="block w-full rounded-xl bg-surface p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-[15px] font-medium leading-snug">{d.title}</p>
                    <span className="shrink-0 text-[11px] text-ink-3">#{d.number}</span>
                  </div>
                  {board.showValues && (
                    <p className="mt-1 text-[14px] font-semibold">{money(d.valueCents)}</p>
                  )}
                  {d.tagIds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.tagIds.map((t) =>
                        tagById[t] ? (
                          <span
                            key={t}
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                            style={{ background: tagById[t].color }}
                          >
                            {tagById[t].name}
                          </span>
                        ) : null,
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
                    {d.assignedUserName ? <Avatar name={d.assignedUserName} size={20} /> : null}
                    <span className="min-w-0 flex-1 truncate">{d.assignedUserName ?? "Sem responsável"}</span>
                    <span>{daysSince(d.updatedAt)}</span>
                  </div>
                </button>
              ))}
              {s.deals.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-ink-3">Vazio</p>}
            </div>
          </section>
        ))}
      </div>

      {open && (
        <DealPanel
          id={open}
          board={board}
          people={people}
          sources={sources}
          tags={tags}
          me={me}
          canReassign={canReassign}
          canDelete={canDelete}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
      {creating && (
        <NewDeal
          board={board}
          people={people}
          sources={sources}
          canReassign={canReassign}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            load();
            setOpen(id);
          }}
        />
      )}
      {importing && <ImportDeals onClose={() => setImporting(false)} onDone={load} />}
    </div>
  );
}

type DealDetail = {
  id: string;
  number: number;
  title: string;
  valueCents: number | null;
  stageId: string;
  pipelineId: string;
  assignedUserId: string | null;
  sourceId: string | null;
  description: string | null;
  extra: Record<string, string> | null;
  createdAt: string;
  contact: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  tags: Tag[];
  events: {
    id: string;
    type: string;
    data: Record<string, unknown> | null;
    createdAt: string;
    actorName: string | null;
  }[];
  conversationId: string | null;
  adId: string | null;
  adTitle: string | null;
  adUrl: string | null;
  adApp: string | null;
  aiSummary: {
    resumo: string;
    interesse: string | null;
    temperatura: "quente" | "morno" | "frio";
    nota: number;
    proximoPasso: string | null;
    objecoes: string | null;
  } | null;
};

function eventText(e: DealDetail["events"][number]) {
  const d = e.data ?? {};
  switch (e.type) {
    case "created":
      return d.auto ? `Lead criado automaticamente em ${d.stage}` : `Negociação criada em ${d.stage}`;
    case "imported":
      return `Importada (${d.stage})`;
    case "stage":
      return `Mudou de ${d.from ?? "?"} para ${d.to}`;
    case "assigned":
      return d.name ? `Responsável: ${d.name}` : d.userId ? "Responsável alterado" : "Ficou sem responsável";
    case "value":
      return `Valor: ${money(Number(d.from))} → ${money(Number(d.to))}`;
    case "title":
      return `Título: ${d.to}`;
    case "tags":
      return `Etiquetas: ${((d.tags as string[]) ?? []).join(", ") || "nenhuma"}`;
    case "note":
      return String(d.text ?? "");
    default:
      return e.type;
  }
}

function DealPanel({
  id,
  board,
  people,
  sources,
  tags,
  me,
  canReassign,
  canDelete,
  onClose,
  onChanged,
}: {
  id: string;
  board: BoardData;
  people: Person[];
  sources: { id: string; name: string }[];
  tags: Tag[];
  me: string;
  canReassign: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const reload = useCallback(async () => {
    try {
      setD(await api<DealDetail>(`/api/crm/negociacoes/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    reload();
  }, [reload]);

  async function act(body: Record<string, unknown>) {
    setError(null);
    setSaved(false);
    try {
      await api(`/api/crm/negociacoes/${id}`, body);
      await reload();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ok = await act({
      action: "update",
      title: String(fd.get("title") ?? ""),
      ...(board.showValues ? { value: String(fd.get("value") ?? "") } : {}),
      sourceId: String(fd.get("sourceId") ?? "") || null,
      description: String(fd.get("description") ?? ""),
    });
    if (ok) setSaved(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label="Negociação"
    >
      <button type="button" className="hidden flex-1 md:block" aria-label="Fechar" onClick={onClose} />
      <aside className="h-full w-full max-w-[460px] overflow-y-auto bg-bg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-float">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[13px] font-medium text-ink-3">
            {d ? `Negociação #${d.number}` : "Carregando…"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-fill p-1.5 text-ink-2"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        {error && (
          <div className="mb-3">
            <Notice>{error}</Notice>
          </div>
        )}
        {d && (
          <div className="space-y-5">
            {d.contact && (
              <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-3">
                <Avatar name={d.contact.name || d.contact.phone || "?"} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold">
                    {d.contact.name || formatPhone(d.contact.phone)}
                  </p>
                  <p className="truncate text-[13px] text-ink-2">{formatPhone(d.contact.phone)}</p>
                </div>
                {d.conversationId && (
                  <Link
                    href={`/conversas?c=${d.conversationId}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-medium text-white"
                  >
                    <MessageCircle size={14} /> Conversa
                  </Link>
                )}
              </div>
            )}
            <Link
              href={`/tarefas?negociacao=${d.id}`}
              className="flex items-center justify-between rounded-[var(--radius-card)] bg-surface px-4 py-3 text-[15px] hover:bg-fill/60"
            >
              <span className="flex items-center gap-2">
                <ListTodo size={16} className="text-ink-2" /> Tarefas desta negociação
              </span>
              <span aria-hidden className="text-ink-3">
                ›
              </span>
            </Link>
            {(d.adId || d.adTitle) && (
              <div
                className="rounded-[var(--radius-card)] bg-surface px-4 py-3 text-[14px]"
                data-testid="anuncio-negociacao"
              >
                <p className="text-[12px] font-medium uppercase tracking-wide text-ink-3">
                  Veio de anúncio
                  {d.adApp
                    ? ` · ${d.adApp === "instagram" ? "Instagram" : d.adApp === "facebook" ? "Facebook" : d.adApp}`
                    : ""}
                </p>
                <p className="font-medium">{d.adTitle ?? `Anúncio ${d.adId}`}</p>
                {d.adUrl && (
                  <a
                    href={d.adUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-accent underline"
                  >
                    Ver anúncio
                  </a>
                )}
              </div>
            )}
            {d.aiSummary && (
              <div
                className="space-y-1.5 rounded-[var(--radius-card)] bg-surface p-4 text-[14px]"
                data-testid="resumo-negociacao"
              >
                <p className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Resumo da IA</span>
                  <span
                    className={cx(
                      "rounded-full px-2 py-0.5 text-[12px] font-semibold",
                      d.aiSummary.temperatura === "quente"
                        ? "bg-danger-soft text-danger"
                        : d.aiSummary.temperatura === "morno"
                          ? "bg-warn-soft text-warn"
                          : "bg-fill text-ink-2",
                    )}
                  >
                    {d.aiSummary.temperatura} · {d.aiSummary.nota}/10
                  </span>
                </p>
                {d.aiSummary.interesse && <p className="text-ink-2">Interesse: {d.aiSummary.interesse}</p>}
                <p>{d.aiSummary.resumo}</p>
                {d.aiSummary.objecoes && <p className="text-ink-2">Objeções: {d.aiSummary.objecoes}</p>}
                {d.aiSummary.proximoPasso && (
                  <p className="text-ink-2">Próximo passo: {d.aiSummary.proximoPasso}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] bg-surface p-4">
              <Field label="Etapa">
                <Select
                  value={d.stageId}
                  onChange={(e) => act({ action: "move", stageId: e.target.value })}
                  aria-label="Etapa"
                >
                  {board.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  {!board.stages.some((s) => s.id === d.stageId) && (
                    <option value={d.stageId}>Outro funil</option>
                  )}
                </Select>
              </Field>
              <Field label="Responsável">
                {canReassign ? (
                  <Select
                    aria-label="Responsável da negociação"
                    value={d.assignedUserId ?? ""}
                    onChange={(e) => act({ action: "assign", userId: e.target.value || null })}
                  >
                    <option value="">Sem responsável</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                ) : d.assignedUserId === me ? (
                  <p className="text-[15px]">Você</p>
                ) : d.assignedUserId ? (
                  <p className="text-[15px]">{people.find((p) => p.id === d.assignedUserId)?.name}</p>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => act({ action: "assign", userId: me })}>
                    Assumir para mim
                  </Button>
                )}
              </Field>
            </div>

            <form
              onSubmit={save}
              className="space-y-3 rounded-[var(--radius-card)] bg-surface p-4"
              key={d.id + d.title}
            >
              <Field label="Título">
                <Input name="title" defaultValue={d.title} required maxLength={120} />
              </Field>
              {board.showValues && (
                <Field label="Valor (R$)">
                  <Input name="value" defaultValue={centsToInput(d.valueCents)} inputMode="decimal" />
                </Field>
              )}
              <Field label="Fonte">
                <Select name="sourceId" defaultValue={d.sourceId ?? ""}>
                  <option value="">Sem fonte</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Descrição">
                <textarea
                  name="description"
                  defaultValue={d.description ?? ""}
                  rows={3}
                  maxLength={4000}
                  className="w-full rounded-xl bg-fill px-3.5 py-2.5 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
                />
              </Field>
              {saved && <Notice tone="ok">Salvo.</Notice>}
              <Button className="w-full" variant="secondary">
                Salvar
              </Button>
            </form>

            <section className="rounded-[var(--radius-card)] bg-surface p-4">
              <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-ink-3">Etiquetas</h3>
              <div className="flex flex-wrap gap-1.5">
                {d.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-white"
                    style={{ background: t.color }}
                  >
                    {t.name}
                    <button
                      type="button"
                      aria-label={`Tirar etiqueta ${t.name}`}
                      onClick={() =>
                        act({ action: "tags", tags: d.tags.filter((x) => x.id !== t.id).map((x) => x.name) })
                      }
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {d.tags.length === 0 && <span className="text-[14px] text-ink-3">Nenhuma</span>}
              </div>
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!tagInput.trim()) return;
                  if (await act({ action: "tags", tags: [...d.tags.map((x) => x.name), tagInput.trim()] }))
                    setTagInput("");
                }}
              >
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  list="tag-options"
                  placeholder="Adicionar etiqueta"
                  className="h-9"
                  aria-label="Adicionar etiqueta"
                />
                <datalist id="tag-options">
                  {tags.map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
                <Button size="sm" variant="secondary">
                  Adicionar
                </Button>
              </form>
            </section>

            {d.extra && Object.keys(d.extra).length > 0 && (
              <section className="rounded-[var(--radius-card)] bg-surface p-4">
                <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-ink-3">
                  Campos importados
                </h3>
                <dl className="space-y-1.5 text-[14px]">
                  {Object.entries(d.extra).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-40 shrink-0 text-ink-2">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="rounded-[var(--radius-card)] bg-surface p-4">
              <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-ink-3">Histórico</h3>
              <form
                className="mb-3 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act({ action: "note", text: note })) setNote("");
                }}
              >
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Escrever uma anotação"
                  className="h-9"
                  aria-label="Anotação"
                />
                <Button size="sm" variant="secondary" disabled={!note.trim()}>
                  Anotar
                </Button>
              </form>
              <ol className="space-y-2.5">
                {d.events.map((e) => (
                  <li key={e.id} className="text-[14px]">
                    <p className={cx(e.type === "note" && "rounded-lg bg-warn-soft px-2.5 py-1.5")}>
                      {eventText(e)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-3">
                      {e.actorName ?? "Sistema"} ·{" "}
                      {new Date(e.createdAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            {canDelete && (
              <div className="pb-6">
                {confirmDel ? (
                  <div className="space-y-2 rounded-xl bg-danger-soft p-3">
                    <p className="text-[14px] text-danger">
                      Excluir a negociação #{d.number}? O contato e as conversas continuam.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          if (await act({ action: "delete" })) onClose();
                        }}
                      >
                        Excluir de vez
                      </Button>
                      <Button size="sm" variant="plain" onClick={() => setConfirmDel(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDel(true)}
                    className="inline-flex items-center gap-1.5 text-[14px] font-medium text-danger"
                  >
                    <Trash2 size={15} /> Excluir negociação
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function NewDeal({
  board,
  people,
  sources,
  canReassign,
  onClose,
  onCreated,
}: {
  board: BoardData;
  people: Person[];
  sources: { id: string; name: string }[];
  canReassign: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/crm/negociacoes", {
        phone: fd.get("phone"),
        contactName: fd.get("contactName"),
        title: fd.get("title"),
        value: fd.get("value"),
        stageId: fd.get("stageId"),
        sourceId: fd.get("sourceId"),
        ...(canReassign ? { assignedUserId: fd.get("assignedUserId") || null } : {}),
      });
      onCreated(r.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Nova negociação"
    >
      <form
        onSubmit={submit}
        className="max-h-[92dvh] w-full max-w-[460px] space-y-3 overflow-y-auto rounded-t-[22px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float md:rounded-[22px]"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[20px] font-semibold">Nova negociação</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-fill p-1.5 text-ink-2"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <Field label="Telefone do contato" hint="Se o contato já existe, ele é aproveitado.">
          <Input name="phone" required inputMode="tel" placeholder="(48) 99999-9999" autoFocus />
        </Field>
        <Field label="Nome do contato">
          <Input name="contactName" maxLength={80} />
        </Field>
        <Field label="Título (opcional)">
          <Input name="title" maxLength={120} placeholder="Ex.: Onix 2020" />
        </Field>
        {board.showValues && (
          <Field label="Valor (R$)">
            <Input name="value" inputMode="decimal" placeholder="0,00" />
          </Field>
        )}
        <Field label="Etapa">
          <Select name="stageId" defaultValue={board.stages[0]?.id}>
            {board.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fonte">
          <Select name="sourceId" defaultValue="">
            <option value="">Sem fonte</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        {canReassign && (
          <Field label="Responsável">
            <Select name="assignedUserId" defaultValue="">
              <option value="">Sem responsável</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && <Notice>{error}</Notice>}
        <Button size="lg" disabled={busy}>
          {busy ? "Criando…" : "Criar negociação"}
        </Button>
      </form>
    </div>
  );
}

type ImportResult = {
  total: number;
  created: number;
  skipped: number;
  contactsOnly: number;
  invalid: { line: number; reason: string }[];
  createdStages: string[];
  unknownOwners: string[];
};

function ImportDeals({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    try {
      setResult(await api<ImportResult>("/api/crm/importar", fd));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Importar negociações"
    >
      <div className="max-h-[92dvh] w-full max-w-[520px] space-y-4 overflow-y-auto rounded-t-[22px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float md:rounded-[22px]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold">Importar negociações</h2>
            <p className="mt-1 text-[14px] text-ink-2">
              Aceita o arquivo de negociações exportado do sistema antigo e o modelo de importação. Funis,
              etapas, fontes e etiquetas que não existirem são criados. Reimportar o mesmo arquivo do sistema
              antigo não duplica.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-fill p-1.5 text-ink-2"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        {result ? (
          <div className="space-y-3">
            <Notice tone="ok">
              {result.created} negociações criadas · {result.skipped} já existiam
              {result.contactsOnly ? ` · ${result.contactsOnly} só contato` : ""}
              {result.invalid.length ? ` · ${result.invalid.length} linhas com problema` : ""}
            </Notice>
            {result.createdStages.length > 0 && (
              <div>
                <p className="mb-1 text-[13px] font-medium text-ink-2">Criados no CRM:</p>
                <div className="flex flex-wrap gap-1">
                  {result.createdStages.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.unknownOwners.length > 0 && (
              <p className="text-[14px] text-ink-2">
                Responsáveis que não estão na equipe (ficaram sem responsável):{" "}
                {result.unknownOwners.join(", ")}. Convide essas pessoas e reatribua.
              </p>
            )}
            {result.invalid.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-xl bg-fill p-3 text-[13px] text-ink-2">
                {result.invalid.slice(0, 100).map((i) => (
                  <li key={i.line}>
                    Linha {i.line}: {i.reason}
                  </li>
                ))}
              </ul>
            )}
            <Button className="w-full" onClick={onClose}>
              Concluir
            </Button>
          </div>
        ) : (
          <>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-separator px-4 py-8 text-center hover:bg-fill">
              <Upload size={22} className="text-ink-3" />
              <span className="text-[15px] font-medium">{file ? file.name : "Escolher arquivo .csv"}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                data-testid="deals-file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {error && <Notice>{error}</Notice>}
            <Button size="lg" disabled={!file || busy} onClick={send}>
              {busy ? "Importando… pode levar um minuto" : "Importar"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
