"use client";

import { Check, Loader2, MessageCircle, Plus, Smartphone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { connectionCommandAction, createConnectionAction } from "@/app/actions/connections";
import { Badge, Button, Field, GroupedList, Input, Notice } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Status = "pending" | "connecting" | "open" | "close";
type Conn = {
  id: string;
  name: string;
  status: Status;
  active: boolean;
  phone: string | null;
  profileName: string | null;
  createdAt: string;
};

export function formatPhone(phone: string | null): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const rest = d.slice(4);
    return `(${d.slice(2, 4)}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return `+${d}`;
}

function StatusBadge({ c }: { c: Pick<Conn, "status" | "active"> }) {
  if (!c.active) return <Badge>Desativada</Badge>;
  if (c.status === "open") return <Badge tone="ok">Conectado</Badge>;
  if (c.status === "pending" || c.status === "connecting")
    return <Badge tone="warn">Aguardando leitura</Badge>;
  return <Badge tone="danger">Desconectado</Badge>;
}

export function ConnectionsClient({
  connections,
  limit,
  configured,
}: {
  connections: Conn[];
  limit: number;
  configured: boolean;
}) {
  const [qrFor, setQrFor] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const full = connections.length >= limit;
  // O estado da criação fica aqui (e não no formulário): ao criar, a lista é recarregada
  // e o formulário some, mas o QR code precisa abrir mesmo assim.
  const [createState, createAction, creating] = useActionState<FormState, FormData>(
    createConnectionAction,
    {},
  );
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const id = createState.data?.id;
    if (createState.ok && id && handled.current !== id) {
      handled.current = id;
      setAdding(false);
      setQrFor({ id, name: createState.data?.name ?? "" });
    }
  }, [createState]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        {!configured && (
          <div className="mb-6">
            <Notice>
              A Evolution API não está configurada no servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY).
            </Notice>
          </div>
        )}
        <GroupedList
          title="WhatsApp"
          footer={`${connections.length} de ${limit} conexão(ões) do seu plano.${full ? " Limite atingido." : ""}`}
        >
          {connections.length === 0 && (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
                <MessageCircle size={24} />
              </span>
              <p className="text-[17px] font-semibold">Nenhum WhatsApp conectado</p>
              <p className="mt-1 max-w-sm text-[15px] text-ink-2">
                Conecte o número da empresa para receber e responder as conversas aqui no CRM.
              </p>
            </div>
          )}
          {connections.map((c) => (
            <ConnectionRow key={c.id} c={c} onConnect={() => setQrFor({ id: c.id, name: c.name })} />
          ))}
        </GroupedList>
      </div>

      <aside>
        {adding || connections.length === 0 ? (
          <NewConnectionForm
            disabled={full || !configured}
            full={full}
            action={createAction}
            pending={creating}
            error={createState.error}
          />
        ) : (
          <Button onClick={() => setAdding(true)} disabled={full || !configured} className="w-full">
            <Plus size={18} /> Nova conexão
          </Button>
        )}
        {full && connections.length > 0 && (
          <p className="mt-3 px-1 text-[13px] text-ink-3">
            Para conectar mais números, peça ao administrador da plataforma para aumentar o limite.
          </p>
        )}
      </aside>

      {qrFor && <QrSheet id={qrFor.id} name={qrFor.name} onClose={() => setQrFor(null)} />}
    </div>
  );
}

function ConnectionRow({ c, onConnect }: { c: Conn; onConnect: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(connectionCommandAction, {});
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="px-4 py-3.5" data-testid="connection-row">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${c.status === "open" && c.active ? "bg-ok-soft text-ok" : "bg-fill text-ink-3"}`}
        >
          <Smartphone size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-medium">{c.name}</p>
          <p className="truncate text-[13px] text-ink-2">
            {c.phone ? formatPhone(c.phone) : "Sem número ainda"}
            {c.profileName ? ` · ${c.profileName}` : ""}
          </p>
        </div>
        <StatusBadge c={c} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
        {c.status !== "open" && (
          <Button type="button" size="sm" onClick={onConnect}>
            {c.status === "close" ? "Reconectar" : "Mostrar QR code"}
          </Button>
        )}
        {c.status === "open" && (
          <Cmd action={action} id={c.id} cmd="disconnect" pending={pending} variant="secondary">
            Desconectar
          </Cmd>
        )}
        <Cmd
          action={action}
          id={c.id}
          cmd={c.active ? "deactivate" : "activate"}
          pending={pending}
          variant="secondary"
        >
          {c.active ? "Desativar" : "Ativar"}
        </Cmd>
        {confirmDelete ? (
          <>
            <Cmd action={action} id={c.id} cmd="delete" pending={pending} variant="danger">
              Confirmar exclusão
            </Cmd>
            <Button type="button" size="sm" variant="plain" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="plain"
            className="text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Excluir
          </Button>
        )}
      </div>
      {state.error && (
        <div className="mt-2 pl-[52px]">
          <Notice>{state.error}</Notice>
        </div>
      )}
    </div>
  );
}

/** Um botão = um formulário com o comando escondido (não depende do botão que enviou). */
function Cmd({
  action,
  id,
  cmd,
  pending,
  variant,
  children,
}: {
  action: (fd: FormData) => void;
  id: string;
  cmd: string;
  pending: boolean;
  variant: "secondary" | "danger";
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="cmd" value={cmd} />
      <Button size="sm" variant={variant} disabled={pending}>
        {children}
      </Button>
    </form>
  );
}

function NewConnectionForm({
  disabled,
  full,
  action,
  pending,
  error,
}: {
  disabled: boolean;
  full: boolean;
  action: (fd: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <form action={action} className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
      <div>
        <h2 className="text-[17px] font-semibold">Nova conexão</h2>
        <p className="mt-1 text-[14px] text-ink-2">
          Depois de criar, leia o QR code com o celular do número.
        </p>
      </div>
      <Field label="Nome da conexão" hint="Ex.: Loja, Vendas, Pós-venda">
        <Input name="name" required minLength={2} maxLength={40} disabled={disabled} />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button className="w-full" disabled={disabled || pending}>
        {pending ? <Loader2 size={18} className="animate-spin" /> : null}
        {pending ? "Criando…" : full ? "Limite do plano atingido" : "Criar e mostrar QR code"}
      </Button>
    </form>
  );
}

type Live = { status: Status; qrCode: string | null; phone: string | null; error?: string };

function QrSheet({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const r = await fetch(`/api/conexoes/${id}`, { cache: "no-store" });
        const j = (await r.json()) as Live;
        if (stop) return;
        if (!r.ok) setError(j.error ?? "Erro ao consultar a conexão.");
        else {
          setError(null);
          setLive(j);
          if (j.status === "open") {
            router.refresh();
            return;
          }
        }
      } catch {
        if (!stop) setError("Sem resposta do servidor. Tentando de novo…");
      }
      if (!stop) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, router]);

  const close = () => {
    router.refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Conectar ${name}`}
    >
      <div className="w-full max-w-[440px] rounded-t-[22px] bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-float md:rounded-[22px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold">Conectar {name}</h2>
            <p className="mt-1 text-[14px] text-ink-2">O código atualiza sozinho a cada poucos segundos.</p>
          </div>
          <button onClick={close} className="rounded-full bg-fill p-1.5 text-ink-2" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {live?.status === "open" ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-ok text-white">
              <Check size={30} />
            </span>
            <p className="text-[17px] font-semibold">WhatsApp conectado</p>
            {live.phone && <p className="mt-1 text-[15px] text-ink-2">{formatPhone(live.phone)}</p>}
            <Button className="mt-6 w-full" onClick={close}>
              Concluir
            </Button>
          </div>
        ) : (
          <>
            <div className="mx-auto flex h-[264px] w-[264px] items-center justify-center rounded-2xl bg-white p-3">
              {live?.qrCode ? (
                // biome-ignore lint/performance/noImgElement: imagem base64 gerada na hora
                <img src={live.qrCode} alt="QR code para conectar o WhatsApp" className="h-full w-full" />
              ) : (
                <Loader2 size={28} className="animate-spin text-ink-3" />
              )}
            </div>
            <ol className="mt-5 space-y-2 text-[15px] text-ink-2">
              <li>1. Abra o WhatsApp no celular do número que vai atender.</li>
              <li>2. Toque em Mais opções (ou Configurações) e depois em Aparelhos conectados.</li>
              <li>3. Toque em Conectar um aparelho e aponte a câmera para o código.</li>
            </ol>
            {error && (
              <div className="mt-4">
                <Notice>{error}</Notice>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
