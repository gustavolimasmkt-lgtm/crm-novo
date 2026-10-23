"use client";

import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronLeft,
  Clock,
  FileText,
  MapPin,
  MessageSquarePlus,
  Paperclip,
  Search,
  SendHorizontal,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};
type Connection = { id: string; name: string; phone: string | null; status: string };
type DealChip = { id: string; number: number; stageName: string; stageColor: string; pipelineName: string };
type ThreadData = { conversation: Conv; messages: Msg[]; deal: DealChip | null };
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
}: {
  initial: Conv[];
  initialSelected: string | null;
  connections: Connection[];
  people: Person[];
  me: { id: string; name: string };
  canViewAll: boolean;
  canManageConnections: boolean;
}) {
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
  );
}

function Thread({
  id,
  thread,
  error,
  me,
  people,
  canViewAll,
  onBack,
  onChanged,
}: {
  id: string;
  thread: ThreadData | null;
  error: string | null;
  me: { id: string; name: string };
  people: Person[];
  canViewAll: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const count = thread?.messages.length ?? 0;
  const [actionError, setActionError] = useState<string | null>(null);

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
              <Bubble key={m.id} m={m} onRetry={onChanged} />
            ))}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {c && <Composer id={id} onSent={onChanged} />}
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
  if (m.type === "audio")
    // biome-ignore lint/a11y/useMediaCaption: áudio de WhatsApp não tem legenda
    return <audio src={src} controls preload="none" className="w-64 max-w-full" />;
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

function Bubble({ m, onRetry }: { m: Msg; onRetry: () => void }) {
  const out = m.direction === "out";
  const [retrying, setRetrying] = useState(false);
  const showBody = m.body && m.type !== "location";
  return (
    <div className={cx("mb-1.5 flex", out ? "justify-end" : "justify-start")} data-testid="message">
      <div
        className={cx(
          "max-w-[82%] rounded-[18px] px-3 py-2 md:max-w-[65%]",
          out ? "rounded-br-md bg-accent text-white" : "rounded-bl-md bg-fill text-ink",
          m.status === "failed" && "bg-danger-soft text-danger",
        )}
      >
        {m.type !== "text" && <Media m={m} out={out} />}
        {showBody && (
          <p
            className={cx(
              "whitespace-pre-wrap break-words text-[15px] leading-snug",
              m.type !== "text" && "mt-1.5",
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
          {out && m.sentByName && <span className="mr-1 truncate">{m.sentByName.split(" ")[0]}</span>}
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
    </div>
  );
}

function Composer({ id, onSent }: { id: string; onSent: () => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (sending || (!text.trim() && !file)) return;
    setSending(true);
    setError(null);
    const fd = new FormData();
    if (text.trim()) fd.set("text", text);
    if (file) fd.set("file", file);
    try {
      await api(`/api/conversas/${id}/mensagens`, { method: "POST", body: fd });
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
      className="material border-t border-separator px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 md:px-5"
    >
      {error && (
        <div className="mb-2">
          <Notice>{error}</Notice>
        </div>
      )}
      {file && (
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
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mb-1 rounded-full p-2 text-ink-2 hover:bg-fill"
          aria-label="Anexar arquivo"
        >
          <Paperclip size={20} />
        </button>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={file ? "Legenda (opcional)" : "Mensagem"}
          aria-label="Mensagem"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-[20px] border border-separator bg-surface px-4 py-2 text-[15px] outline-none focus:border-accent"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="submit"
          disabled={sending || (!text.trim() && !file)}
          className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white transition disabled:opacity-30"
          aria-label="Enviar"
        >
          <SendHorizontal size={18} />
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
