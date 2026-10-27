import { createDb, users } from "@crm/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/crypto.js";

export const db = createDb();

export async function resetDb() {
  await db.execute(
    sql`truncate table flow_runs, flows, capi_events, meta_ads, meta_settings, campaign_recipients, campaigns, scheduled_messages, tasks, quick_replies, followup_settings, notification_outbox, lead_rotation, schedule_settings, appointments, product_photos, products, ai_usage, ai_jobs, ai_agents, deal_events, deal_tags, deals, tags, deal_sources, pipeline_stages, pipelines, message_media, messages, conversations, contacts, webhook_events, whatsapp_connections, audit_log, login_attempts, invitations, sessions, department_members, departments, memberships, users, organizations restart identity cascade`,
  );
}

export async function createMaster(email = "master@teste.com", password = "senha1234") {
  const [u] = await db
    .insert(users)
    .values({ email, name: "Master", isMaster: true, passwordHash: await hashPassword(password) })
    .returning();
  return u!;
}
