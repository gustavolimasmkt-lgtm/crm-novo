import { AppError, importDealsCsv } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withOrg(async (req, ctx) => {
  const fd = await req.formData();
  const f = fd.get("file");
  if (!f || typeof f === "string" || f.size === 0)
    throw new AppError("validation", "Escolha um arquivo CSV.");
  if (f.size > 10 * 1024 * 1024) throw new AppError("validation", "Arquivo grande demais (máximo 10 MB).");
  const buf = Buffer.from(await f.arrayBuffer());
  let text = buf.toString("utf8");
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
  return Response.json(await importDealsCsv(getDb(), ctx.actor, ctx.organizationId, text));
});
