import { can, getContact, isAppError, listContacts, listUsableConnections } from "@crm/core";
import { getDb } from "@crm/db";
import { requireOrg } from "@/lib/session";
import { ContactsClient } from "./contacts-client";

export const metadata = { title: "Contatos" };
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; id?: string; novo?: string }>;
}) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const db = getDb();
  const page = Math.max(Number(sp.p) || 1, 1);
  const [list, connections] = await Promise.all([
    listContacts(db, ctx.actor, ctx.organization.id, { q: sp.q, page, pageSize: 50 }),
    listUsableConnections(db, ctx.organization.id),
  ]);
  let selected = null;
  if (sp.id) {
    try {
      selected = await getContact(db, ctx.actor, ctx.organization.id, sp.id);
    } catch (e) {
      if (!isAppError(e)) throw e;
    }
  }
  return (
    <ContactsClient
      list={JSON.parse(JSON.stringify(list))}
      q={sp.q ?? ""}
      selected={selected ? JSON.parse(JSON.stringify(selected)) : null}
      creating={sp.novo === "1"}
      canManage={can(ctx.actor, "contacts.manage")}
      connections={connections.filter((c) => c.status === "open").map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
