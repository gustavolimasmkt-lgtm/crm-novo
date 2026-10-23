import {
  addDealNote,
  assignDeal,
  deleteDeal,
  getDeal,
  moveDeal,
  parseMoneyToCents,
  setDealTags,
  updateDeal,
} from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  return Response.json(await getDeal(getDb(), ctx.actor, ctx.organizationId, id), {
    headers: { "cache-control": "no-store" },
  });
});

type Body = {
  action?: string;
  stageId?: string;
  userId?: string | null;
  text?: string;
  tags?: string[];
  title?: string;
  value?: string;
  sourceId?: string | null;
  description?: string | null;
};

export const POST = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  const db = getDb();
  const a = [db, ctx.actor, ctx.organizationId, id] as const;
  switch (b.action) {
    case "move":
      await moveDeal(...a, String(b.stageId ?? ""));
      break;
    case "assign":
      await assignDeal(...a, b.userId ?? null);
      break;
    case "note":
      await addDealNote(...a, String(b.text ?? ""));
      break;
    case "tags":
      await setDealTags(...a, Array.isArray(b.tags) ? b.tags.map(String) : []);
      break;
    case "update":
      await updateDeal(...a, {
        title: b.title,
        ...(b.value !== undefined ? { valueCents: parseMoneyToCents(b.value) } : {}),
        sourceId: b.sourceId === undefined ? undefined : b.sourceId || null,
        description: b.description,
      });
      break;
    case "delete":
      await deleteDeal(...a);
      break;
    default:
      return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  }
  return Response.json({ ok: true });
});
