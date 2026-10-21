import { masterExists } from "@crm/core";
import { getDb } from "@crm/db";
import { notFound } from "next/navigation";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuração inicial" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!process.env.SETUP_TOKEN || !token || (await masterExists(getDb()))) notFound();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 text-center">
          <h1 className="title-2">Configuração inicial</h1>
          <p className="mt-1 text-[15px] text-ink-2">
            Crie a conta Master da plataforma. Isso só pode ser feito uma vez.
          </p>
        </div>
        <SetupForm token={token} />
      </div>
    </main>
  );
}
