import { AppError, uploadFlowMedia } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Sobe um arquivo (foto, vídeo, áudio, PDF) para usar num passo de fluxo. */
export const POST = withOrg(async (req, ctx) => {
  const fd = await req.formData();
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0) throw new AppError("validation", "Escolha o arquivo.");
  const r = await uploadFlowMedia(getDb(), ctx.actor, ctx.organizationId, {
    name: f.name || "arquivo",
    mime: f.type,
    data: Buffer.from(await f.arrayBuffer()),
  });
  return Response.json(r);
});
