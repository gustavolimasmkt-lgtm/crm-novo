import type { Database } from "@crm/db";
import { sql } from "drizzle-orm";

export const EVENTS_CHANNEL = "crm_events";

export type OrgEvent = {
  /** organização */
  o: string;
  t: "message" | "conversation" | "connection" | "inbound";
  /** conversa */
  c?: string;
  /** inbound: responsável da conversa (null = sem dono) */
  u?: string | null;
  /** inbound: nome do contato e prévia da mensagem (para o aviso do navegador) */
  n?: string;
  p?: string;
  /** inbound: a IA vai responder; lead: negociação nova */
  ai?: boolean;
  lead?: boolean;
};

/** Avisa as telas abertas (via LISTEN/NOTIFY do Postgres) que algo mudou. */
export async function notifyOrg(db: Database, ev: OrgEvent) {
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(ev)})`);
}
