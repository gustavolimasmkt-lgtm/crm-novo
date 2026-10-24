import { AppError, deleteProduct } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const DELETE = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "Produto não encontrado.");
  await deleteProduct(getDb(), ctx.actor, ctx.organizationId, id);
  return Response.json({ ok: true });
});
