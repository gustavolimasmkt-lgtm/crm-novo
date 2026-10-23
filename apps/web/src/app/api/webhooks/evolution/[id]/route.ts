import { handleEvolutionWebhook } from "@crm/core";
import { getDb } from "@crm/db";

export const dynamic = "force-dynamic";

/** Endereço que a Evolution chama a cada evento da instância. O segredo vem em ?t=. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: "json inválido" }, { status: 400 });
  }
  try {
    const r = await handleEvolutionWebhook(getDb(), id, token, payload);
    return Response.json({ ok: r.status === 200 }, { status: r.status });
  } catch (e) {
    console.error("[webhook evolution]", e);
    // 500 faz a Evolution tentar de novo.
    return Response.json({ ok: false }, { status: 500 });
  }
}
