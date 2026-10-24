import "server-only";
import { isAppError } from "@crm/core";
import { ZodError } from "zod";
import { currentSession } from "./session";

export type ApiCtx = {
  organizationId: string;
  actor: { isMaster: boolean; role: "admin" | "manager" | "seller" | "agent" | null; userId: string };
};

/** Envolve uma rota de API: exige login com empresa e converte erros em JSON com status certo. */
export function withOrg<P>(handler: (req: Request, ctx: ApiCtx, params: P) => Promise<Response>) {
  return async (req: Request, { params }: { params: Promise<P> }) => {
    const s = await currentSession();
    if (!s?.organization) return Response.json({ error: "Faça login novamente." }, { status: 401 });
    try {
      return await handler(
        req,
        {
          organizationId: s.organization.id,
          actor: { isMaster: s.user.isMaster, role: s.role, userId: s.user.id },
        },
        await params,
      );
    } catch (e) {
      if (isAppError(e)) {
        const status =
          e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : e.code === "integration" ? 502 : 400;
        return Response.json({ error: e.message }, { status });
      }
      if ((e as Error)?.name === "AiError") {
        console.error(e);
        return Response.json(
          { error: `A IA não respondeu: ${(e as Error).message.replace(/^IA respondeu \d+: /, "")}` },
          { status: 502 },
        );
      }
      if (e instanceof ZodError)
        return Response.json({ error: e.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
      console.error(e);
      return Response.json({ error: "Algo deu errado. Tente de novo." }, { status: 500 });
    }
  };
}
