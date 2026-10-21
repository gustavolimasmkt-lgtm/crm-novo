"use client";

import {
  ArrowLeft,
  AtSign,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flame,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, cx } from "@/components/ui";
import { brl, CONVERSATIONS, DEALS, type Deal, STAGES, THREAD } from "./data";

const TABS = ["Conversas", "CRM", "Negociação", "Dashboard"] as const;
type Tab = (typeof TABS)[number];

export function Preview() {
  const [tab, setTab] = useState<Tab>("Conversas");
  return (
    <div>
      <Segmented value={tab} options={TABS} onChange={setTab} />
      <div className="mt-6">
        {tab === "Conversas" && <ConversationsPreview />}
        {tab === "CRM" && <KanbanPreview onOpen={() => setTab("Negociação")} />}
        {tab === "Negociação" && <DealPreview />}
        {tab === "Dashboard" && <DashboardPreview />}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-fill p-0.5 scrollbar-none"
    >
      {options.map((o) => (
        <button
          key={o}
          role="tab"
          aria-selected={value === o}
          onClick={() => onChange(o)}
          className={cx(
            "h-8 whitespace-nowrap rounded-[8px] px-4 text-[13px] font-medium transition-all",
            value === o ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  return channel === "instagram" ? (
    <AtSign size={13} className="text-[#d62976]" aria-label="Instagram" />
  ) : (
    <MessageCircle size={13} className="text-ok" aria-label="WhatsApp" />
  );
}

/* ---------------- Conversas ---------------- */
function ConversationsPreview() {
  const [open, setOpen] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="overflow-hidden rounded-[20px] bg-surface md:grid md:h-[640px] md:grid-cols-[300px_1fr] lg:grid-cols-[300px_1fr_290px]">
      {/* Lista */}
      <section className={cx("flex flex-col border-separator md:border-r", open && "hidden md:flex")}>
        <div className="space-y-3 p-4 pb-2">
          <div className="flex h-9 items-center gap-2 rounded-[10px] bg-fill px-3 text-ink-3">
            <Search size={16} />
            <span className="text-[15px]">Buscar</span>
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {["Abertas", "Não lidas", "Minhas", "Com IA"].map((f, i) => (
              <span
                key={f}
                className={cx(
                  "h-7 whitespace-nowrap rounded-full px-3 text-[13px] font-medium leading-7",
                  i === 0 ? "bg-ink text-surface" : "bg-fill text-ink-2",
                )}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {CONVERSATIONS.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setOpen(c.id)}
                className={cx(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  (open ?? "1") === c.id ? "md:bg-accent-soft" : "hover:bg-fill/50",
                )}
              >
                <Avatar name={c.name} size={44} />
                <div className="min-w-0 flex-1 border-b border-separator pb-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold">{c.name}</span>
                    <span
                      className={cx("text-[12px]", c.unread ? "font-semibold text-accent" : "text-ink-3")}
                    >
                      {c.time}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <ChannelIcon channel={c.channel} />
                    <span className="truncate text-[14px] text-ink-2">{c.last}</span>
                    {c.unread > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Conversa */}
      <section className={cx("flex min-h-[560px] flex-col", !open && "hidden md:flex")}>
        <header className="material flex h-14 items-center gap-3 border-b border-separator px-3">
          <button
            onClick={() => setOpen(null)}
            className="rounded-full p-1.5 text-accent md:hidden"
            aria-label="Voltar"
          >
            <ArrowLeft size={20} />
          </button>
          <Avatar name="Mariana Costa" size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">Mariana Costa</p>
            <p className="truncate text-[12px] text-ink-2">Novo lead · Ana Prado</p>
          </div>
          <span className="hidden sm:inline-flex">
            <Badge tone="accent">
              <Bot size={12} className="mr-1" /> IA ativa
            </Badge>
          </span>
          <button className="rounded-full p-2 text-ink-2 hover:bg-fill" aria-label="Ligar">
            <Phone size={18} />
          </button>
          <button
            onClick={() => setShowInfo((s) => !s)}
            className="rounded-full p-2 text-ink-2 hover:bg-fill lg:hidden"
            aria-label="Detalhes"
          >
            <MoreHorizontal size={18} />
          </button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto bg-bg/60 px-4 py-5">
          {THREAD.map((m, i) =>
            m.from === "event" ? (
              <p key={i} className="py-1 text-center text-[12px] text-ink-3">
                {m.text} · {m.time}
              </p>
            ) : (
              <div key={i} className={cx("flex", m.from === "lead" ? "justify-start" : "justify-end")}>
                <div
                  className={cx(
                    "max-w-[78%] rounded-[20px] px-3.5 py-2 text-[15px] leading-[1.35]",
                    m.from === "lead" && "rounded-bl-[6px] bg-surface",
                    m.from === "me" && "rounded-br-[6px] bg-accent text-white",
                    m.from === "ai" && "rounded-br-[6px] bg-[#5856d6]/12 text-ink",
                  )}
                >
                  {m.from === "ai" && (
                    <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#5856d6]">
                      <Sparkles size={11} /> Agente de IA
                    </span>
                  )}
                  {m.text}
                  <span className={cx("ml-2 text-[11px]", m.from === "me" ? "text-white/70" : "text-ink-3")}>
                    {m.time}
                  </span>
                </div>
              </div>
            ),
          )}
        </div>
        <footer className="flex items-center gap-2 border-t border-separator p-3">
          <button className="rounded-full p-2 text-ink-2 hover:bg-fill" aria-label="Anexar">
            <Paperclip size={20} />
          </button>
          <div className="flex h-10 flex-1 items-center rounded-full border border-separator px-4 text-[15px] text-ink-3">
            Mensagem ou / para ações
          </div>
          <button className="rounded-full p-2 text-ink-2 hover:bg-fill" aria-label="Gravar áudio">
            <Mic size={20} />
          </button>
        </footer>
      </section>

      {/* Painel do lead */}
      <aside
        className={cx(
          "overflow-y-auto border-l border-separator bg-surface-2 p-4",
          showInfo ? "block" : "hidden lg:block",
        )}
      >
        <div className="flex flex-col items-center py-3 text-center">
          <Avatar name="Mariana Costa" size={64} />
          <p className="mt-2 text-[17px] font-semibold">Mariana Costa</p>
          <p className="text-[13px] text-ink-2">+55 48 9xxxx-0000</p>
        </div>
        <InfoGroup
          rows={[
            ["Etapa", "Novo lead"],
            ["Responsável", "Ana Prado"],
            ["Valor", brl(88900)],
            ["Origem", "Anúncio · SUV 2021"],
          ]}
        />
        <p className="mb-2 mt-5 px-1 text-[12px] font-medium uppercase tracking-wide text-ink-3">
          Resumo da IA
        </p>
        <p className="rounded-xl bg-surface p-3 text-[13px] leading-relaxed text-ink-2">
          Quer SUV compacto, financiado, com carro na troca. Aguardando simulação.
        </p>
        <p className="mb-2 mt-5 px-1 text-[12px] font-medium uppercase tracking-wide text-ink-3">
          Próximo passo
        </p>
        <div className="flex items-center gap-2 rounded-xl bg-surface p-3 text-[13px]">
          <Clock size={15} className="text-warn" /> Enviar simulação · hoje 14:00
        </div>
      </aside>
    </div>
  );
}

function InfoGroup({ rows }: { rows: [string, string][] }) {
  return (
    <div className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[14px]">
          <span className="text-ink-2">{k}</span>
          <span className="truncate font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- CRM (Kanban) ---------------- */
function KanbanPreview({ onOpen }: { onOpen: () => void }) {
  const [view, setView] = useState<"Kanban" | "Lista">("Kanban");
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented value={view} options={["Kanban", "Lista"] as const} onChange={setView} />
        <div className="ml-auto flex items-center gap-2">
          <button className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-[13px] font-medium">
            <SlidersHorizontal size={14} /> Filtros
          </button>
          <button className="inline-flex h-8 items-center rounded-full bg-accent px-3.5 text-[13px] font-medium text-white">
            Nova negociação
          </button>
        </div>
      </div>
      {view === "Kanban" ? (
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 scrollbar-none md:mx-0 md:px-0">
          {STAGES.map((s) => {
            const deals = DEALS.filter((d) => d.stage === s.id);
            const total = deals.reduce((a, d) => a + d.value, 0);
            return (
              <section key={s.id} className="w-[85vw] shrink-0 snap-start sm:w-[280px]">
                <header className="mb-2 flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <h3 className="text-[15px] font-semibold">{s.name}</h3>
                  <span className="text-[13px] text-ink-3">{deals.length}</span>
                  <span className="ml-auto text-[13px] text-ink-2">{brl(total)}</span>
                </header>
                <div className="space-y-2 rounded-[18px] bg-fill/50 p-2">
                  {deals.map((d) => (
                    <DealCard key={d.id} deal={d} onClick={onOpen} />
                  ))}
                  {deals.length === 0 && (
                    <p className="py-6 text-center text-[13px] text-ink-3">Nenhuma negociação</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[18px] bg-surface">
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-wide text-ink-3">
              <tr className="border-b border-separator">
                <th className="px-4 py-3 font-medium">Negociação</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Etapa</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Responsável</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {DEALS.map((d) => (
                <tr
                  key={d.id}
                  onClick={onOpen}
                  className="cursor-pointer border-b border-separator last:border-0 hover:bg-fill/50"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-[13px] text-ink-2">{d.interest}</p>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {STAGES.find((s) => s.id === d.stage)?.name}
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">{d.owner}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{brl(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DealCard({ deal, onClick }: { deal: Deal; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[14px] bg-surface p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition hover:shadow-float"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold leading-tight">{deal.name}</p>
        {deal.hot && <Flame size={15} className="shrink-0 text-warn" aria-label="Lead quente" />}
      </div>
      <p className="mt-0.5 text-[13px] text-ink-2">{deal.interest}</p>
      <p className="mt-2 text-[17px] font-semibold tabular-nums">{brl(deal.value)}</p>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
        <Avatar name={deal.owner} size={20} />
        <span className="truncate">{deal.owner.split(" ")[0]}</span>
        <ChannelIcon channel={deal.channel} />
        {deal.ai && <Bot size={13} className="text-[#5856d6]" aria-label="IA ativa" />}
        <span className="ml-auto">{deal.days === 0 ? "hoje" : `${deal.days}d na etapa`}</span>
      </div>
    </button>
  );
}

/* ---------------- Negociação ---------------- */
function DealPreview() {
  const current = 3;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div className="rounded-[20px] bg-surface p-5">
          <div className="flex flex-wrap items-start gap-4">
            <Avatar name="Lucas Martins" size={56} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink-3">Negociação #1042</p>
              <h2 className="title-2">Lucas Martins</h2>
              <p className="text-[15px] text-ink-2">SUV 7 lugares · Carlos Dias</p>
            </div>
            <div className="text-right">
              <p className="text-[13px] text-ink-3">Valor</p>
              <p className="text-[28px] font-semibold tabular-nums leading-tight">{brl(154000)}</p>
            </div>
          </div>
          {/* Etapas */}
          <ol className="mt-5 flex gap-1" aria-label="Etapas do funil">
            {STAGES.map((s, i) => (
              <li key={s.id} className="flex-1">
                <span
                  className={cx("block h-1.5 rounded-full", i <= current ? "" : "bg-fill")}
                  style={i <= current ? { background: s.color } : undefined}
                />
                <span
                  className={cx(
                    "mt-1.5 hidden text-[11px] sm:block",
                    i === current ? "font-semibold text-ink" : "text-ink-3",
                  )}
                >
                  {s.name}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-medium text-white">
              <MessageCircle size={15} /> Conversa
            </button>
            <button className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-4 text-[14px] font-medium">
              <Phone size={15} /> Ligar
            </button>
            <button className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ok-soft px-4 text-[14px] font-medium text-ok">
              <CheckCircle2 size={15} /> Marcar como ganha
            </button>
          </div>
        </div>

        <div className="rounded-[20px] bg-surface p-5">
          <h3 className="mb-4 text-[17px] font-semibold">Atividade</h3>
          <ol className="relative space-y-5 border-l border-separator pl-5">
            {[
              ["Visita agendada para sábado, 10h", "Ontem 17:40", "Agenda"],
              ["Proposta de financiamento enviada", "Ontem 15:12", "Carlos Dias"],
              ["Mudou para Visita agendada", "Ontem 15:10", "Agente de IA"],
              ["Lead chegou pelo anúncio · SUV 7 lugares", "seg. 10:02", "Meta Ads"],
            ].map(([t, when, who]) => (
              <li key={t}>
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                <p className="text-[15px]">{t}</p>
                <p className="text-[13px] text-ink-3">
                  {when} · {who}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="space-y-6">
        <section>
          <p className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wide text-ink-3">Informações</p>
          <InfoGroup
            rows={[
              ["Fonte", "Meta Ads"],
              ["Campanha", "SUV 7 lugares"],
              ["WhatsApp", "Loja principal"],
              ["Nota da IA", "82 · Excelente"],
            ]}
          />
        </section>
        <section>
          <p className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wide text-ink-3">
            Agenda e tarefas
          </p>
          <div className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
            {[
              [<Calendar key="c" size={16} className="text-warn" />, "Visita na loja", "sáb. 10:00"],
              [<CheckCircle2 key="t" size={16} className="text-accent" />, "Separar laudo do carro", "sex."],
            ].map(([icon, t, when], i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 text-[14px]">
                {icon}
                <span className="flex-1">{t}</span>
                <span className="text-ink-3">{when}</span>
                <ChevronRight size={16} className="text-ink-3" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function DashboardPreview() {
  const kpis = [
    { label: "Receita ganha", value: brl(657750), delta: "+12%", spark: [3, 5, 4, 6, 7, 6, 9] },
    { label: "Em aberto", value: brl(604350), delta: "+4%", spark: [6, 6, 7, 6, 8, 7, 8] },
    { label: "Ticket médio", value: brl(82218), delta: "−2%", spark: [8, 7, 8, 7, 7, 6, 7] },
    { label: "Conversão", value: "8,4%", delta: "+1,1 pt", spark: [4, 5, 5, 6, 6, 7, 8] },
  ];
  const funnel = [
    ["Novo lead", 232],
    ["Em atendimento", 118],
    ["Qualificado", 64],
    ["Visita agendada", 31],
    ["Venda ganha", 19],
  ] as const;
  const max = funnel[0][1];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-[18px] bg-surface p-4">
            <p className="text-[13px] text-ink-2">{k.label}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums sm:text-[26px]">{k.value}</p>
            <div className="mt-2 flex items-end justify-between">
              <span
                className={cx("text-[12px] font-medium", k.delta.startsWith("−") ? "text-danger" : "text-ok")}
              >
                {k.delta}
              </span>
              <Sparkline values={k.spark} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[18px] bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-accent" />
            <h3 className="text-[17px] font-semibold">Funil do período</h3>
          </div>
          <div className="space-y-3">
            {funnel.map(([name, n], i) => (
              <div key={name}>
                <div className="mb-1 flex justify-between text-[14px]">
                  <span>{name}</span>
                  <span className="tabular-nums text-ink-2">
                    {n}
                    {i > 0 && (
                      <span className="ml-2 text-ink-3">
                        {Math.round((n / (funnel[i - 1]?.[1] ?? n)) * 100)}%
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-fill">
                  <div
                    className="h-2.5 rounded-full bg-accent"
                    style={{ width: `${(n / max) * 100}%`, opacity: 1 - i * 0.13 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[18px] bg-surface p-5">
          <h3 className="mb-4 text-[17px] font-semibold">Melhores vendedores</h3>
          <ul className="divide-y divide-separator">
            {[
              ["Ana Prado", 6, 418400],
              ["Carlos Dias", 4, 179900],
              ["Bruno Lemos", 3, 59450],
            ].map(([n, w, v]) => (
              <li key={n as string} className="flex items-center gap-3 py-2.5">
                <Avatar name={n as string} size={32} />
                <span className="flex-1 text-[15px]">{n}</span>
                <span className="text-[13px] text-ink-3">{w} vendas</span>
                <span className="w-24 text-right text-[14px] font-medium tabular-nums">
                  {brl(v as number)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl bg-fill/60 p-3 text-[13px] text-ink-2">
            Primeira resposta humana: <strong className="text-ink">6 min</strong> (mediana) · 68% dentro da
            meta
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 72;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
