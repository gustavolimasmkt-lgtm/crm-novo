import type { ReactNode } from "react";

/** Moldura das telas sem login (entrar, esqueci a senha, nova senha). */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[16px] bg-accent text-white shadow-float">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="title-2">{title}</h1>
          <p className="mt-1 text-[15px] text-ink-2">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
