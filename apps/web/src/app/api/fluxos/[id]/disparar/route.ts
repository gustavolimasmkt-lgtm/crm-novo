import { dispatchFlow } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Disparo do fluxo para um público (etapas, etiquetas, sem conversa há X dias). */
export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as Parameters<typeof dispatchFlow>[4];
  return Response.json(await dispatchFlow(getDb(), ctx.actor, ctx.organizationId, id, b));
});
