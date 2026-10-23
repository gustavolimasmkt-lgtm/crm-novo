import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  DEFAULT_HANDOFF,
  getAgent,
  getAiUsage,
  listUsableConnections,
  TOKENS_PER_CREDIT,
} from "@crm/core";
import { getDb } from "@crm/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { AgentForm } from "./agent-form";

export const metadata = { title: "Agente de IA" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const ctx = await requirePermission("settings.manage");
  const db = getDb();
  const [agent, usage, connections] = await Promise.all([
    getAgent(db, ctx.organization.id),
    getAiUsage(db, ctx.organization.id),
    listUsableConnections(db, ctx.organization.id),
  ]);
  return (
    <>
      <PageHeader title="Agente de IA" subtitle="Responde no WhatsApp com base nas suas instruções" />
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
