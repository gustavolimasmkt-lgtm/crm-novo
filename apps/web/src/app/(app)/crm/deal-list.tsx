"use client";

import { ArrowDown, ArrowUp, Car, Download, SlidersHorizontal, ThumbsDown, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DISQUALIFY_REASONS } from "@/components/qualify";
import { Avatar, Button, cx, Input, Notice, Select } from "@/components/ui";

type Row = {
  id: string;
  number: number;
  title: string;
  interest: string | null;
  valueCents: number | null;
  stageId: string;
  stageName: string;
  stageColor: string;
  contactName: string | null;
  contactPhone: string | null;
  assignedUserName: string | null;
  sourceName: string | null;
  qualification: "qualified" | "disqualified" | null;
  tagNames: string[];
  createdAt: string;
  lastActivityAt: string;
  idleDays: number;
};
type ListData = { total: number; page: number; pageSize: number; showValues: boolean; rows: Row[] };
type Opt = { id: string; name: string };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const phone = (p: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").replace(/^55/, "");
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : (p ?? "");
};

type Filters = {
  etapa: string;
  status: string;
  fonte: string;
  qualificacao: string;
  anuncio: boolean;
  de: string;
  ate: string;
  parada: string;
  ordem: string;
  dir: "asc" | "desc";
};
const EMPTY: Filters = {
  etapa: "",
  status: "",
  fonte: "",
  qualificacao: "",
  anuncio: false,
  de: "",
  ate: "",
  parada: "",
  ordem: "created",
  dir: "desc",
};

export function DealList({
  pipelineId,
  q,
  owner,
  tagId,
  stages,
  sources,
  tags,
  people,
  canReassign,
  canDelete,
  canExport,
  refreshKey,
  onOpen,
  onChanged,
}: {
  pipelineId: string;
  q: string;
  owner: string;
  tagId: string;
  stages: Opt[];
  sources: Opt[];
  tags: Opt[];
  people: Opt[];
  canReassign: boolean;
  canDelete: boolean;
  canExport: boolean;
  refreshKey: number;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ funil: pipelineId });
    if (q.trim()) p.set("q", q.trim());
    if (owner) p.set("responsavel", owner);
    if (tagId) p.set("etiqueta", tagId);
    for (const k of [
      "etapa",
      "status",
      "fonte",
      "qualificacao",
      "de",
      "ate",
      "parada",
      "ordem",
      "dir",
    ] as const)
      if (f[k]) p.set(k, String(f[k]));
    if (f.anuncio) p.set("anuncio", "1");
    return p.toString();
  }, [pipelineId, q, owner, tagId, f]);

  // Filtro mudou: volta para a página 1 e limpa a seleção.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reage só à troca do filtro
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [query]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/crm/lista?${query}&pagina=${page}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erro ao carregar.");
      setData(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query, page]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey força recarregar em tempo real
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q, refreshKey]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pageAll = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const count = allMatching ? (data?.total ?? 0) : selected.size;
  const activeFilters = Object.entries(f).filter(
    ([k, v]) => v && !(k === "ordem" && v === "created") && !(k === "dir" && v === "desc"),
  ).length;

  function toggle(id: string) {
    setAllMatching(false);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function togglePage() {
    setAllMatching(false);
    setSelected((s) => {
      const n = new Set(s);
      for (const r of rows) {
        if (pageAll) n.delete(r.id);
        else n.add(r.id);
      }
      return n;
    });
  }
  function sortBy(k: string) {
    setF((x) => ({ ...x, ordem: k, dir: x.ordem === k && x.dir === "desc" ? "asc" : "desc" }));
  }

  async function apply(action: Record<string, unknown>, label: string) {
    setNotice(null);
    setError(null);
    try {
      const r = await fetch("/api/crm/lista/acoes", {
        method: "POST",
        body: JSON.stringify(allMatching ? { query, action } : { ids: [...selected], action }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falhou.");
      setNotice(
        `${label}: ${j.done} de ${j.total}${j.failed ? ` (${j.failed} não deu: ${j.error ?? "sem permissão"})` : ""}.`,
      );
      setSelected(new Set());
      setAllMatching(false);
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const SortHead = ({ k, children, right }: { k: string; children: string; right?: boolean }) => (
    <th className={cx("px-2 py-2 font-medium", right && "text-right")}>
      <button
        type="button"
        onClick={() => sortBy(k)}
        className={cx("inline-flex items-center gap-1 uppercase tracking-wide", f.ordem === k && "text-ink")}
      >
        {children}
        {f.ordem === k && (f.dir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-3" data-testid="lista-crm">
      <div className="flex items-center gap-2 sm:hidden">
        <Button size="sm" variant="secondary" onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal size={14} /> Filtros{activeFilters ? ` (${activeFilters})` : ""}
        </Button>
      </div>
      <div className={cx("flex-wrap gap-2 text-[14px]", showFilters ? "flex" : "hidden sm:flex")}>
        <Select
          aria-label="Etapa"
          value={f.etapa}
          onChange={(e) => set("etapa", e.target.value)}
          className="h-9 w-full sm:w-44"
        >
          <option value="">Todas as etapas</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Situação"
          value={f.status}
          onChange={(e) => set("status", e.target.value)}
          className="h-9 w-full sm:w-48"
        >
          <option value="">Abertas e fechadas</option>
          <option value="open">Só abertas</option>
          <option value="won">Ganhas</option>
          <option value="lost">Perdidas</option>
        </Select>
        <Select
          aria-label="Qualificação"
          value={f.qualificacao}
          onChange={(e) => set("qualificacao", e.target.value)}
          className="h-9 w-full sm:w-52"
        >
          <option value="">Qualquer qualificação</option>
          <option value="qualified">Qualificados</option>
          <option value="disqualified">Desqualificados</option>
          <option value="none">Sem marcação</option>
        </Select>
        <Select
          aria-label="Fonte"
          value={f.fonte}
          onChange={(e) => set("fonte", e.target.value)}
          className="h-9 w-full sm:w-44"
        >
          <option value="">Todas as fontes</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Parada há"
          value={f.parada}
          onChange={(e) => set("parada", e.target.value)}
          className="h-9 w-full sm:w-44"
        >
          <option value="">Qualquer atividade</option>
          {[1, 3, 7, 15, 30, 60].map((d) => (
            <option key={d} value={d}>
              Parada há {d}+ dia{d > 1 ? "s" : ""}
            </option>
          ))}
        </Select>
        <span className="flex items-center gap-1.5 text-ink-2">
          Criada de
          <Input
            type="date"
            aria-label="Criada de"
            value={f.de}
            onChange={(e) => set("de", e.target.value)}
            className="h-9 w-[9.5rem]"
          />
        </span>
        <span className="flex items-center gap-1.5 text-ink-2">
          até
          <Input
            type="date"
            aria-label="Criada até"
            value={f.ate}
            onChange={(e) => set("ate", e.target.value)}
            className="h-9 w-[9.5rem]"
          />
        </span>
        <label className="flex items-center gap-2 text-ink-2">
          <input
            type="checkbox"
            checked={f.anuncio}
            onChange={(e) => set("anuncio", e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Só de anúncio
        </label>
        {activeFilters > 0 && (
          <Button size="sm" variant="plain" onClick={() => setF(EMPTY)}>
            Limpar filtros
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[13px] text-ink-3" data-testid="lista-total">
            {data ? `${data.total} ${data.total === 1 ? "negociação" : "negociações"}` : "…"}
          </span>
          {canExport && (
            <a
              href={`/api/crm/lista/exportar?${query}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] font-medium hover:bg-fill-strong"
            >
              <Download size={14} /> Exportar
            </a>
          )}
        </div>
      </div>

      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {count > 0 && (
        <BulkBar
          count={count}
          canSelectAll={pageAll && !allMatching && (data?.total ?? 0) > rows.length}
          total={data?.total ?? 0}
          onSelectAll={() => setAllMatching(true)}
          onClear={() => {
            setSelected(new Set());
            setAllMatching(false);
          }}
          stages={stages}
          people={people}
          tags={tags}
          canReassign={canReassign}
          canDelete={canDelete}
          apply={apply}
        />
      )}

      <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface">
        <table className="w-full min-w-[980px] text-[14px]">
          <thead>
            <tr className="border-b border-separator text-left text-[12px] uppercase tracking-wide text-ink-3">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Selecionar a página"
                  checked={pageAll}
                  onChange={togglePage}
                  className="size-4 accent-[var(--accent)]"
                />
              </th>
              <SortHead k="number">#</SortHead>
              <SortHead k="title">Negociação</SortHead>
              <th className="px-2 py-2 font-medium">Etapa</th>
              <th className="px-2 py-2 font-medium">Responsável</th>
              {data?.showValues && (
                <SortHead k="value" right>
                  Valor
                </SortHead>
              )}
              <th className="px-2 py-2 font-medium">Fonte</th>
              <SortHead k="created">Criada</SortHead>
              <SortHead k="activity">Parada há</SortHead>
            </tr>
          </thead>
          <tbody className="divide-y divide-separator">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={cx("cursor-pointer hover:bg-fill/50", selected.has(r.id) && "bg-accent-soft/50")}
                onClick={() => onOpen(r.id)}
                data-testid="lista-linha"
              >
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()} onKeyDown={() => {}}>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar negociação ${r.number}`}
                    checked={allMatching || selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="size-4 accent-[var(--accent)]"
                  />
                </td>
                <td className="px-2 py-2.5 text-ink-3 tabular-nums">{r.number}</td>
                <td className="max-w-[280px] px-2 py-2.5">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <span className="truncate">{r.title}</span>
                    {r.qualification === "qualified" && (
                      <ThumbsUp size={13} className="shrink-0 text-ok" aria-label="Qualificado" />
                    )}
                    {r.qualification === "disqualified" && (
                      <ThumbsDown size={13} className="shrink-0 text-danger" aria-label="Desqualificado" />
                    )}
                  </p>
                  <p className="truncate text-[12px] text-ink-3">
                    {r.contactName && r.contactName !== r.title ? `${r.contactName} · ` : ""}
                    {phone(r.contactPhone)}
                  </p>
                  {r.interest && (
                    <p className="flex items-center gap-1 truncate text-[12px] font-medium text-accent">
                      <Car size={12} className="shrink-0" /> {r.interest}
                    </p>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="size-2 rounded-full" style={{ background: r.stageColor }} />
                    {r.stageName}
                  </span>
                  {r.tagNames.length > 0 && (
                    <p className="truncate text-[11px] text-ink-3">{r.tagNames.join(", ")}</p>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  {r.assignedUserName ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Avatar name={r.assignedUserName} size={20} /> {r.assignedUserName.split(" ")[0]}
                    </span>
                  ) : (
                    <span className="text-ink-3">Sem responsável</span>
                  )}
                </td>
                {data?.showValues && (
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {r.valueCents ? brl.format(r.valueCents / 100) : "–"}
                  </td>
                )}
                <td className="px-2 py-2.5 text-ink-2">{r.sourceName ?? "–"}</td>
                <td className="px-2 py-2.5 tabular-nums text-ink-2">{date(r.createdAt)}</td>
                <td
                  className={cx(
                    "px-2 py-2.5 tabular-nums",
                    r.idleDays >= 7
                      ? "font-semibold text-danger"
                      : r.idleDays >= 3
                        ? "text-warn"
                        : "text-ink-2",
                  )}
                  title={`Última atividade: ${new Date(r.lastActivityAt).toLocaleString("pt-BR")}`}
                >
                  {r.idleDays === 0 ? "hoje" : `${r.idleDays} dia${r.idleDays > 1 ? "s" : ""}`}
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-ink-3">
                  Nenhuma negociação com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-ink-3">
        "Parada há" conta desde a última mensagem do cliente ou mudança de etapa.
      </p>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-[14px]">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-ink-2" data-testid="lista-pagina">
            Página {page} de {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

function BulkBar({
  count,
  canSelectAll,
  total,
  onSelectAll,
  onClear,
  stages,
  people,
  tags,
  canReassign,
  canDelete,
  apply,
}: {
  count: number;
  canSelectAll: boolean;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  stages: Opt[];
  people: Opt[];
  tags: Opt[];
  canReassign: boolean;
  canDelete: boolean;
  apply: (action: Record<string, unknown>, label: string) => Promise<void>;
}) {
  const [kind, setKind] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (kind === "move") await apply({ type: "move", stageId: value }, "Movidas");
      if (kind === "assign")
        await apply({ type: "assign", userId: value === "none" ? null : value }, "Atribuídas");
      if (kind === "tag") await apply({ type: "tag", name: value }, "Etiqueta aplicada");
      if (kind === "qualified") await apply({ type: "qualify", value: "qualified" }, "Qualificadas");
      if (kind === "disqualified")
        await apply({ type: "qualify", value: "disqualified", reason: value || null }, "Desqualificadas");
      if (kind === "delete") await apply({ type: "delete" }, "Excluídas");
      setKind("");
      setValue("");
      setConfirmDel(false);
    } finally {
      setBusy(false);
    }
  }
  const needsValue = kind === "move" || kind === "assign" || kind === "tag";
  const ready = kind && (!needsValue || value) && (kind !== "delete" || confirmDel);

  return (
    <div
      className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-ink px-4 py-2.5 text-[14px] text-bg shadow-float"
      data-testid="acoes-massa"
    >
      <span className="font-semibold">
        {count} selecionada{count > 1 ? "s" : ""}
      </span>
      {canSelectAll && (
        <button type="button" className="underline" onClick={onSelectAll}>
          Selecionar todas as {total} do filtro
        </button>
      )}
      <button type="button" className="text-bg/70 underline" onClick={onClear}>
        Limpar
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-2 text-ink">
        <Select
          aria-label="Ação em massa"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setValue("");
            setConfirmDel(false);
          }}
          className="h-8 w-48 text-[13px]"
        >
          <option value="">Escolha a ação…</option>
          <option value="move">Mover para etapa</option>
          {canReassign && <option value="assign">Trocar responsável</option>}
          <option value="tag">Adicionar etiqueta</option>
          <option value="qualified">Marcar qualificado</option>
          <option value="disqualified">Marcar desqualificado</option>
          {canDelete && <option value="delete">Excluir</option>}
        </Select>
        {kind === "move" && (
          <Select
            aria-label="Etapa de destino"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-44 text-[13px]"
          >
            <option value="">Etapa…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        {kind === "assign" && (
          <Select
            aria-label="Novo responsável"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-44 text-[13px]"
          >
            <option value="">Responsável…</option>
            <option value="none">Sem responsável</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        {kind === "tag" && (
          <>
            <Input
              aria-label="Etiqueta para aplicar"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              list="bulk-tags"
              placeholder="Etiqueta"
              className="h-8 w-40 text-[13px]"
            />
            <datalist id="bulk-tags">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </>
        )}
        {kind === "disqualified" && (
          <Select
            aria-label="Motivo"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-48 text-[13px]"
          >
            <option value="">Motivo (opcional)</option>
            {DISQUALIFY_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}
        {kind === "delete" && (
          <label className="flex items-center gap-1.5 text-bg">
            <input
              type="checkbox"
              checked={confirmDel}
              onChange={(e) => setConfirmDel(e.target.checked)}
              className="size-4"
            />
            Excluir de vez {count}
          </label>
        )}
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={run}
          variant={kind === "delete" ? "danger" : "primary"}
        >
          {busy ? "Aplicando…" : "Aplicar"}
        </Button>
      </div>
    </div>
  );
}
