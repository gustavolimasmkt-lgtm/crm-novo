import { can, listQuickReplies } from "@crm/core";
import { getDb } from "@crm/db";
import { PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { QuickRepliesClient } from "./quick-replies-client";

export const metadata = { title: "Respostas rápidas" };
export const dynamic = "force-dynamic";

export default async function QuickRepliesPage() {
  const ctx = await requireOrg();
  const items = await listQuickReplies(getDb(), ctx.organization.id);
  return (
    <>
      <PageHeader
        title="Respostas rápidas"
        subtitle='Na conversa, digite "/" e o atalho para inserir a mensagem. {nome} vira o primeiro nome do cliente.'
      />
      <QuickRepliesClient items={items} canEdit={can(ctx.actor, "settings.manage")} />
    </>
  );
}
