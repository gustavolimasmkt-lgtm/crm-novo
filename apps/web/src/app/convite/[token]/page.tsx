import { getInvitation, isAppError } from "@crm/core";
import { getDb, ROLE_LABELS } from "@crm/db";
import Link from "next/link";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data: Awaited<ReturnType<typeof getInvitation>> | null = null;
  let error: string | null = null;
  try {
    data = await getInvitation(getDb(), token);
  } catch (e) {
    error = isAppError(e) ? e.message : "Não foi possível abrir o convite.";
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        {error || !data ? (
          <div className="rounded-[20px] bg-surface p-6 text-center">
            <h1 className="title-2">Convite indisponível</h1>
            <p className="mt-2 text-[15px] text-ink-2">{error}</p>
            <Link href="/login" className="mt-5 inline-block text-[15px] font-medium text-accent">
              Ir para o login
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <p className="text-[13px] font-medium uppercase tracking-wide text-ink-3">Convite</p>
              <h1 className="title-2 mt-1">{data.organizationName}</h1>
              <p className="mt-1 text-[15px] text-ink-2">
                Você foi convidado como{" "}
                <strong className="text-ink">{ROLE_LABELS[data.invitation.role]}</strong> com o e-mail{" "}
                {data.invitation.email}.
              </p>
            </div>
            <AcceptForm
              token={token}
              userExists={data.userExists}
              suggestedName={data.invitation.name ?? ""}
            />
          </>
        )}
      </div>
    </main>
  );
}
