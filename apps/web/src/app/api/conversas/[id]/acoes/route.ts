import {
  assignConversation,
  markConversationRead,
  renameContact,
  setConversationAi,
  setConversationStatus,
} from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

type Body = { action?: string; userId?: string | null; name?: string };

export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  const db = getDb();
  switch (b.action) {
    case "read":
      await markConversationRead(db, ctx.actor, ctx.organizationId, id);
      break;
    case "close":
    case "open":
      await setConversationStatus(
        db,
        ctx.actor,
        ctx.organizationId,
        id,
        b.action === "close" ? "closed" : "open",
      );
      break;
    case "take":
      await assignConversation(db, ctx.actor, ctx.organizationId, id, ctx.actor.userId);
      break;
    case "assign":
      await assignConversation(db, ctx.actor, ctx.organizationId, id, b.userId ?? null);
      break;
    case "ai_on":
    case "ai_off":
      await setConversationAi(db, ctx.actor, ctx.organizationId, id, b.action === "ai_on");
      break;
    case "rename":
      await renameContact(db, ctx.actor, ctx.organizationId, id, b.name ?? "");
      break;
    default:
      return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  }
  return Response.json({ ok: true });
});
