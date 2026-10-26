import { editMessage } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  await editMessage(getDb(), getEvolution(), ctx.actor, ctx.organizationId, id, String(b.text ?? ""));
  return Response.json({ ok: true });
});
