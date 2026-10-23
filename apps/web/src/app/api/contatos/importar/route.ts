import { AppError, importContactsCsv } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (req, ctx) => {
  const fd = await req.formData();
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0)
    throw new AppError("validation", "Escolha um arquivo CSV.");
  if (f.size > 5 * 1024 * 1024) throw new AppError("validation", "Arquivo grande demais (máximo 5 MB).");
  const buf = Buffer.from(await f.arrayBuffer());
  // Excel em português costuma salvar em Windows-1252; se não for UTF-8 válido, converte.
  let text = buf.toString("utf8");
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
  const result = await importContactsCsv(getDb(), ctx.actor, ctx.organizationId, text, {
    brazil: fd.get("brazil") !== "false",
  });
  return Response.json(result);
});
