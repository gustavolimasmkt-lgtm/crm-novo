"use client";

import { Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { toBrInput } from "@/lib/format";

type Item = { id: string; body: string; sendAt: string; createdByName: string | null };
const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Não deu certo.");
  return j;
}

/** Mensagens agendadas da negociação (na conversa de WhatsApp do cliente): ver, criar, editar e cancelar. */
export function DealSchedule({ conversationId }: { conversationId: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      setItems(((await call(`/api/conversas/${conversationId}/agendar`, "GET")) as { items: Item[] }).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [conversationId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!conversationId)
    return (
      <section className="rounded-[var(--radius-card)] bg-surface p-4 text-[14px] text-ink-2">
        <h3 className="mb-1 text-[13px] font-medium uppercase tracking-wide text-ink-3">
          Mensagens agendadas
        </h3>
        Esse cliente ainda não tem conversa no WhatsApp. Comece pela tela Conversas.
      </section>
    );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editId) await call(`/api/agendadas/${editId}`, "PATCH", { text, sendAt: at });
      else await call(`/api/conversas/${conversationId}/agendar`, "POST", { text, sendAt: at });
      setText("");
      setAt("");
      setEditId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-[var(--radius-card)] bg-surface p-4"
      data-testid="agendar-negociacao"
    >
      <h3 className="text-[13px] font-medium uppercase tracking-wide text-ink-3">Mensagens agendadas</h3>
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-2 rounded-xl bg-fill px-3 py-2 text-[14px]">
              <Clock size={15} className="mt-0.5 shrink-0 text-ink-2" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{fmt.format(new Date(i.sendAt))}</p>
                <p className="line-clamp-2 text-ink-2">{i.body}</p>
              </div>
              <button
                type="button"
                className="shrink-0 text-[13px] font-semibold text-accent"
                onClick={() => {
                  setEditId(i.id);
                  setText(i.body);
                  setAt(toBrInput(i.sendAt));
                }}
              >
                Editar
              </button>
              <button
                type="button"
                className="shrink-0 text-[13px] font-semibold text-danger"
                onClick={async () => {
                  await call(`/api/agendadas/${i.id}`, "DELETE").catch((e) => setError(e.message));
                  if (editId === i.id) {
                    setEditId(null);
                    setText("");
                    setAt("");
                  }
                  load();
                }}
              >
                Cancelar
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label="Mensagem para agendar"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Ex.: #periodo-dia! Conseguiu ver as fotos do carro?"
        className="w-full rounded-xl bg-fill px-3.5 py-2.5 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="datetime-local"
          aria-label="Enviar em"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          className="h-10 rounded-xl bg-fill px-3 text-[15px]"
        />
        <Button size="sm" disabled={busy || !text.trim() || !at} onClick={save}>
          {editId ? "Salvar alteração" : "Agendar"}
        </Button>
        {editId && (
          <Button
            size="sm"
            variant="plain"
            onClick={() => {
              setEditId(null);
              setText("");
              setAt("");
            }}
          >
            Voltar
          </Button>
        )}
      </div>
      <p className="text-[12px] text-ink-3">
        Sai pelo WhatsApp em seu nome. #periodo-dia vira bom dia, boa tarde ou boa noite na hora do envio.
      </p>
      {error && <Notice>{error}</Notice>}
    </section>
  );
}
