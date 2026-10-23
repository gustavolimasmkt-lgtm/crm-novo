import { AppError, can, parseLegacyAgentExport } from "@crm/core";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Lê o arquivo do agente do sistema antigo e devolve os campos para preencher o formulário (não salva). */
export const POST = withOrg(async (req, ctx) => {
  if (!can(ctx.actor, "settings.manage")) throw new AppError("forbidden", "Sem permissão.");
  const fd = await req.formData();
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0)
    throw new AppError("validation", "Escolha o arquivo .json do agente.");
  if (f.size > 2 * 1024 * 1024) throw new AppError("validation", "Arquivo grande demais.");
  return Response.json(parseLegacyAgentExport(await f.text()));
});
