import { createDeal, parseMoneyToCents } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withOrg(async (req, ctx) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, string | null | undefined>;
  const id = await createDeal(getDb(), ctx.actor, ctx.organizationId, {
    contactId: b.contactId || undefined,
    phone: b.phone || undefined,
    contactName: b.contactName || undefined,
    title: b.title || undefined,
    valueCents: parseMoneyToCents(b.value ?? ""),
    stageId: b.stageId || undefined,
    assignedUserId: b.assignedUserId === undefined ? undefined : b.assignedUserId || null,
    sourceId: b.sourceId || null,
    description: b.description || undefined,
  });
  return Response.json({ id });
});
