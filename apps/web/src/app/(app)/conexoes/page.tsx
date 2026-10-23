import { listConnections } from "@crm/core";
import { getDb } from "@crm/db";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { ConnectionsClient } from "./connections-client";

export const metadata = { title: "Conexões" };
export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const ctx = await requirePermission("connections.manage");
  const { connections, limit } = await listConnections(getDb(), ctx.actor, ctx.organization.id);
  const configured = Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
  return (
    <>
      <PageHeader title="Conexões" subtitle="WhatsApp da empresa" />
      <ConnectionsClient
        configured={configured}
        limit={limit}
        connections={connections.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          active: c.active,
          phone: c.phone,
          profileName: c.profileName,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
