import { type ConversationFilter, listConversations } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";
const FILTERS: ConversationFilter[] = ["open", "unread", "closed", "all", "mine"];

export const GET = withOrg(async (req, ctx) => {
  const u = new URL(req.url);
  const f = u.searchParams.get("filter") as ConversationFilter | null;
  const list = await listConversations(getDb(), ctx.actor, ctx.organizationId, {
    filter: f && FILTERS.includes(f) ? f : "open",
    q: u.searchParams.get("q") ?? undefined,
  });
  return Response.json(list, { headers: { "cache-control": "no-store" } });
});
