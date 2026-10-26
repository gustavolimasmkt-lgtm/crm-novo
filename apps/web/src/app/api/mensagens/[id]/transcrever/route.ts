import { AppError, transcribeMessage } from "@crm/core";
import { getDb } from "@crm/db";
import { getTranscriber } from "@/lib/ai";
import { withOrg } from "@/lib/api";
import { getEvolution } from "@/lib/evolution";

export const dynamic = "force-dynamic";

export const POST = withOrg<{ id: string }>(async (_req, ctx, { id }) => {
  const stt = getTranscriber();
  if (!stt) throw new AppError("integration", "Transcrição de áudio não configurada (TRANSCRIBE_API_KEY).");
  try {
    const text = await transcribeMessage(getDb(), getEvolution(), stt, ctx.organizationId, id, ctx.actor);
    return Response.json({ text });
  } catch (e) {
    if ((e as Error)?.name === "TranscribeError") throw new AppError("integration", (e as Error).message);
    throw e;
  }
});
