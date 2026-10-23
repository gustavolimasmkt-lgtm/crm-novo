"use client";

import { ChevronLeft, ChevronRight, Download, MessageCircle, Plus, Search, Upload, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useState } from "react";
import {
  createContactAction,
  deleteContactAction,
  talkToContactAction,
  updateContactAction,
} from "@/app/actions/contacts";
import { Avatar, Badge, Button, cx, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import type { FormState } from "@/lib/form";
import { formatPhone, listTime } from "@/lib/format";

type Row = {
  id: string;
  name: string | null;
  pushName: string | null;
  email: string | null;
  phone: string | null;
  waVerified: boolean;
  createdAt: string;
};
type Detail = Row & {
  conversations: { id: string; status: string; lastMessageAt: string | null; connectionName: string }[];
};

const label = (c: Pick<Row, "name" | "pushName" | "phone">) =>
  c.name || c.pushName || formatPhone(c.phone) || "Sem nome";

export function ContactsClient({
  list,
  q,
  selected,
  creating,
  canManage,
  connections,
}: {
  list: { items: Row[]; total: number; page: number; pageSize: number };
  q: string;
  selected: Detail | null;
  creating: boolean;
  canManage: boolean;
  connections: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);
  const [importing, setImporting] = useState(false);
  const pages = Math.max(Math.ceil(list.total / list.pageSize), 1);

  const href = (params: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, p: list.page > 1 ? list.page : undefined, ...params };
    for (const [k, v] of Object.entries(merged))
      if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
    const s = p.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: só reage à busca digitada
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => {
      // Mexe só na busca: mantém painel aberto (id/novo) e volta para a página 1.
      const p = new URLSearchParams(window.location.search);
      if (search.trim()) p.set("q", search.trim());
      else p.delete("q");
      p.delete("p");
      const s = p.toString();
      router.replace(s ? `${pathname}?${s}` : pathname);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const panelOpen = creating || !!selected;
  const close = () => router.push(href({ id: undefined, novo: undefined }));

  return (
    <>
      <PageHeader
        title="Contatos"
        subtitle={`${list.total.toLocaleString("pt-BR")} contato${list.total === 1 ? "" : "s"}`}
        actions={
          <>
            {canManage && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
                  <Upload size={15} /> Importar
                </Button>
                <a
                  href="/api/contatos/exportar"
                  className="inline-flex h-8 items-center gap-2 rounded-full bg-fill px-3 text-[13px] font-medium hover:bg-fill-strong"
                >
                  <Download size={15} /> Exportar
                </a>
              </>
            )}
            <Link
              href={href({ novo: 1, id: undefined })}
              className="inline-flex h-8 items-center gap-2 rounded-full bg-accent px-3 text-[13px] font-medium text-white"
            >
              <Plus size={15} /> Novo contato
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="relative mb-4">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone"
              className="pl-9"
              aria-label="Buscar contatos"
            />
          </div>
          <div className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {list.items.length === 0 && (
              <p className="px-6 py-12 text-center text-[15px] text-ink-2">
                {q
                  ? "Nenhum contato encontrado."
                  : "Nenhum contato ainda. Eles aparecem aqui quando alguém escreve no WhatsApp, ou você pode importar."}
              </p>
            )}
            {list.items.map((c) => (
              <Link
                key={c.id}
                href={href({ id: c.id, novo: undefined })}
                data-testid="contact-row"
                className={cx(
                  "flex items-center gap-3 px-4 py-3 transition-colors",
                  selected?.id === c.id ? "bg-accent-soft" : "hover:bg-fill",
                )}
              >
                <Avatar name={label(c)} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium">{label(c)}</span>
                  <span className="block truncate text-[13px] text-ink-2">
                    {formatPhone(c.phone)}
                    {c.email ? ` · ${c.email}` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          {pages > 1 && (
            <nav
              className="mt-3 flex items-center justify-between px-1 text-[14px] text-ink-2"
              aria-label="Páginas"
            >
              <span>
                Página {list.page} de {pages}
              </span>
              <span className="flex gap-2">
                <Link
                  aria-disabled={list.page <= 1}
                  href={href({ p: list.page - 1, id: undefined })}
                  className={cx(
                    "rounded-full bg-fill p-1.5",
                    list.page <= 1 && "pointer-events-none opacity-40",
                  )}
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={18} />
                </Link>
                <Link
                  aria-disabled={list.page >= pages}
                  href={href({ p: list.page + 1, id: undefined })}
                  className={cx(
                    "rounded-full bg-fill p-1.5",
                    list.page >= pages && "pointer-events-none opacity-40",
                  )}
                  aria-label="Próxima página"
                >
                  <ChevronRight size={18} />
                </Link>
              </span>
            </nav>
          )}
        </div>

        {panelOpen && (
          <Panel onClose={close} title={creating ? "Novo contato" : "Contato"}>
            {creating ? (
              <NewContactForm />
            ) : selected ? (
              <EditContact key={selected.id} c={selected} canManage={canManage} connections={connections} />
            ) : null}
          </Panel>
        )}
      </div>

      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => router.refresh()} />}
    </>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40 lg:static lg:z-auto lg:block lg:bg-transparent">
      <aside
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[22px] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:sticky lg:top-6 lg:max-h-none lg:rounded-[var(--radius-card)]"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[19px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-fill p-1.5 text-ink-2"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function NewContactForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createContactAction, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Nome">
        <Input name="name" required maxLength={80} autoFocus />
      </Field>
      <Field label="Telefone" hint="Com DDD. Não precisa do +55.">
        <Input name="phone" required inputMode="tel" placeholder="(48) 99999-9999" />
      </Field>
      <label className="flex items-center justify-between text-[15px]">
        Telefone fixo (não colocar o 9)
        <input type="checkbox" name="landline" className="h-5 w-5 accent-[var(--accent)]" />
      </label>
      <Field label="E-mail">
        <Input name="email" type="email" maxLength={120} />
      </Field>
      {state.error && <Notice>{state.error}</Notice>}
      <Button className="w-full" disabled={pending}>
        {pending ? "Salvando…" : "Salvar contato"}
      </Button>
    </form>
  );
}

function EditContact({
  c,
  canManage,
  connections,
}: {
  c: Detail;
  canManage: boolean;
  connections: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateContactAction, {});
  const [delState, delAction, deleting] = useActionState<FormState, FormData>(deleteContactAction, {});
  const [talkState, talkAction, talking] = useActionState<FormState, FormData>(talkToContactAction, {});
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Avatar name={label(c)} size={52} />
        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold">{label(c)}</p>
          <p className="text-[14px] text-ink-2">{formatPhone(c.phone)}</p>
          {c.pushName && c.name && c.pushName !== c.name && (
            <p className="text-[12px] text-ink-3">No WhatsApp: {c.pushName}</p>
          )}
        </div>
      </div>

      {c.phone && connections.length > 0 && (
        <form action={talkAction} className="space-y-2">
          <input type="hidden" name="phone" value={c.phone} />
          {connections.length > 1 ? (
            <Select name="connectionId" aria-label="Conexão" className="h-9">
              {connections.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          ) : (
            <input type="hidden" name="connectionId" value={connections[0]?.id} />
          )}
          <Button className="w-full" disabled={talking}>
            <MessageCircle size={17} /> {talking ? "Abrindo…" : "Conversar no WhatsApp"}
          </Button>
          {talkState.error && <Notice>{talkState.error}</Notice>}
        </form>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="id" value={c.id} />
        <Field label="Nome">
          <Input name="name" required maxLength={80} defaultValue={c.name ?? c.pushName ?? ""} />
        </Field>
        <Field label="E-mail">
          <Input name="email" type="email" maxLength={120} defaultValue={c.email ?? ""} />
        </Field>
        <Field label="Telefone" hint="O telefone não muda: é a identidade do contato no WhatsApp.">
          <Input value={formatPhone(c.phone)} readOnly disabled />
        </Field>
        {state.error && <Notice>{state.error}</Notice>}
        {state.ok && <Notice tone="ok">{state.message}</Notice>}
        <Button className="w-full" variant="secondary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </form>

      <section>
        <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-ink-3">Conversas</h3>
        {c.conversations.length === 0 ? (
          <p className="text-[14px] text-ink-2">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="divide-y divide-separator rounded-xl bg-fill">
            {c.conversations.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/conversas?c=${v.id}`}
                  className="flex items-center justify-between px-3 py-2.5 text-[14px]"
                >
                  <span>{v.connectionName}</span>
                  <span className="flex items-center gap-2 text-ink-2">
                    {listTime(v.lastMessageAt)}
                    <Badge tone={v.status === "open" ? "ok" : "neutral"}>
                      {v.status === "open" ? "Aberta" : "Fechada"}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <form action={delAction}>
          <input type="hidden" name="id" value={c.id} />
          {confirm ? (
            <div className="space-y-2 rounded-xl bg-danger-soft p-3">
              <p className="text-[14px] text-danger">
                Isso apaga o contato e todo o histórico de conversas dele. Não dá para desfazer.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" disabled={deleting}>
                  Excluir de vez
                </Button>
                <Button type="button" size="sm" variant="plain" onClick={() => setConfirm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="text-[14px] font-medium text-danger"
            >
              Excluir contato
            </button>
          )}
          {delState.error && <Notice>{delState.error}</Notice>}
        </form>
      )}
    </div>
  );
}

type ImportResult = {
  total: number;
  created: number;
  existing: number;
  invalid: { line: number; reason: string }[];
  dealRows: number;
};

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [brazil, setBrazil] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("brazil", String(brazil));
    try {
      const r = await fetch("/api/contatos/importar", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falha na importação.");
      setResult(j);
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
      aria-label="Importar contatos"
    >
      <div className="w-full max-w-[480px] space-y-4 rounded-t-[22px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float md:rounded-[22px]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold">Importar contatos</h2>
            <p className="mt-1 text-[14px] text-ink-2">
              Arquivo CSV com as colunas <strong>nome</strong>, <strong>telefone</strong> e, se quiser,{" "}
              <strong>email</strong> e <strong>fixo</strong>. Serve o arquivo exportado do sistema antigo.
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
              {result.created.toLocaleString("pt-BR")} contatos novos ·{" "}
              {result.existing.toLocaleString("pt-BR")} já existiam
              {result.invalid.length ? ` · ${result.invalid.length} linhas com problema` : ""}
            </Notice>
            {result.dealRows > 0 && (
              <p className="text-[14px] text-ink-2">
                {result.dealRows} linhas pediam negociação: aqui só o contato foi importado. Para criar as
                negociações, importe o mesmo arquivo em CRM → Importar.
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
                data-testid="import-file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="flex items-center justify-between text-[15px]">
              Os números são brasileiros
              <input
                type="checkbox"
                checked={brazil}
                onChange={(e) => setBrazil(e.target.checked)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
            <p className="text-[13px] text-ink-3">
              Telefone que já existe não duplica: o contato é reaproveitado.
            </p>
            {error && <Notice>{error}</Notice>}
            <Button size="lg" disabled={!file || busy} onClick={send}>
              {busy ? "Importando…" : "Importar"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
