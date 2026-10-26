import {
  getFollowupSettings,
  listCampaigns,
  listPipelines,
  listTags,
  listUsableConnections,
  OPT_OUT_FOOTER,
} from "@crm/core";
import { getDb } from "@crm/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { CampaignsClient } from "./campaigns-client";

export const metadata = { title: "Campanhas" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const ctx = await requirePermission("settings.manage");
  const db = getDb();
  const [items, connections, pipelines, tags, pace] = await Promise.all([
    listCampaigns(db, ctx.actor, ctx.organization.id),
    listUsableConnections(db, ctx.organization.id),
    listPipelines(db, ctx.organization.id),
    listTags(db, ctx.organization.id),
    getFollowupSettings(db, ctx.organization.id),
  ]);
  return (
    <>
      <PageHeader
        title="Campanhas"
        subtitle={`Disparo para uma lista de contatos, um por vez: ${pace.gapMinSeconds} a ${pace.gapMaxSeconds} s entre mensagens, até ${pace.dailyLimit} por dia por número, das ${pace.windowStart} às ${pace.windowEnd}`}
      />
      <CampaignsClient
        items={items.map((c) => ({
          ...c,
          startAt: c.startAt.toISOString(),
          finishedAt: c.finishedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
        connections={connections.map((c) => ({ id: c.id, name: c.name }))}
        stages={pipelines.flatMap((p) =>
          p.stages
            .filter((s) => s.kind !== "lost")
            .map((s) => ({ id: s.id, name: pipelines.length > 1 ? `${p.name} · ${s.name}` : s.name })),
        )}
        tags={tags.map((t) => ({ id: t.id, name: t.name }))}
        dailyLimit={pace.dailyLimit}
        footer={OPT_OUT_FOOTER}
      />
    </>
  );
}
