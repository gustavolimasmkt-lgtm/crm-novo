import {
  deleteInactivityRule,
  listInactivityRules,
  previewInactivityRule,
  saveInactivityRule,
} from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg(async (_req, ctx) =>
  Response.json({ rules: await listInactivityRules(getDb(), ctx.organizationId) }),
);

type Body = {
  action?: "save" | "delete" | "preview";
  id?: string;
  rule?: Parameters<typeof saveInactivityRule>[3];
};

export const POST = withOrg(async (req, ctx) => {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  const db = getDb();
  if (b.action === "delete") {
    await deleteInactivityRule(db, ctx.actor, ctx.organizationId, String(b.id ?? ""));
    return Response.json({ ok: true });
  }
  const rule = (b.rule ?? {}) as Parameters<typeof saveInactivityRule>[3];
  if (b.action === "preview")
    return Response.json({ count: await previewInactivityRule(db, ctx.actor, ctx.organizationId, rule) });
  const id = await saveInactivityRule(db, ctx.actor, ctx.organizationId, rule, b.id || undefined);
  return Response.json({ id });
});
