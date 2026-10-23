import type { Database } from "@crm/db";
import { sql } from "drizzle-orm";

export const EVENTS_CHANNEL = "crm_events";

export type OrgEvent = {
  /** organização */
  o: string;
  t: "message" | "conversation" | "connection";
  /** conversa */
  c?: string;
};

/** Avisa as telas abertas (via LISTEN/NOTIFY do Postgres) que algo mudou. */
export async function notifyOrg(db: Database, ev: OrgEvent) {
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(ev)})`);
}
