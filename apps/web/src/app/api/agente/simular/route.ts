import { type ChatMessage, simulateAgent } from "@crm/core";
import { getDb } from "@crm/db";
import { getAi } from "@/lib/ai";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (req, ctx) => {
  const b = (await req.json().catch(() => ({}))) as {
    messages?: ChatMessage[];
    instructions?: string;
    model?: string;
  };
  const msgs = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  const r = await simulateAgent(getDb(), getAi(), ctx.actor, ctx.organizationId, {
    messages: msgs,
    instructions: typeof b.instructions === "string" ? b.instructions.slice(0, 60_000) : undefined,
    model: b.model,
  });
  return Response.json(r);
});
