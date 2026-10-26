import {
  type CampaignFilter,
  campaignRecipients,
  campaigns,
  contacts,
  type Database,
  messages,
  users,
  whatsappConnections,
} from "@crm/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { type EvolutionApi, jidToPhone } from "../whatsapp/evolution.js";
import { getFollowupSettings, inWindow, reserveAutomatedSend } from "./automations.js";
import { sendAiMessage } from "./conversations.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";
import { upsertContactAndConversation } from "./messages.js";

type ActorU = Actor & { userId: string };
export const MAX_CAMPAIGN_RECIPIENTS = 5000;
export const OPT_OUT_FOOTER = "Para não receber mais mensagens como esta, responda SAIR.";

function requireManage(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores fazem disparos.");
}

const uuidList = z.array(z.string().uuid()).max(100).default([]);
export const campaignFilterInput = z.object({
  stageIds: uuidList,
  tagIds: uuidList,
  lastContactDays: z.coerce.number().int().min(1).max(3650).nullable().default(null),
});

/** Contatos do público: com telefone, sem "SAIR", que não são da equipe, e que batem com os filtros. */
function audienceSql(organizationId: string, f: CampaignFilter) {
  const stages = f.stageIds?.length
    ? sql`and exists (select 1 from deals d where d.contact_id = ct.id
          and d.stage_id in (${sql.join(
            f.stageIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))`
    : sql``;
  const tags = f.tagIds?.length
    ? sql`and exists (select 1 from deals d join deal_tags dt on dt.deal_id = d.id where d.contact_id = ct.id
          and dt.tag_id in (${sql.join(
            f.tagIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}))`
    : sql``;
  const quiet = f.lastContactDays
    ? sql`and coalesce((select max(c.last_message_at) from conversations c where c.contact_id = ct.id), 'epoch'::timestamptz)
          < now() - make_interval(days => ${f.lastContactDays})`
    : sql``;
  return sql`
    select ct.id, coalesce(ct.name, ct.push_name, ct.phone) as name from contacts ct
    where ct.organization_id = ${organizationId}::uuid and not ct.opt_out and ct.phone is not null
      and not exists (select 1 from users tu join memberships tm on tm.user_id = tu.id
                      where tm.organization_id = ct.organization_id and tu.phone = ct.phone)
      ${stages} ${tags} ${quiet}
    order by ct.created_at
    limit ${MAX_CAMPAIGN_RECIPIENTS + 1}`;
}

export async function previewAudience(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof campaignFilterInput>,
) {
  requireManage(actor);
  const f = campaignFilterInput.parse(raw);
  const rows = await db.execute<{ id: string; name: string | null }>(audienceSql(organizationId, f));
  return {
    count: Math.min(rows.length, MAX_CAMPAIGN_RECIPIENTS),
    capped: rows.length > MAX_CAMPAIGN_RECIPIENTS,
    sample: rows.slice(0, 5).map((r) => r.name ?? "Sem nome"),
  };
}

export const campaignInput = z.object({
  name: z.string().trim().min(1, "Dê um nome para a campanha.").max(80),
  connectionId: z.string().uuid("Escolha a conexão."),
  body: z.string().trim().min(5, "Escreva a mensagem.").max(2000, "Mensagem longa demais (máximo 2000)."),
  optOutFooter: z.boolean().default(true),
  filter: campaignFilterInput,
  startAt: z.coerce.date().nullable().default(null),
});

export async function createCampaign(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof campaignInput>,
) {
  requireManage(actor);
  const input = campaignInput.parse(raw);
  const conn = await db.query.whatsappConnections.findFirst({
    where: and(
      eq(whatsappConnections.id, input.connectionId),
      eq(whatsappConnections.organizationId, organizationId),
    ),
  });
  if (!conn) throw new AppError("validation", "Conexão inválida.");
  const audience = await db.execute<{ id: string }>(audienceSql(organizationId, input.filter));
  if (!audience.length) throw new AppError("validation", "Nenhum contato nesse público.");
  if (audience.length > MAX_CAMPAIGN_RECIPIENTS)
    throw new AppError(
      "validation",
      `Público grande demais (máximo ${MAX_CAMPAIGN_RECIPIENTS}). Use mais filtros.`,
    );
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(campaigns)
      .values({
        organizationId,
        name: input.name,
        connectionId: conn.id,
        body: input.body,
        optOutFooter: input.optOutFooter,
        filter: input.filter,
        startAt: input.startAt && input.startAt.getTime() > Date.now() ? input.startAt : new Date(),
        createdByUserId: actor.userId,
      })
      .returning({ id: campaigns.id });
    if (!c) throw new Error("Falha ao criar campanha");
    for (let i = 0; i < audience.length; i += 500)
      await tx
        .insert(campaignRecipients)
        .values(audience.slice(i, i + 500).map((a) => ({ campaignId: c.id, contactId: a.id })))
        .onConflictDoNothing();
    return c.id;
  });
}

export async function listCampaigns(db: Database, actor: ActorU, organizationId: string) {
  requireManage(actor);
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      body: campaigns.body,
      status: campaigns.status,
      startAt: campaigns.startAt,
      finishedAt: campaigns.finishedAt,
      createdAt: campaigns.createdAt,
      createdByName: users.name,
      connectionName: whatsappConnections.name,
      total: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id})`,
      sent: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id} and r.status = 'sent')`,
      failed: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id} and r.status = 'failed')`,
      skipped: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id} and r.status = 'skipped')`,
      replied: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id} and r.status = 'sent'
        and exists (select 1 from messages m join conversations cv on cv.id = m.conversation_id
                    where cv.contact_id = r.contact_id and m.direction = 'in' and m.sent_at > r.sent_at))`,
    })
    .from(campaigns)
    .leftJoin(users, eq(users.id, campaigns.createdByUserId))
    .leftJoin(whatsappConnections, eq(whatsappConnections.id, campaigns.connectionId))
    .where(eq(campaigns.organizationId, organizationId))
    .orderBy(desc(campaigns.createdAt))
    .limit(100);
  return rows.map((r) => ({
    ...r,
    total: Number(r.total),
    sent: Number(r.sent),
    failed: Number(r.failed),
    skipped: Number(r.skipped),
    replied: Number(r.replied),
  }));
}

export async function setCampaignStatus(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  status: "running" | "paused" | "canceled",
) {
  requireManage(actor);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "Campanha não encontrada.");
  const c = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), eq(campaigns.organizationId, organizationId)),
  });
  if (!c) throw new AppError("not_found", "Campanha não encontrada.");
  if (c.status === "done" || c.status === "canceled")
    throw new AppError("validation", "Essa campanha já terminou.");
  await db
    .update(campaigns)
    .set({ status, updatedAt: new Date(), ...(status === "canceled" ? { finishedAt: new Date() } : {}) })
    .where(eq(campaigns.id, id));
  if (status === "canceled")
    await db
      .update(campaignRecipients)
      .set({ status: "skipped", error: "campanha cancelada" })
      .where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "pending")));
}

function firstName(c: { name: string | null; pushName: string | null }) {
  const n = (c.name || c.pushName || "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,}$/u.test(n) ? n : "";
}

export function campaignText(
  body: string,
  contact: { name: string | null; pushName: string | null },
  footer: boolean,
) {
  const text = body
    .replace(/\{nome\}/gi, firstName(contact))
    .replace(/ +([!,.?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
  return footer ? `${text}\n\n${OPT_OUT_FOOTER}` : text;
}

/**
 * Envia as campanhas: um contato por vez por número, pela fila anti-bloqueio
 * (mesma janela, intervalo e limite por dia do follow-up). Chamado por um timer.
 */
export async function processCampaigns(db: Database, evo: EvolutionApi) {
  const running = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.status, "running"), sql`${campaigns.startAt} <= now()`));
  const out: { campaignId: string; result: string }[] = [];
  for (const c of running) {
    const conn = c.connectionId
      ? await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, c.connectionId) })
      : null;
    if (!conn || conn.status !== "open" || !conn.active) continue;
    const pace = await getFollowupSettings(db, c.organizationId);
    if (!inWindow(pace)) continue;
    // Reserva o recipiente antes da vez no número (se não houver ninguém, a campanha terminou).
    const [r] = await db.execute<{ id: string; contact_id: string }>(sql`
      update campaign_recipients set status = 'sending'
      where id = (select id from campaign_recipients where campaign_id = ${c.id}::uuid and status = 'pending'
                  order by id limit 1 for update skip locked)
      returning id, contact_id`);
    if (!r) {
      // Sem pendentes: termina (algum "enviando" que sobrou só pode ser de um envio interrompido).
      await db
        .update(campaignRecipients)
        .set({ status: "failed", error: "envio interrompido" })
        .where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.status, "sending")));
      await db
        .update(campaigns)
        .set({ status: "done", finishedAt: new Date() })
        .where(eq(campaigns.id, c.id));
      out.push({ campaignId: c.id, result: "concluida" });
      continue;
    }
    if (!(await reserveAutomatedSend(db, conn.id, pace))) {
      await db.update(campaignRecipients).set({ status: "pending" }).where(eq(campaignRecipients.id, r.id));
      continue;
    }
    const finish = (
      status: "sent" | "failed" | "skipped",
      error: string | null,
      messageId: string | null = null,
    ) =>
      db
        .update(campaignRecipients)
        .set({ status, error, messageId, sentAt: status === "sent" ? new Date() : null })
        .where(eq(campaignRecipients.id, r.id));
    try {
      const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, r.contact_id) });
      if (!contact?.phone || contact.optOut) {
        await finish("skipped", contact?.optOut ? "pediu para sair" : "sem telefone");
        out.push({ campaignId: c.id, result: "pulado" });
        continue;
      }
      let jid = contact.waJid;
      let verified = contact.waVerified;
      if (!verified) {
        const [chk] = await evo.checkNumbers(conn.instanceName, [contact.phone]);
        if (chk && !chk.exists) {
          await finish("skipped", "número sem WhatsApp");
          out.push({ campaignId: c.id, result: "sem-whatsapp" });
          continue;
        }
        if (chk?.jid) {
          jid = chk.jid;
          verified = true;
        }
      }
      const { conversation } = await upsertContactAndConversation(db, conn, {
        contactJid: jid,
        phone: jid.endsWith("@s.whatsapp.net") ? jidToPhone(jid) : contact.phone,
        fromMe: true,
        verified,
      });
      const text = campaignText(c.body, contact, c.optOutFooter);
      const messageId = await sendAiMessage(db, evo, c.organizationId, conversation.id, text, {
        automation: "campaign",
        typing: true,
        byUserId: c.createdByUserId ?? undefined,
      });
      const m = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
      if (m?.status === "failed") {
        await finish("failed", "o WhatsApp recusou o envio", messageId);
        out.push({ campaignId: c.id, result: "falhou" });
      } else {
        await finish("sent", null, messageId);
        out.push({ campaignId: c.id, result: "enviado" });
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      console.error(`[campanha] ${c.id}:`, msg);
      await finish("failed", msg);
      out.push({ campaignId: c.id, result: "erro" });
    }
    await notifyOrg(db, { o: c.organizationId, t: "conversation" });
  }
  return out;
}
