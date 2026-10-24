import { AppError, importCatalog } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Importa o catálogo do sistema antigo (.json do agente) ou um CSV titulo;descricao;valor. */
export const POST = withOrg(async (req, ctx) => {
  const fd = await req.formData();
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0) throw new AppError("validation", "Escolha o arquivo.");
  if (f.size > 5 * 1024 * 1024) throw new AppError("validation", "Arquivo grande demais (máximo 5 MB).");
  return Response.json(await importCatalog(getDb(), ctx.actor, ctx.organizationId, await f.text()));
});
