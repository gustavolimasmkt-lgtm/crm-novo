import { AppError, scheduleMessage } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Agenda mensagem. sendAt: "AAAA-MM-DDTHH:MM" no horário de Brasília. */
export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { text?: string; sendAt?: string };
  const m = String(b.sendAt ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) throw new AppError("validation", "Escolha dia e hora.");
  const sendAt = new Date(`${m[1]}T${m[2]}:00-03:00`);
  const sid = await scheduleMessage(getDb(), ctx.actor, ctx.organizationId, id, {
    text: String(b.text ?? ""),
    sendAt,
  });
  return Response.json({ id: sid });
});
