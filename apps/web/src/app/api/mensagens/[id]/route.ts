import { deleteMessage } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

/** Apaga para todos. */
export const DELETE = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  await deleteMessage(getDb(), getEvolution(), ctx.actor, ctx.organizationId, id);
  return Response.json({ ok: true });
});
