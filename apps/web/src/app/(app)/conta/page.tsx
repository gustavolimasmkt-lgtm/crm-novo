import { PageHeader } from "@/components/ui";
import { requireOrg } from "@/lib/session";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Conta" };

export default async function AccountPage() {
  const ctx = await requireOrg();
  return (
    <>
      <PageHeader title="Conta" subtitle={ctx.user.email} />
      <div className="max-w-[440px]">
        <PasswordForm />
      </div>
    </>
  );
}
