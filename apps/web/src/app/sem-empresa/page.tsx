import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NoOrgPage() {
  const ctx = await currentSession();
  if (!ctx) redirect("/login");
  if (ctx.organization) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-[380px] rounded-[20px] bg-surface p-6 text-center">
        <h1 className="title-2">Sem empresa ativa</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          Sua conta não está ligada a nenhuma empresa ativa. Peça um convite ao administrador.
        </p>
        <form action={logoutAction} className="mt-5">
          <button className="text-[15px] font-medium text-accent">Sair</button>
        </form>
      </div>
    </main>
  );
}
