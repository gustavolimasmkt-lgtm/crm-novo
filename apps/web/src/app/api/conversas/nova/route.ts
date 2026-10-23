import { startConversation } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (req, ctx) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = await startConversation(getDb(), getEvolution(), ctx.actor, ctx.organizationId, {
    connectionId: String(b.connectionId ?? ""),
    phone: String(b.phone ?? ""),
    brazil: b.brazil !== false,
    landline: b.landline === true,
  });
  return Response.json({ id });
});
