import { getFlowMedia } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  const m = await getFlowMedia(getDb(), ctx.organizationId, id);
  return new Response(new Uint8Array(m.data), {
    headers: {
      "content-type": m.mime,
      "content-length": String(m.size),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; media-src 'self'; img-src 'self'; sandbox",
    },
  });
});
