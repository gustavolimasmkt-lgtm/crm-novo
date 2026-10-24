import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  DEFAULT_HANDOFF,
  getAgent,
  getAiUsage,
  getRotation,
  getScheduleSettings,
  listProducts,
  listUsableConnections,
  TOKENS_PER_CREDIT,
} from "@crm/core";
import { getDb } from "@crm/db";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { AgentForm } from "./agent-form";

export const metadata = { title: "Agente de IA" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const ctx = await requirePermission("settings.manage");
  const db = getDb();
  const [agent, usage, connections, items, schedule, rotation] = await Promise.all([
    getAgent(db, ctx.organization.id),
    getAiUsage(db, ctx.organization.id),
    listUsableConnections(db, ctx.organization.id),
    listProducts(db, ctx.organization.id, { onlyActive: true }),
    getScheduleSettings(db, ctx.organization.id),
    getRotation(db, ctx.organization.id),
  ]);
  const tools = [
    {
      href: "/catalogo",
      label: "Catálogo",
      on: items.length > 0,
      text: items.length
        ? `${items.length} itens: busca e envia fotos`
        : "vazio: o agente não fala de estoque",
    },
    {
      href: "/agenda",
      label: "Agenda",
      on: schedule.aiCanBook,
      text: schedule.aiCanBook ? "marca visitas sozinho" : "desligada: o agente transfere para marcar",
    },
    {
      href: "/equipe",
      label: "Rodízio",
      on: rotation.enabled,
      text: rotation.enabled ? "leads distribuídos e avisos" : "desligado",
    },
  ];
  return (
    <>
      <PageHeader title="Agente de IA" subtitle="Responde no WhatsApp com base nas suas instruções" />
      <div className="mb-6 grid gap-2 sm:grid-cols-3" data-testid="ferramentas-agente">
        {tools.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface px-4 py-3 hover:brightness-[0.98]"
          >
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{t.label}</span>
              <span className="block truncate text-[13px] text-ink-2">{t.text}</span>
            </span>
            <Badge tone={t.on ? "ok" : "neutral"}>{t.on ? "Ligado" : "Desligado"}</Badge>
          </Link>
        ))}
      </div>
      <AgentForm
        agent={{
          name: agent?.name ?? "Assistente",
          active: agent?.active ?? false,
          connectionId: agent?.connectionId ?? "",
          model: agent?.model ?? DEFAULT_AI_MODEL,
          instructions: agent?.instructions ?? "",
          replyDelaySeconds: agent?.replyDelaySeconds ?? 15,
          historyMessages: agent?.historyMessages ?? 20,
          handoffMessage: agent?.handoffMessage ?? "",
        }}
        models={AI_MODELS.map((m) => ({ id: m.id, label: m.label }))}
        connections={connections.map((c) => ({ id: c.id, name: c.name }))}
        usage={usage}
        tokensPerCredit={TOKENS_PER_CREDIT}
        defaultHandoff={DEFAULT_HANDOFF}
        keyConfigured={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </>
  );
}
