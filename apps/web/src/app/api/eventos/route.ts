import { can, type OrgEvent } from "@crm/core";
import { getHub } from "@/lib/realtime";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Fluxo de eventos em tempo real (Server-Sent Events) da empresa logada. */
export async function GET(req: Request) {
  const s = await currentSession();
  if (!s?.organization) return new Response("Faça login.", { status: 401 });
  const orgId = s.organization.id;
  const me = s.user.id;
  const seeAll = can({ isMaster: s.user.isMaster, role: s.role }, "conversations.view_all");
  const hub = getHub();
  await hub.ready;
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          cleanup();
        }
      };
      const onEvent = (ev: OrgEvent) => {
        if (ev.t === "inbound") {
          // Mensagem nova de cliente: só para quem pode ver a conversa (dele, sem dono ou gestor).
          if (!seeAll && ev.u && ev.u !== me) return;
          send(
            `data: ${JSON.stringify({ t: ev.t, c: ev.c ?? null, mine: ev.u === me, n: ev.n, p: ev.p, ai: !!ev.ai, lead: !!ev.lead })}\n\n`,
          );
          return;
        }
        send(`data: ${JSON.stringify({ t: ev.t, c: ev.c ?? null })}\n\n`);
      };
      hub.emitter.on(orgId, onEvent);
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      send("retry: 3000\n\n");
      cleanup = () => {
        clearInterval(ping);
        hub.emitter.off(orgId, onEvent);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
