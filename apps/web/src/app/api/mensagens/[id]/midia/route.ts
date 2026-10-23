import { getMessageMedia } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

export const GET = withOrg<{ id: string }>(async (req, ctx, { id }) => {
  const m = await getMessageMedia(getDb(), getEvolution(), ctx.actor, ctx.organizationId, id);
  const download = new URL(req.url).searchParams.has("baixar");
  const name = (m.fileName ?? "arquivo").replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(m.data), {
    headers: {
      "content-type": m.mime,
      "content-length": String(m.data.length),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      // Evita que um arquivo recebido rode script no domínio do CRM.
      "content-security-policy":
        "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
