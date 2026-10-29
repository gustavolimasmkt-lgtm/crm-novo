import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  return (
    <AuthShell title="Entrar" subtitle="Use o e-mail e a senha da sua conta.">
      <LoginForm />
    </AuthShell>
  );
}
