"use client";

import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock,
  FileText,
  MapPin,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Search,
  SendHorizontal,
  StickyNote,
  User,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  createContext,
  type FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Avatar, Badge, Button, cx, Field, Input, Notice, Select } from "@/components/ui";
import { contactLabel, dayKey, dayLabel, formatPhone, listTime, messageTime } from "@/lib/format";

type Filter = "open" | "unread" | "mine" | "closed" | "all";
type Conv = {
  id: string;
  status: "open" | "closed";
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean | null;
  contactId: string;
  contactName: string | null;
  contactPushName: string | null;
  contactPhone: string | null;
  connectionId: string;
  connectionName: string;
  connectionPhone: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  aiPaused: boolean;
  aiPausedReason: string | null;
  aiSummary: LeadSummary | null;
  aiSummaryAt: string | null;
};
type Msg = {
  id: string;
  direction: "in" | "out";
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "other";
  body: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  sentAt: string;
  sentByName: string | null;
  sentByAi: boolean;
  internal: boolean;
  transcript: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  automation: string | null;
  quoted: { body: string | null; type: Msg["type"]; fromMe: boolean } | null;
  canEdit: boolean;
  canDelete: boolean;
};
type Scheduled = { id: string; body: string; sendAt: string; createdByName: string | null };
type LeadSummary = {
  resumo: string;
  interesse: string | null;
  temperatura: "quente" | "morno" | "frio";
  nota: number;
  proximoPasso: string | null;
  objecoes: string | null;
};
type QuickReply = { id: string; shortcut: string; body: string };

/** Recursos extras da caixa de entrada (respostas rápidas, transcrição). */
const Extras = createContext<{ quickReplies: QuickReply[]; sttEnabled: boolean; aiEnabled: boolean }>({
  quickReplies: [],
  sttEnabled: false,
  aiEnabled: false,
});

const AUTOMATION_LABEL: Record<string, string> = {
  followup: "Follow-up",
  reminder: "Lembrete",
  campaign: "Campanha",
};

function snippet(m: { body: string | null; type: Msg["type"] }) {
  if (m.body) return m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body;
  const labels: Record<string, string> = {
    image: "Foto",
    audio: "Áudio",
    video: "Vídeo",
    document: "Documento",
    sticker: "Figurinha",
    location: "Localização",
    contact: "Contato",
  };
  return labels[m.type] ?? "Mensagem";
}

function fillReply(body: string, contactName: string) {
  const first = contactName.trim().split(/\s+/)[0] ?? "";
  const name = /^[\p{L}'-]{2,}$/u.test(first) ? first : "";
  return body
    .replace(/\{nome\}/gi, name)
    .replace(/ +([!,.?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}
type Connection = { id: string; name: string; phone: string | null; status: string };
type DealChip = { id: string; number: number; stageName: string; stageColor: string; pipelineName: string };
type ThreadData = { conversation: Conv; messages: Msg[]; deal: DealChip | null; scheduled: Scheduled[] };
type Person = { id: string; name: string };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Abertas" },
  { id: "unread", label: "Não lidas" },
  { id: "mine", label: "Minhas" },
  { id: "closed", label: "Fechadas" },
  { id: "all", label: "Todas" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Erro inesperado.");
  return j as T;
}

export function Inbox({
  initial,
  initialSelected,
  connections,
  people,
  me,
  canViewAll,
  canManageConnections,
  agentActive,
  quickReplies = [],
  sttEnabled = false,
  aiEnabled = false,
}: {
  initial: Conv[];
  initialSelected: string | null;
  connections: Connection[];
  people: Person[];
  me: { id: string; name: string };
  canViewAll: boolean;
  canManageConnections: boolean;
  agentActive: boolean;
  quickReplies?: QuickReply[];
  sttEnabled?: boolean;
  aiEnabled?: boolean;
}) {
  const extras = useMemo(
    () => ({ quickReplies, sttEnabled, aiEnabled }),
    [quickReplies, sttEnabled, aiEnabled],
  );
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [list, setList] = useState<Conv[]>(initial);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [live, setLive] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const loadList = useCallback(async () => {
    const p = new URLSearchParams({ filter });
    if (q.trim()) p.set("q", q.trim());
    try {
      setList(await api<Conv[]>(`/api/conversas?${p}`));
    } catch {
      // mantém a lista anterior
    }
  }, [filter, q]);

  const loadThread = useCallback(async (id: string) => {
    try {
      const t = await api<ThreadData>(`/api/conversas/${id}`);
      if (selectedRef.current !== id) return;
      setThread(t);
      setThreadError(null);
      if (t.conversation.unreadCount > 0) {
        await api(`/api/conversas/${id}/acoes`, { method: "POST", body: JSON.stringify({ action: "read" }) });
      }
    } catch (e) {
      if (selectedRef.current === id) setThreadError((e as Error).message);
    }
  }, []);

  // Lista: recarrega ao trocar filtro/busca.
  useEffect(() => {
    const t = setTimeout(loadList, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, q]);

  // Conversa selecionada: carrega e mantém a URL (?c=) para poder recarregar a página.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("c", selected);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
    setThread(null);
    setThreadError(null);
    if (selected) loadThread(selected);
  }, [selected, loadThread]);

  // Tempo real.
  useEffect(() => {
    const es = new EventSource("/api/eventos");
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as { t: string; c: string | null };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadList();
        if (selectedRef.current && (!ev.c || ev.c === selectedRef.current)) loadThread(selectedRef.current);
      }, 150);
    };
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [loadList, loadThread]);

  const noConnection = connections.length === 0;

  return (
    <Extras.Provider value={extras}>
      <div className="md:-mx-4 md:-mt-4">
        <div className="flex overflow-hidden md:h-[calc(100dvh-6rem)] md:rounded-[var(--radius-card)] md:bg-surface">
          {/* Lista */}
          <section
            className={cx("flex w-full flex-col md:w-[360px] md:shrink-0 md:border-r md:border-separator")}
            aria-label="Lista de conversas"
          >
            <div className="space-y-3 pb-3 md:p-4">
              <div className="flex items-center justify-between">
                <h1 className="large-title md:text-[28px]">Conversas</h1>
                <div className="flex items-center gap-2">
                  <span
                    className={cx("h-2 w-2 rounded-full", live ? "bg-ok" : "bg-ink-3")}
                    title={live ? "Atualizando em tempo real" : "Reconectando…"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(true)}
                    disabled={noConnection}
                    className="rounded-full p-2 text-accent hover:bg-accent-soft disabled:opacity-40"
                    aria-label="Nova conversa"
                    title="Nova conversa"
                  >
                    <MessageSquarePlus size={22} />
                  </button>
                </div>
              </div>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar nome ou número"
                  className="h-9 pl-9"
                  aria-label="Buscar conversas"
                />
              </div>
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cx(
                      "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium",
                      filter === f.id ? "bg-ink text-bg" : "bg-fill text-ink-2 hover:bg-fill-strong",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {noConnection && (
              <div className="px-1 pb-3 md:px-4">
                <Notice tone="accent">
                  Nenhum WhatsApp conectado.{" "}
                  {canManageConnections ? (
                    <Link href="/conexoes" className="font-semibold underline">
                      Conectar agora
                    </Link>
                  ) : (
                    "Peça ao administrador para conectar."
                  )}
                </Notice>
              </div>
            )}

            <ul className="flex-1 divide-y divide-separator overflow-y-auto rounded-[var(--radius-card)] bg-surface md:rounded-none">
              {list.length === 0 && (
                <li className="px-6 py-12 text-center text-[15px] text-ink-2">
                  {q ? "Nada encontrado." : "Nenhuma conversa aqui."}
                </li>
              )}
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid="conversation-item"
                    onClick={() => setSelected(c.id)}
                    className={cx(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                      selected === c.id ? "bg-accent-soft" : "hover:bg-fill",
                    )}
                  >
                    <Avatar name={contactLabel(c)} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cx(
                            "truncate text-[16px]",
                            c.unreadCount > 0 ? "font-semibold" : "font-medium",
                          )}
                        >
                          {contactLabel(c)}
                        </span>
                        <span
                          className={cx(
                            "shrink-0 text-[12px]",
                            c.unreadCount > 0 ? "text-accent" : "text-ink-3",
                          )}
                        >
                          {listTime(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink-2">
                          {c.lastMessageFromMe ? "Você: " : ""}
                          {c.lastMessagePreview || "Sem mensagens"}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-3">
                        <span className="truncate">{c.connectionName}</span>
                        <span>·</span>
                        <span className="truncate">{c.assignedUserName ?? "Sem responsável"}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Conversa */}
          <section
            className={cx(
              "min-w-0 flex-1 flex-col bg-bg md:flex md:bg-surface",
              selected ? "fixed inset-0 z-40 flex md:static md:z-auto" : "hidden",
            )}
            aria-label="Conversa"
          >
            {!selected && (
              <div className="hidden flex-1 items-center justify-center text-[15px] text-ink-3 md:flex">
                Escolha uma conversa
              </div>
            )}
            {selected && (
              <Thread
                key={selected}
                id={selected}
                thread={thread}
                error={threadError}
                me={me}
                people={people}
                canViewAll={canViewAll}
                agentActive={agentActive}
                onBack={() => setSelected(null)}
                onChanged={() => {
                  loadThread(selected);
                  loadList();
                }}
              />
            )}
          </section>
        </div>

        {showNew && (
          <NewConversation
            connections={connections}
            onClose={() => setShowNew(false)}
            onStarted={(id) => {
              setShowNew(false);
              setFilter("open");
              setSelected(id);
              loadList();
            }}
          />
        )}
      </div>
    </Extras.Provider>
  );
}

function Thread({
  id,
  thread,
  error,
  me,
  people,
  canViewAll,
  agentActive,
  onBack,
  onChanged,
}: {
  id: string;
  thread: ThreadData | null;
  error: string | null;
  me: { id: string; name: string };
  people: Person[];
  canViewAll: boolean;
  agentActive: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const count = thread?.messages.length ?? 0;
  const [actionError, setActionError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  // Trocou de conversa: limpa resposta/edição em andamento.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reage só à troca de conversa
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
  }, [id]);

  useEffect(() => {
    if (count) bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function act(body: Record<string, unknown>) {
    setActionError(null);
    try {
      await api(`/api/conversas/${id}/acoes`, { method: "POST", body: JSON.stringify(body) });
      onChanged();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  const c = thread?.conversation;
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Msg[] }[] = [];
    for (const m of thread?.messages ?? []) {
      const k = dayKey(m.sentAt);
      const last = out.at(-1);
      if (last?.key === k) last.items.push(m);
      else out.push({ key: k, label: dayLabel(m.sentAt), items: [m] });
    }
    return out;
  }, [thread?.messages]);

  return (
    <>
      <header className="material flex items-center gap-3 border-b border-separator px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full p-1 text-accent md:hidden"
          aria-label="Voltar"
        >
          <ChevronLeft size={26} />
        </button>
        {c ? (
          <>
            <Avatar name={contactLabel(c)} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold" data-testid="thread-title">
                {contactLabel(c)}
              </p>
              <p className="truncate text-[12px] text-ink-2">
                {formatPhone(c.contactPhone)} · {c.connectionName}
              </p>
              {thread?.deal && (
                <Link
                  href={`/crm?n=${thread.deal.id}`}
                  className="mt-0.5 inline-flex max-w-full items-center gap-1.5 truncate text-[12px] font-medium text-accent"
                  data-testid="deal-chip"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: thread.deal.stageColor }}
                  />
                  <span className="truncate">
                    {thread.deal.pipelineName} · {thread.deal.stageName}
                  </span>
                </Link>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canViewAll ? (
                <Select
                  aria-label="Responsável"
                  value={c.assignedUserId ?? ""}
                  onChange={(e) => act({ action: "assign", userId: e.target.value || null })}
                  className="hidden h-8 w-40 text-[13px] sm:block"
                >
                  <option value="">Sem responsável</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              ) : c.assignedUserId !== me.id ? (
                <Button size="sm" variant="secondary" onClick={() => act({ action: "take" })}>
                  <User size={14} /> Puxar para mim
                </Button>
              ) : (
                <Badge tone="accent">Sua</Badge>
              )}
              {c.status === "open" ? (
                <Button size="sm" variant="secondary" onClick={() => act({ action: "close" })}>
                  Fechar
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => act({ action: "open" })}>
                  Reabrir
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 text-[15px] text-ink-3">{error ?? "Carregando…"}</div>
        )}
      </header>

      {c && agentActive && (
        <div
          className={cx(
            "flex items-center gap-2 border-b border-separator px-4 py-1.5 text-[13px]",
            c.aiPaused ? "bg-fill text-ink-2" : "bg-accent-soft text-accent",
          )}
          data-testid="ai-bar"
        >
          <Bot size={15} />
          <span className="min-w-0 flex-1 truncate">
            {c.aiPaused
              ? `IA pausada${c.aiPausedReason ? `: ${c.aiPausedReason}` : ""}`
              : "IA respondendo esta conversa"}
          </span>
          <button
            type="button"
            className="shrink-0 font-semibold underline"
            onClick={() => act({ action: c.aiPaused ? "ai_on" : "ai_off" })}
          >
            {c.aiPaused ? "Religar IA" : "Pausar IA"}
          </button>
        </div>
      )}

      {c && <SummaryBar conv={c} onChanged={onChanged} />}

      {actionError && (
        <div className="px-4 pt-3">
          <Notice>{actionError}</Notice>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6" data-testid="thread-messages">
        {c && thread?.messages.length === 0 && (
          <p className="mt-10 text-center text-[14px] text-ink-3">
            Nenhuma mensagem ainda. Mande a primeira.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="my-3 flex justify-center">
              <span className="rounded-full bg-fill px-3 py-1 text-[12px] font-medium text-ink-2">
                {g.label}
              </span>
            </div>
            {g.items.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                onRetry={onChanged}
                onReply={() => {
                  setEditing(null);
                  setReplyTo(m);
                }}
                onEdit={() => {
                  setReplyTo(null);
                  setEditing(m);
                }}
                onError={setActionError}
              />
            ))}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {c && (
        <Composer
          key={id}
          id={id}
          contactName={contactLabel(c)}
          onSent={onChanged}
          replyTo={replyTo}
          editing={editing}
          onCancel={() => {
            setReplyTo(null);
            setEditing(null);
          }}
          scheduled={thread?.scheduled ?? []}
        />
      )}
    </>
  );
}

function StatusIcon({ s }: { s: Msg["status"] }) {
  if (s === "pending") return <Clock size={13} aria-label="Enviando" />;
  if (s === "sent") return <Check size={14} aria-label="Enviada" />;
  if (s === "delivered") return <CheckCheck size={14} aria-label="Entregue" />;
  if (s === "read") return <CheckCheck size={14} className="text-[#7cc4ff]" aria-label="Lida" />;
  return <AlertCircle size={14} aria-label="Falhou" />;
}

function Media({ m, out }: { m: Msg; out: boolean }) {
  const src = `/api/mensagens/${m.id}/midia`;
  if (m.type === "image" || m.type === "sticker")
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block">
        {/* biome-ignore lint/performance/noImgElement: mídia autenticada servida pela API */}
        <img
          src={src}
          alt={m.body ?? "Imagem"}
          loading="lazy"
          className={cx(
            "rounded-xl object-cover",
            m.type === "sticker" ? "h-32 w-32" : "max-h-72 w-full min-w-40",
          )}
        />
      </a>
    );
  if (m.type === "video")
    // biome-ignore lint/a11y/useMediaCaption: vídeo enviado pelo contato, sem legenda disponível
    return <video src={src} controls preload="metadata" className="max-h-72 w-full rounded-xl" />;
  if (m.type === "audio") return <AudioMessage m={m} src={src} out={out} />;
  if (m.type === "document")
    return (
      <a
        href={`${src}?baixar=1`}
        className={cx("flex items-center gap-2 rounded-xl px-3 py-2", out ? "bg-white/15" : "bg-surface")}
      >
        <FileText size={20} />
        <span className="truncate text-[14px] font-medium">{m.mediaName ?? "Documento"}</span>
      </a>
    );
  if (m.type === "location" && m.body)
    return (
      <a
        href={`https://www.google.com/maps?q=${encodeURIComponent(m.body)}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 underline"
      >
        <MapPin size={16} /> Ver localização
      </a>
    );
  return null;
}

function AudioMessage({ m, src, out }: { m: Msg; src: string; out: boolean }) {
  const { sttEnabled } = useContext(Extras);
  const [text, setText] = useState(m.transcript);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      {/* biome-ignore lint/a11y/useMediaCaption: a transcrição aparece logo abaixo */}
      <audio src={src} controls preload="none" className="w-64 max-w-full" />
      {text ? (
        <p
          className={cx("mt-1 text-[14px] italic", out ? "text-white/90" : "text-ink-2")}
          data-testid="transcricao"
        >
          “{text}”
        </p>
      ) : sttEnabled ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await api<{ text: string | null }>(`/api/mensagens/${m.id}/transcrever`, {
                method: "POST",
              });
              setText(r.text);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="mt-1 text-[13px] font-semibold underline"
        >
          {busy ? "Transcrevendo..." : "Transcrever"}
        </button>
      ) : null}
      {err && <p className="mt-1 text-[12px]">{err}</p>}
    </div>
  );
}

const TEMP: Record<LeadSummary["temperatura"], { label: string; cls: string }> = {
  quente: { label: "Quente", cls: "bg-danger-soft text-danger" },
  morno: { label: "Morno", cls: "bg-warn-soft text-warn" },
  frio: { label: "Frio", cls: "bg-fill text-ink-2" },
};

function SummaryBar({ conv, onChanged }: { conv: Conv; onChanged: () => void }) {
  const { aiEnabled } = useContext(Extras);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = conv.aiSummary;
  if (!aiEnabled && !s) return null;
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/conversas/${conv.id}/resumo`, { method: "POST" });
      setOpen(true);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-b border-separator px-4 py-1.5 text-[13px]" data-testid="resumo-ia">
      <div className="flex items-center gap-2">
        {s ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span
              className={cx(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                TEMP[s.temperatura].cls,
              )}
            >
              {TEMP[s.temperatura].label} · {s.nota}/10
            </span>
            <span className="truncate text-ink-2">{s.interesse ?? s.resumo}</span>
          </button>
        ) : (
          <span className="flex-1 text-ink-3">Sem resumo da IA</span>
        )}
        {aiEnabled && (
          <button type="button" disabled={busy} onClick={run} className="shrink-0 font-semibold text-accent">
            {busy ? "Resumindo..." : s ? "Atualizar" : "Resumir com IA"}
          </button>
        )}
      </div>
      {s && open && (
        <div className="mt-2 space-y-1 rounded-xl bg-fill/70 p-3 text-[13px] text-ink">
          <p>{s.resumo}</p>
          {s.objecoes && (
            <p>
              <span className="font-semibold">Objeções:</span> {s.objecoes}
            </p>
          )}
          {s.proximoPasso && (
            <p>
              <span className="font-semibold">Próximo passo:</span> {s.proximoPasso}
            </p>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-danger">{err}</p>}
    </div>
  );
}

function Bubble({
  m,
  onRetry,
  onReply,
  onEdit,
  onError,
}: {
  m: Msg;
  onRetry: () => void;
  onReply: () => void;
  onEdit: () => void;
  onError: (e: string | null) => void;
}) {
  const out = m.direction === "out";
  const [retrying, setRetrying] = useState(false);
  const [menu, setMenu] = useState(false);
  if (m.internal)
    return (
      <div className="mb-1.5 flex justify-end" data-testid="note">
        <div className="max-w-[82%] rounded-[18px] rounded-br-md border border-warn/30 bg-warn-soft px-3 py-2 text-ink md:max-w-[65%]">
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-warn">
            <StickyNote size={12} /> Nota interna{m.sentByName ? ` · ${m.sentByName.split(" ")[0]}` : ""}
          </p>
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>
          <p className="mt-1 text-right text-[11px] text-ink-3">{messageTime(m.sentAt)}</p>
        </div>
      </div>
    );
  const showBody = m.body && m.type !== "location";
  const deleted = !!m.deletedAt;
  async function remove() {
    setMenu(false);
    if (!confirm("Apagar esta mensagem para todos?")) return;
    onError(null);
    try {
      await api(`/api/mensagens/${m.id}`, { method: "DELETE" });
      onRetry();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <div
      className={cx("group mb-1.5 flex items-center gap-1", out ? "justify-end" : "justify-start")}
      data-testid="message"
    >
      {out && !deleted && (
        <MessageMenu
          open={menu}
          setOpen={setMenu}
          m={m}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={remove}
        />
      )}
      <div
        className={cx(
          "max-w-[82%] rounded-[18px] px-3 py-2 md:max-w-[65%]",
          out ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-fill text-ink",
          m.status === "failed" && "bg-danger-soft text-danger",
          deleted && "opacity-70",
        )}
      >
        {m.quoted && (
          <div
            className={cx(
              "mb-1.5 rounded-lg border-l-4 px-2 py-1 text-[13px]",
              out ? "border-white/60 bg-white/15" : "border-accent bg-surface",
            )}
            data-testid="citacao"
          >
            <p className="font-semibold">{m.quoted.fromMe ? "Você" : "Cliente"}</p>
            <p className="line-clamp-2 opacity-90">{snippet(m.quoted)}</p>
          </div>
        )}
        {deleted && (
          <p className="mb-1 text-[13px] italic" data-testid="apagada">
            {out ? "Você apagou esta mensagem" : "O cliente apagou esta mensagem"}
          </p>
        )}
        {m.type !== "text" && !deleted && <Media m={m} out={out} />}
        {showBody && (
          <p
            className={cx(
              "whitespace-pre-wrap break-words text-[15px] leading-snug",
              m.type !== "text" && "mt-1.5",
              deleted && "text-[13px] line-through",
            )}
          >
            {m.body}
          </p>
        )}
        {m.type === "other" && !m.body && (
          <p className="text-[14px] italic opacity-80">Mensagem não suportada</p>
        )}
        <div
          className={cx(
            "mt-1 flex items-center justify-end gap-1 text-[11px]",
            out ? "text-white/75" : "text-ink-3",
          )}
        >
          {m.automation && AUTOMATION_LABEL[m.automation] && (
            <span className="mr-1 font-semibold">{AUTOMATION_LABEL[m.automation]}</span>
          )}
          {m.editedAt && <span className="mr-1 italic">editada</span>}
          {out && m.sentByAi && <span className="mr-1 font-semibold">IA</span>}
          {out && !m.sentByAi && m.sentByName && (
            <span className="mr-1 truncate">{m.sentByName.split(" ")[0]}</span>
          )}
          <span>{messageTime(m.sentAt)}</span>
          {out && <StatusIcon s={m.status} />}
        </div>
        {m.status === "failed" && (
          <button
            type="button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              await fetch(`/api/mensagens/${m.id}/reenviar`, { method: "POST" }).catch(() => {});
              setRetrying(false);
              onRetry();
            }}
            className="mt-1 text-[13px] font-semibold underline"
          >
            Não enviada. Tentar de novo
          </button>
        )}
      </div>
      {!out && !deleted && (
        <MessageMenu
          open={menu}
          setOpen={setMenu}
          m={m}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={remove}
        />
      )}
    </div>
  );
}

function MessageMenu({
  open,
  setOpen,
  m,
  onReply,
  onEdit,
  onDelete,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  m: Msg;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canReply = m.status !== "failed" && m.status !== "pending";
  if (!canReply && !m.canEdit && !m.canDelete) return null;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Ações da mensagem"
        className="rounded-full p-1 text-ink-3 opacity-60 hover:bg-fill hover:opacity-100 md:opacity-0 md:group-hover:opacity-100"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          className={cx(
            "absolute top-7 z-20 w-44 rounded-xl bg-surface p-1 text-[14px] shadow-lg ring-1 ring-separator",
            m.direction === "out" ? "right-0" : "left-0",
          )}
        >
          {canReply && (
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-fill"
              onClick={() => {
                setOpen(false);
                onReply();
              }}
            >
              Responder
            </button>
          )}
          {m.canEdit && (
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-fill"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Editar
            </button>
          )}
          {m.canDelete && (
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-danger hover:bg-fill"
              onClick={onDelete}
            >
              Apagar para todos
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const whenFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function Composer({
  id,
  contactName,
  onSent,
  replyTo,
  editing,
  onCancel,
  scheduled,
}: {
  id: string;
  contactName: string;
  onSent: () => void;
  replyTo: Msg | null;
  editing: Msg | null;
  onCancel: () => void;
  scheduled: Scheduled[];
}) {
  const { quickReplies } = useContext(Extras);
  const [text, setText] = useState("");
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  // Entrou em modo edição: traz o texto da mensagem.
  useEffect(() => {
    if (editing) {
      setText(editing.body ?? "");
      setScheduleAt(null);
      areaRef.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Atalho "/": lista as respostas rápidas enquanto a pessoa digita o atalho.
  const slash = !note && /^\/[\w-]*$/.test(text) ? text.slice(1).toLowerCase() : null;
  const matches =
    slash === null
      ? []
      : quickReplies
          .filter((r) => r.shortcut.includes(slash))
          .sort((a, b) => Number(!a.shortcut.startsWith(slash)) - Number(!b.shortcut.startsWith(slash)))
          .slice(0, 6);

  function choose(r: QuickReply) {
    setText(fillReply(r.body, contactName));
    setPick(0);
    areaRef.current?.focus();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (sending || (!text.trim() && !file)) return;
    setSending(true);
    setError(null);
    const json = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      if (editing) {
        await api(`/api/mensagens/${editing.id}/editar`, json({ text }));
        onCancel();
      } else if (note) {
        await api(`/api/conversas/${id}/notas`, json({ text }));
      } else if (scheduleAt !== null) {
        if (!scheduleAt) throw new Error("Escolha dia e hora para agendar.");
        await api(`/api/conversas/${id}/agendar`, json({ text, sendAt: scheduleAt }));
        setScheduleAt(null);
      } else {
        const fd = new FormData();
        if (text.trim()) fd.set("text", text);
        if (file) fd.set("file", file);
        if (replyTo) fd.set("replyTo", replyTo.id);
        await api(`/api/conversas/${id}/mensagens`, { method: "POST", body: fd });
        if (replyTo) onCancel();
      }
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
      areaRef.current?.focus();
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cx(
        "material relative border-t border-separator px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 md:px-5",
        note && "bg-warn-soft/60",
      )}
    >
      {error && (
        <div className="mb-2">
          <Notice>{error}</Notice>
        </div>
      )}
      {matches.length > 0 && (
        <ul
          aria-label="Respostas rápidas"
          className="absolute right-3 bottom-full left-3 mb-2 max-h-72 overflow-y-auto rounded-2xl bg-surface p-1 shadow-lg ring-1 ring-separator md:right-5 md:left-5"
        >
          {matches.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                className={cx(
                  "block w-full rounded-xl px-3 py-2 text-left",
                  i === pick ? "bg-fill" : "hover:bg-fill/60",
                )}
              >
                <span className="block text-[13px] font-semibold text-accent">/{r.shortcut}</span>
                <span className="line-clamp-2 block text-[14px] text-ink-2">{r.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {scheduled.length > 0 && !editing && (
        <ul className="mb-2 space-y-1" data-testid="agendadas">
          {scheduled.map((sm) => (
            <li key={sm.id} className="flex items-center gap-2 rounded-xl bg-fill px-3 py-1.5 text-[13px]">
              <Clock size={14} className="shrink-0 text-ink-2" />
              <span className="shrink-0 font-medium">{whenFmt.format(new Date(sm.sendAt))}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{sm.body}</span>
              <button
                type="button"
                className="shrink-0 font-semibold text-danger"
                onClick={async () => {
                  await api(`/api/agendadas/${sm.id}`, { method: "DELETE" }).catch(() => {});
                  onSent();
                }}
              >
                Cancelar
              </button>
            </li>
          ))}
        </ul>
      )}
      {(replyTo || editing) && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border-l-4 border-accent bg-fill px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">{editing ? "Editando: " : "Respondendo: "}</span>
            {snippet((editing ?? replyTo) as Msg)}
          </span>
          <button
            type="button"
            onClick={() => {
              if (editing) setText("");
              onCancel();
            }}
            aria-label="Cancelar"
            className="text-ink-2"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {scheduleAt !== null && !editing && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-1.5 text-[13px] text-accent">
          <Clock size={14} />
          <span className="font-medium">Agendar para</span>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            aria-label="Agendar para"
            className="rounded-lg bg-surface px-2 py-1 text-ink"
          />
          <button type="button" onClick={() => setScheduleAt(null)} className="ml-auto font-semibold">
            Cancelar
          </button>
        </div>
      )}
      {note && (
        <p className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-warn">
          <StickyNote size={12} /> Nota interna: só a equipe vê, não vai para o cliente.
        </p>
      )}
      {file && !note && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[14px]">
          <Paperclip size={16} className="text-ink-2" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            aria-label="Remover anexo"
            className="text-ink-2"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {!note && !editing && scheduleAt === null && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mb-1 rounded-full p-2 text-ink-2 hover:bg-fill"
            aria-label="Anexar arquivo"
          >
            <Paperclip size={20} />
          </button>
        )}
        {!editing && !note && !file && (
          <button
            type="button"
            onClick={() => setScheduleAt((v) => (v === null ? "" : null))}
            aria-pressed={scheduleAt !== null}
            aria-label="Agendar mensagem"
            title="Agendar mensagem"
            className={cx(
              "mb-1 rounded-full p-2 hover:bg-fill",
              scheduleAt !== null ? "bg-accent-soft text-accent" : "text-ink-2",
            )}
          >
            <Clock size={20} />
          </button>
        )}
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setNote((v) => !v);
              setScheduleAt(null);
            }}
            aria-pressed={note}
            aria-label="Nota interna"
            title="Nota interna"
            className={cx(
              "mb-1 rounded-full p-2 hover:bg-fill",
              note ? "bg-warn-soft text-warn" : "text-ink-2",
            )}
          >
            <StickyNote size={20} />
          </button>
        )}
        {!note && !editing && quickReplies.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setText("/");
              areaRef.current?.focus();
            }}
            aria-label="Respostas rápidas"
            title="Respostas rápidas (/)"
            className="mb-1 hidden rounded-full p-2 text-ink-2 hover:bg-fill sm:block"
          >
            <Zap size={20} />
          </button>
        )}
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPick(0);
          }}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
                e.preventDefault();
                const r = matches[pick];
                if (r) choose(r);
                return;
              }
              if (e.key === "Escape") {
                setText("");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            note ? "Nota para a equipe" : file ? "Legenda (opcional)" : "Mensagem ou / para respostas rápidas"
          }
          aria-label={note ? "Nota interna" : "Mensagem"}
          className={cx(
            "max-h-40 min-h-10 flex-1 resize-none rounded-[20px] border bg-surface px-4 py-2 text-[15px] outline-none",
            note ? "border-warn/40 focus:border-warn" : "border-separator focus:border-accent",
          )}
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="submit"
          disabled={sending || (!text.trim() && !file)}
          className={cx(
            "mb-0.5 flex h-9 w-9 items-center justify-center rounded-full text-white transition disabled:opacity-30",
            note ? "bg-warn" : "bg-accent",
          )}
          aria-label={
            note ? "Salvar nota" : editing ? "Salvar edição" : scheduleAt !== null ? "Agendar" : "Enviar"
          }
        >
          {note ? (
            <StickyNote size={16} />
          ) : scheduleAt !== null ? (
            <Clock size={16} />
          ) : editing ? (
            <Check size={16} />
          ) : (
            <SendHorizontal size={18} />
          )}
        </button>
      </div>
    </form>
  );
}

function NewConversation({
  connections,
  onClose,
  onStarted,
}: {
  connections: Connection[];
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const usable = connections.filter((c) => c.status === "open");
  const [connectionId, setConnectionId] = useState(usable[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [brazil, setBrazil] = useState(true);
  const [landline, setLandline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/conversas/nova", {
        method: "POST",
        body: JSON.stringify({ connectionId, phone, brazil, landline }),
      });
      onStarted(r.id);
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
      aria-label="Nova conversa"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[420px] space-y-4 rounded-t-[22px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float md:rounded-[22px]"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold">Nova conversa</h2>
            <p className="mt-1 text-[14px] text-ink-2">Digite o número com DDD.</p>
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
        {usable.length === 0 ? (
          <Notice>Nenhuma conexão de WhatsApp conectada agora.</Notice>
        ) : (
          <>
            {usable.length > 1 && (
              <Field label="Enviar por">
                <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                  {usable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `· ${formatPhone(c.phone)}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field
              label="Número"
              hint={brazil ? "O +55 e o 9 do celular entram sozinhos se faltarem." : undefined}
            >
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="(48) 99999-9999"
                required
                autoFocus
              />
            </Field>
            <label className="flex items-center justify-between text-[15px]">
              Número brasileiro
              <input
                type="checkbox"
                checked={brazil}
                onChange={(e) => setBrazil(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
            {brazil && (
              <label className="flex items-center justify-between text-[15px]">
                Telefone fixo (não colocar o 9)
                <input
                  type="checkbox"
                  checked={landline}
                  onChange={(e) => setLandline(e.target.checked)}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
              </label>
            )}
            {error && <Notice>{error}</Notice>}
            <Button size="lg" disabled={busy || !phone.trim()}>
              {busy ? "Conferindo número…" : "Iniciar conversa"}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
