import { AppError, cancelScheduled, updateScheduled } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const DELETE = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  await cancelScheduled(getDb(), ctx.actor, ctx.organizationId, id);
  return Response.json({ ok: true });
});

/** Edita texto e horário. sendAt: "AAAA-MM-DDTHH:MM" no horário de Brasília. */
export const PATCH = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { text?: string; sendAt?: string };
  const m = String(b.sendAt ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) throw new AppError("validation", "Escolha dia e hora.");
  await updateScheduled(getDb(), ctx.actor, ctx.organizationId, id, {
    text: String(b.text ?? ""),
    sendAt: new Date(`${m[1]}T${m[2]}:00-03:00`),
  });
  return Response.json({ ok: true });
});
