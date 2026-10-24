import { AppError, deleteProductPhoto, getProductPhoto } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f-]{36}$/i;

export const GET = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  if (!uuid.test(id)) throw new AppError("not_found", "Foto não encontrada.");
  const ph = await getProductPhoto(getDb(), ctx.organizationId, id);
  return new Response(new Uint8Array(ph.data), {
    headers: {
      "content-type": ph.mime,
      "content-length": String(ph.data.length),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});

export const DELETE = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  if (!uuid.test(id)) throw new AppError("not_found", "Foto não encontrada.");
  await deleteProductPhoto(getDb(), ctx.actor, ctx.organizationId, id);
  return Response.json({ ok: true });
});
