import { checkResetToken } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui";
import { AuthShell } from "../auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nova senha" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const token = (await searchParams).t ?? "";
  const ok = await checkResetToken(getDb(), token);
  if (!ok)
    return (
      <AuthShell title="Link vencido" subtitle="Esse link de senha já foi usado ou passou de 30 minutos.">
        <div className="space-y-4 rounded-[20px] bg-surface p-6 text-center">
          <Notice>Peça um link novo.</Notice>
          <Link href="/esqueci-senha" className="block text-[15px] font-medium text-accent">
            Esqueci minha senha
          </Link>
        </div>
      </AuthShell>
    );
  return (
    <AuthShell title="Nova senha" subtitle={`Conta ${ok.email}`}>
      <ResetForm token={token} />
    </AuthShell>
  );
}
