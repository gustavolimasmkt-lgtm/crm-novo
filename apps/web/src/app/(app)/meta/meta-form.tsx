"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";
import { saveMetaAction } from "@/app/actions/meta";
import { Badge, Button, Field, Input, Notice } from "@/components/ui";
import type { FormState } from "@/lib/form";

type Settings = {
  capiEnabled: boolean;
  capiEnabledAt: string | null;
  datasetId: string;
  hasCapiToken: boolean;
  testEventCode: string;
  wabaId: string;
  sendLead: boolean;
  sendSchedule: boolean;
  sendPurchase: boolean;
  sendQualified: boolean;
  sendDisqualified: boolean;
  adAccountId: string;
  hasAdsToken: boolean;
};
const LABEL: Record<string, string> = {
  Lead: "Lead",
  Qualified: "Qualificado (botão)",
  Disqualified: "Desqualificado (botão)",
  Schedule: "Visita marcada",
  Purchase: "Venda",
};

export function MetaForm({
  settings,
  status,
  secretConfigured,
}: {
  settings: Settings;
  status: { counts: { eventName: string; status: string; n: number }[]; lastError: string | null };
  secretConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMetaAction, {});
  const [test, setTest] = useState<{ item: string; ok: boolean; detail: string }[] | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [backfill, setBackfill] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  async function runBackfill() {
    setBackfilling(true);
    setBackfill(null);
    try {
      const r = await fetch("/api/meta/reenviar", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falhou.");
      setBackfill(
        j.queued
          ? `${j.queued} evento(s) na fila. Saem em até alguns minutos; recarregue para ver o resultado.`
          : "Nada novo para enviar nos últimos 7 dias.",
      );
    } catch (e) {
      setBackfill((e as Error).message);
    } finally {
      setBackfilling(false);
    }
  }
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  async function runTest() {
    setTesting(true);
    setTestErr(null);
    setTest(null);
    try {
      const r = await fetch("/api/meta/testar", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falhou.");
      setTest(j.results);
    } catch (e) {
      setTestErr((e as Error).message);
    } finally {
      setTesting(false);
    }
  }
  const count = (ev: string, st: string) =>
    status.counts.find((c) => c.eventName === ev && c.status === st)?.n ?? 0;
  const box = "space-y-4 rounded-[var(--radius-card)] bg-surface p-5";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <form onSubmit={onSubmit} className="space-y-6">
        {!secretConfigured && (
          <Notice>
            Falta a variável APP_SECRET no servidor. Sem ela os tokens não podem ser guardados com segurança.
          </Notice>
        )}
        <section className={box}>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-[17px] font-semibold">API de Conversões</span>
              <span className="block text-[13px] text-ink-2">
                Envia para o pixel/conjunto de dados quando um lead entra, quando marca visita e quando
                compra. A Meta usa isso para achar mais gente parecida com quem compra.
              </span>
            </span>
            <input
              type="checkbox"
              name="capiEnabled"
              defaultChecked={settings.capiEnabled}
              aria-label="API de Conversões ligada"
              className="size-5 shrink-0 accent-[var(--accent)]"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID do conjunto de dados (pixel)" hint="Gerenciador de Eventos → Configurações">
              <Input name="datasetId" defaultValue={settings.datasetId} inputMode="numeric" />
            </Field>
            <Field
              label="Token de acesso da API de Conversões"
              hint={
                settings.hasCapiToken
                  ? "Já guardado. Deixe vazio para manter."
                  : "Gerado no Gerenciador de Eventos"
              }
            >
              <Input
                name="capiToken"
                type="password"
                autoComplete="off"
                placeholder={settings.hasCapiToken ? "••••••••" : ""}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4 text-[14px]">
            {[
              ["sendLead", "Lead (contato novo)", settings.sendLead],
              ["sendQualified", "Qualificado (botão)", settings.sendQualified],
              ["sendDisqualified", "Desqualificado (botão)", settings.sendDisqualified],
              ["sendSchedule", "Visita marcada", settings.sendSchedule],
              ["sendPurchase", "Venda (com valor)", settings.sendPurchase],
            ].map(([n, l, v]) => (
              <label key={String(n)} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={String(n)}
                  defaultChecked={Boolean(v)}
                  className="size-4 accent-[var(--accent)]"
                />
                {String(l)}
              </label>
            ))}
          </div>
          <details className="text-[14px]">
            <summary className="cursor-pointer font-medium text-accent">Avançado</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Código de teste" hint="Para ver os eventos na aba Testar eventos. Apague depois.">
                <Input name="testEventCode" defaultValue={settings.testEventCode} placeholder="TEST12345" />
              </Field>
              <Field
                label="ID da conta do WhatsApp Business (WABA)"
                hint="Só se o número tiver WABA. Usa o clique do anúncio (ctwa_clid)."
              >
                <Input name="wabaId" defaultValue={settings.wabaId} inputMode="numeric" />
              </Field>
            </div>
          </details>
        </section>

        <section className={box}>
          <div>
            <h2 className="text-[17px] font-semibold">Conta de anúncios (leitura)</h2>
            <p className="text-[13px] text-ink-2">
              Traz o nome das campanhas e o gasto para a tela Anúncios calcular custo por lead, por venda e o
              retorno. Precisa de um token com permissão ads_read.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID da conta de anúncios" hint="Ex.: act_123456789">
              <Input
                name="adAccountId"
                defaultValue={settings.adAccountId ? `act_${settings.adAccountId}` : ""}
              />
            </Field>
            <Field
              label="Token de leitura de anúncios"
              hint={
                settings.hasAdsToken
                  ? "Já guardado. Deixe vazio para manter."
                  : "Usuário do sistema no Gerenciador de Negócios"
              }
            >
              <Input
                name="adsToken"
                type="password"
                autoComplete="off"
                placeholder={settings.hasAdsToken ? "••••••••" : ""}
              />
            </Field>
          </div>
          {settings.hasAdsToken && (
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" name="removeAdsToken" className="size-4" /> Remover token de leitura
            </label>
          )}
        </section>

        {state.error && <Notice>{state.error}</Notice>}
        {state.ok && <Notice tone="ok">{state.message}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar"}
          </Button>
          <Button type="button" variant="secondary" disabled={testing} onClick={runTest}>
            {testing ? "Testando..." : "Testar conexão"}
          </Button>
        </div>
        {testErr && <Notice>{testErr}</Notice>}
        {test && (
          <ul className="space-y-1.5" data-testid="teste-meta">
            {test.map((t) => (
              <li key={t.item} className="flex items-center gap-2 text-[14px]">
                <Badge tone={t.ok ? "ok" : "danger"}>{t.ok ? "OK" : "Erro"}</Badge>
                <span className="font-medium">{t.item}:</span> <span className="text-ink-2">{t.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </form>

      <aside
        className="h-fit space-y-3 rounded-[var(--radius-card)] bg-surface p-5"
        data-testid="status-capi"
      >
        <h2 className="text-[16px] font-semibold">Eventos enviados (30 dias)</h2>
        {["Lead", "Qualified", "Disqualified", "Schedule", "Purchase"].map((ev) => (
          <div key={ev} className="flex items-center justify-between text-[14px]">
            <span>{LABEL[ev]}</span>
            <span className="tabular-nums text-ink-2">
              {count(ev, "sent")} enviados
              {count(ev, "pending") ? ` · ${count(ev, "pending")} na fila` : ""}
              {count(ev, "failed") ? ` · ${count(ev, "failed")} com erro` : ""}
            </span>
          </div>
        ))}
        {status.lastError && <p className="text-[13px] text-danger">Último erro: {status.lastError}</p>}
        {settings.capiEnabled && (
          <div className="space-y-1.5 border-t border-separator pt-3">
            <Button size="sm" variant="secondary" onClick={runBackfill} disabled={backfilling}>
              {backfilling ? "Enviando…" : "Enviar também os últimos 7 dias"}
            </Button>
            <p className="text-[12px] text-ink-3">
              Leads, visitas e vendas dos últimos 7 dias que ainda não foram. A Meta não aceita mais antigos.
            </p>
            {backfill && (
              <p className="text-[13px]" data-testid="reenvio">
                {backfill}
              </p>
            )}
          </div>
        )}
        <p className="text-[12px] text-ink-3">
          Só entram negociações criadas ou movidas depois que a API foi ligada. O telefone vai em hash
          (SHA-256), nunca em texto.
        </p>
        <p className="text-[12px] text-ink-3">
          Qualificado e desqualificado saem 5 minutos depois do clique na negociação, para dar tempo de
          desfazer. Qualificado vai como QualifiedLead; desqualificado vai como evento personalizado
          DisqualifiedLead (use para excluir públicos).
        </p>
      </aside>
    </div>
  );
}
