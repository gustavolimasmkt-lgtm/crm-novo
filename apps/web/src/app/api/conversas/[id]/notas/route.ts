import { addNote } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Nota interna: só a equipe vê. */
export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  const noteId = await addNote(getDb(), ctx.actor, ctx.organizationId, id, String(b.text ?? ""));
  return Response.json({ id: noteId });
});
