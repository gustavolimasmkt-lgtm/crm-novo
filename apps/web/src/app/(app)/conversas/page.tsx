import {
  can,
  getAgent,
  listAssignableUsers,
  listConversations,
  listFlows,
  listQuickReplies,
  listUsableConnections,
} from "@crm/core";
import { getDb } from "@crm/db";
import { requireOrg } from "@/lib/session";
import { Inbox } from "./inbox";

export const metadata = { title: "Conversas" };
export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireOrg();
  const db = getDb();
  const [initial, connections, people, agent, quickReplies, flowList] = await Promise.all([
    listConversations(db, ctx.actor, ctx.organization.id, { filter: "open" }),
    listUsableConnections(db, ctx.organization.id),
    listAssignableUsers(db, ctx.organization.id),
    getAgent(db, ctx.organization.id),
    listQuickReplies(db, ctx.organization.id),
    listFlows(db, ctx.organization.id),
  ]);
  const { c } = await searchParams;
  return (
    <Inbox
      initial={JSON.parse(JSON.stringify(initial))}
      initialSelected={c ?? null}
      connections={connections}
      people={people}
      me={{ id: ctx.user.id, name: ctx.user.name }}
      canViewAll={can(ctx.actor, "conversations.view_all")}
      canManageConnections={can(ctx.actor, "connections.manage")}
      agentActive={Boolean(agent?.active)}
      quickReplies={quickReplies}
      sttEnabled={Boolean(process.env.TRANSCRIBE_API_KEY)}
      aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
      flows={flowList.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name }))}
    />
  );
}
