import { AppError, MAX_MEDIA_BYTES, sendMessage } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

/** Envia mensagem: multipart com "text" e/ou "file". */
export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const fd = await req.formData();
  const text = typeof fd.get("text") === "string" ? (fd.get("text") as string) : undefined;
  const f = fd.get("file");
  let file: { name: string; mime: string; data: Buffer } | undefined;
  if (f && typeof f !== "string" && f.size > 0) {
    if (f.size > MAX_MEDIA_BYTES) throw new AppError("validation", "Arquivo grande demais (máximo 16 MB).");
    file = {
      name: f.name || "arquivo",
      mime: f.type || "application/octet-stream",
      data: Buffer.from(await f.arrayBuffer()),
    };
  }
  const messageId = await sendMessage(getDb(), getEvolution(), ctx.actor, ctx.organizationId, id, {
    text,
    file,
  });
  return Response.json({ id: messageId });
});
