import { processFlows, startFlow } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { conversationId?: string };
  const runId = await startFlow(getDb(), ctx.actor, ctx.organizationId, id, String(b.conversationId ?? ""));
  // Enviado na conversa: começa na hora (sem esperar o ciclo do servidor).
  void processFlows(getDb(), getEvolution(), { runId }).catch((e) => console.error("[fluxo manual]", e));
  return Response.json({ id: runId });
});
