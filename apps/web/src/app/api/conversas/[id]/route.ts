import {
  getConversation,
  getOpenDealForContact,
  listContactRuns,
  listMessages,
  listScheduled,
} from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const before = new URL(req.url).searchParams.get("before");
  const db = getDb();
  const conversation = await getConversation(db, ctx.actor, ctx.organizationId, id);
  const items = await listMessages(db, ctx.actor, ctx.organizationId, id, {
    before: before ? new Date(before) : undefined,
  });
  const deal = await getOpenDealForContact(db, ctx.actor, ctx.organizationId, conversation.contactId);
  const scheduled = await listScheduled(db, ctx.actor, ctx.organizationId, id);
  const runs = await listContactRuns(db, ctx.organizationId, conversation.contactId);
  return Response.json(
    { conversation, messages: items, deal, scheduled, runs },
    { headers: { "cache-control": "no-store" } },
  );
});
