import { getDb, users } from "@crm/db";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { PasswordForm } from "./password-form";
import { PhoneForm } from "./phone-form";

export const metadata = { title: "Conta" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const ctx = await requireOrg();
  const me = await getDb().query.users.findFirst({ where: eq(users.id, ctx.user.id) });
  return (
    <>
      <PageHeader title="Conta" subtitle={ctx.user.email} />
      <div className="max-w-[440px] space-y-6">
        <PhoneForm phone={me?.phone ?? null} />
        <PasswordForm />
      </div>
    </>
  );
}
