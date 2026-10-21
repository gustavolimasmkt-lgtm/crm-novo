import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await currentSession()) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[16px] bg-accent text-white shadow-float">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="title-2">Entrar</h1>
          <p className="mt-1 text-[15px] text-ink-2">Use o e-mail e a senha da sua conta.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
