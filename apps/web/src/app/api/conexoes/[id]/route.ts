import { isAppError, refreshConnection } from "@crm/core";
import { getDb } from "@crm/db";
import { getEvolution } from "@/lib/evolution";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Estado atual da conexão (e QR code, se ainda não conectou). Usado pela tela enquanto aguarda a leitura. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await currentSession();
  if (!ctx?.organization) return Response.json({ error: "Faça login." }, { status: 401 });
  const { id } = await params;
  try {
    const c = await refreshConnection(
      getDb(),
      getEvolution(),
      { isMaster: ctx.user.isMaster, role: ctx.role },
      ctx.organization.id,
      id,
    );
    return Response.json(c, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAppError(e)) {
      const status = e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 502;
      return Response.json({ error: e.message }, { status });
    }
    console.error(e);
    return Response.json({ error: "Erro ao consultar a conexão." }, { status: 500 });
  }
}
