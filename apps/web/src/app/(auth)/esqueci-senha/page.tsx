import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPage() {
  return (
    <AuthShell title="Esqueci minha senha" subtitle="Mandamos um link no WhatsApp cadastrado na sua conta.">
      <ForgotForm />
    </AuthShell>
  );
}
