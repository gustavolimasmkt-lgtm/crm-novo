import "server-only";
import { EventEmitter } from "node:events";
import { EVENTS_CHANNEL, type OrgEvent } from "@crm/core";
import postgres from "postgres";

type Hub = { emitter: EventEmitter; ready: Promise<void> };
const g = globalThis as unknown as { __crmHub?: Hub };

/** Um único LISTEN no Postgres por processo; repassa os avisos para as telas abertas (SSE). */
export function getHub(): Hub {
  if (g.__crmHub) return g.__crmHub;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 1, prepare: false });
  const ready = client
    .listen(EVENTS_CHANNEL, (payload) => {
      try {
        const ev = JSON.parse(payload) as OrgEvent;
        emitter.emit(ev.o, ev);
      } catch {
        // aviso malformado: ignora
      }
    })
    .then(() => undefined);
  g.__crmHub = { emitter, ready };
  return g.__crmHub;
}
