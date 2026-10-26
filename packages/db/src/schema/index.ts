import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Papéis dentro de uma empresa. O papel "Master" é da plataforma (users.is_master), não de uma empresa. */
export const roleEnum = pgEnum("member_role", ["admin", "manager", "seller", "agent"]);
export const orgStatusEnum = pgEnum("org_status", ["active", "suspended"]);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: orgStatusEnum("status").notNull().default("active"),
    /** Limites do plano (ex.: whatsappConnections, aiCreditsMonthly). */
    limits: jsonb("limits")
      .$type<OrgLimits>()
      .notNull()
      .default({ whatsappConnections: 1, aiCreditsMonthly: 50000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export type OrgLimits = { whatsappConnections: number; aiCreditsMonthly: number };

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    isMaster: boolean("is_master").notNull().default(false),
    /** WhatsApp pessoal para avisos (novo lead, transferência, visita). Só dígitos. */
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    lastOrganizationId: uuid("last_organization_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("seller"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    /** SHA-256 do token enviado no cookie; o token em si nunca é guardado. */
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: roleEnum("role").notNull().default("seller"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_org_idx").on(t.organizationId),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("departments_org_name_uq").on(t.organizationId, t.name)],
);

export const departmentMembers = pgTable(
  "department_members",
  {
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.userId] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.organizationId, t.createdAt)],
);

/** Tentativas de login, para limitar força bruta por e-mail. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    email: text("email").notNull(),
    success: boolean("success").notNull(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt)],
);

/** Estado de uma conexão de WhatsApp (espelha a Evolution: open, connecting, close). */
export const connectionStatusEnum = pgEnum("connection_status", ["pending", "connecting", "open", "close"]);

/**
 * Conexão de WhatsApp de uma empresa, via Evolution API (QR code).
 * O CRM só opera instâncias registradas aqui (instance_name com prefixo próprio): a Evolution
 * pode atender outros sistemas e as instâncias deles nunca são tocadas.
 */
export const whatsappConnections = pgTable(
  "whatsapp_connections",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instanceName: text("instance_name").notNull(),
    status: connectionStatusEnum("status").notNull().default("pending"),
    /** Desativada pelo CRM: não envia nem processa mensagens, mas a sessão na Evolution continua. */
    active: boolean("active").notNull().default(true),
    phone: text("phone"),
    profileName: text("profile_name"),
    /** Último QR code recebido (imagem base64), só enquanto aguarda leitura. */
    qrCode: text("qr_code"),
    qrUpdatedAt: timestamp("qr_updated_at", { withTimezone: true }),
    /** SHA-256 do segredo que a Evolution envia no endereço do webhook. */
    webhookTokenHash: text("webhook_token_hash").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** Próximo envio automático permitido (anti-bloqueio). */
    nextAutomatedAt: timestamp("next_automated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("whatsapp_connections_instance_uq").on(t.instanceName),
    index("whatsapp_connections_org_idx").on(t.organizationId),
  ],
);

/** Eventos recebidos da Evolution, guardados antes de processar (permite reprocessar). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    connectionId: uuid("connection_id").references(() => whatsappConnections.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("webhook_events_pending_idx").on(t.processedAt, t.createdAt),
    index("webhook_events_connection_idx").on(t.connectionId, t.createdAt),
  ],
);

/** Contato da empresa (pessoa do outro lado do WhatsApp). */
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Identificador no WhatsApp (ex.: 5548999999999@s.whatsapp.net ou ...@lid). */
    waJid: text("wa_jid").notNull(),
    /** Só dígitos, quando conhecido. */
    phone: text("phone"),
    name: text("name"),
    email: text("email"),
    /** Nome que a pessoa usa no WhatsApp. */
    pushName: text("push_name"),
    /**
     * true quando o wa_jid veio do próprio WhatsApp. Contatos cadastrados à mão ou importados
     * ficam false até a primeira mensagem, quando o jid real substitui o provisório.
     */
    waVerified: boolean("wa_verified").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_org_jid_uq").on(t.organizationId, t.waJid),
    index("contacts_org_phone_idx").on(t.organizationId, t.phone),
  ],
);

export const conversationStatusEnum = pgEnum("conversation_status", ["open", "closed"]);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => whatsappConnections.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: conversationStatusEnum("status").notNull().default("open"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    lastMessageFromMe: boolean("last_message_from_me"),
    /** Agente de IA parado nesta conversa (humano assumiu ou transferência). */
    aiPaused: boolean("ai_paused").notNull().default(false),
    aiPausedReason: text("ai_paused_reason"),
    /** Follow-ups da IA já enviados desde a última mensagem do cliente. */
    followupCount: integer("followup_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("conversations_conn_contact_uq").on(t.connectionId, t.contactId),
    index("conversations_org_last_idx").on(t.organizationId, t.lastMessageAt),
    index("conversations_assigned_idx").on(t.organizationId, t.assignedUserId),
  ],
);

export const messageDirectionEnum = pgEnum("message_direction", ["in", "out"]);
export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contact",
  "other",
]);
export const messageStatusEnum = pgEnum("message_status", ["pending", "sent", "delivered", "read", "failed"]);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => whatsappConnections.id, { onDelete: "cascade" }),
    /** Id da mensagem no WhatsApp (key.id). Nulo só enquanto o envio não foi aceito. */
    externalId: text("external_id"),
    direction: messageDirectionEnum("direction").notNull(),
    type: messageTypeEnum("type").notNull().default("text"),
    body: text("body"),
    mediaMime: text("media_mime"),
    mediaName: text("media_name"),
    status: messageStatusEnum("status").notNull().default("sent"),
    error: text("error"),
    /** Quem do CRM enviou; nulo para recebidas e para enviadas direto do celular. */
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Enviada pelo agente de IA. */
    sentByAi: boolean("sent_by_ai").notNull().default(false),
    /** Nota interna da equipe: não vai para o WhatsApp nem para a IA. */
    internal: boolean("internal").notNull().default(false),
    /** Texto do áudio (transcrição). */
    transcript: text("transcript"),
    /** Envio automático (follow-up, lembrete): conta no limite anti-bloqueio. */
    automation: text("automation"),
    /** Mensagem original do WhatsApp (necessária para baixar a mídia depois). */
    raw: jsonb("raw"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_conn_external_uq").on(t.connectionId, t.externalId),
    index("messages_conversation_idx").on(t.conversationId, t.sentAt),
  ],
);

/** Arquivo de mídia de uma mensagem (guardado para não depender do WhatsApp depois). */
export const messageMedia = pgTable("message_media", {
  messageId: uuid("message_id")
    .primaryKey()
    .references(() => messages.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  fileName: text("file_name"),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

/** Funil de vendas. Uma empresa pode ter vários; um é o padrão (recebe os leads automáticos). */
export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("pipelines_org_idx").on(t.organizationId)],
);

/** O que a etapa representa nos relatórios. */
export const stageKindEnum = pgEnum("stage_kind", ["open", "scheduled", "won", "lost"]);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    color: text("color").notNull().default("#8e8e93"),
    kind: stageKindEnum("kind").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [index("stages_pipeline_idx").on(t.pipelineId, t.position)],
);

/** De onde o lead veio (Meta Ads, Indicação...). */
export const dealSources = pgTable(
  "deal_sources",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deal_sources_org_key_uq").on(t.organizationId, t.key)],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#0071e3"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_org_name_uq").on(t.organizationId, sql`lower(${t.name})`)],
);

export const dealValueTypeEnum = pgEnum("deal_value_type", ["single", "recurring"]);

/** Negociação (card do funil). Valores em centavos. */
export const deals = pgTable(
  "deals",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Número curto, sequencial por empresa, para falar "negociação 123". */
    number: integer("number").notNull(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    valueType: dealValueTypeEnum("value_type").notNull().default("single"),
    valueCents: bigint("value_cents", { mode: "number" }).notNull().default(0),
    setupCents: bigint("setup_cents", { mode: "number" }),
    monthlyCents: bigint("monthly_cents", { mode: "number" }),
    sourceId: uuid("source_id").references(() => dealSources.id, { onDelete: "set null" }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    connectionId: uuid("connection_id").references(() => whatsappConnections.id, { onDelete: "set null" }),
    description: text("description"),
    /** Campos trazidos de outro sistema (importação) ainda sem campo próprio aqui. */
    extra: jsonb("extra").$type<Record<string, string>>(),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deals_org_number_uq").on(t.organizationId, t.number),
    index("deals_stage_idx").on(t.stageId, t.updatedAt),
    index("deals_contact_idx").on(t.contactId),
    index("deals_org_assigned_idx").on(t.organizationId, t.assignedUserId),
  ],
);

export const dealTags = pgTable(
  "deal_tags",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.tagId] })],
);

/** Histórico da negociação: criação, mudança de etapa, responsável, valor e anotações. */
export const dealEvents = pgTable(
  "deal_events",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("deal_events_deal_idx").on(t.dealId, t.createdAt)],
);

/** Agente de IA da empresa: responde no WhatsApp com base nas instruções. */
export const aiAgents = pgTable(
  "ai_agents",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(false),
    /** Nula = atende todas as conexões da empresa. */
    connectionId: uuid("connection_id").references(() => whatsappConnections.id, { onDelete: "set null" }),
    model: text("model").notNull().default("claude-sonnet-5-5"),
    instructions: text("instructions").notNull().default(""),
    replyDelaySeconds: integer("reply_delay_seconds").notNull().default(15),
    historyMessages: integer("history_messages").notNull().default(20),
    handoffMessage: text("handoff_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_agents_org_uq").on(t.organizationId)],
);

/** Resposta pendente do agente (uma por conversa; novas mensagens empurram o horário: agrupa rajadas). */
export const aiJobs = pgTable("ai_jobs", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/** Consumo de IA (tokens) para controle de créditos. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_org_created_idx").on(t.organizationId, t.createdAt)],
);

/** Catálogo de produtos (ex.: veículos) que o agente de IA consulta. Valores em centavos. */
export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priceCents: bigint("price_cents", { mode: "number" }),
    /** Texto livre que substitui o valor (ex.: "Consulte"). */
    priceLabel: text("price_label"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_org_idx").on(t.organizationId, t.active)],
);

export const productPhotos = pgTable(
  "product_photos",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    mime: text("mime").notNull(),
    fileName: text("file_name"),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("product_photos_product_idx").on(t.productId, t.position)],
);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "attended",
  "no_show",
  "canceled",
]);

/** Visitas, test drives e reuniões. */
export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    connectionId: uuid("connection_id").references(() => whatsappConnections.id, { onDelete: "set null" }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByAi: boolean("created_by_ai").notNull().default(false),
    /** Lembretes já tratados (horas antes da visita). */
    remindersSent: jsonb("reminders_sent").$type<number[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("appointments_org_start_idx").on(t.organizationId, t.startsAt)],
);

/** Horário de atendimento da agenda (por dia da semana: 0 = domingo) e regras de marcação. */
export type WeekHours = Record<string, [string, string] | null>;
export const scheduleSettings = pgTable("schedule_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** O agente de IA pode marcar visitas. */
  aiCanBook: boolean("ai_can_book").notNull().default(false),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  perSlot: integer("per_slot").notNull().default(1),
  hours: jsonb("hours").$type<WeekHours>().notNull(),
  /** Lembrete da visita para o cliente pelo WhatsApp. */
  remindEnabled: boolean("remind_enabled").notNull().default(false),
  remindHours: jsonb("remind_hours").$type<number[]>().notNull().default([24, 2]),
  remindTemplate: text("remind_template"),
  updatedAt: updatedAt(),
});

/** Follow-up: a IA retoma o cliente que parou de responder. */
export type FollowupStep = { hours: number; text: string | null };
export const followupSettings = pgTable("followup_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  steps: jsonb("steps").$type<FollowupStep[]>().notNull(),
  /** Janela permitida para enviar (horário de Brasília). */
  windowStart: text("window_start").notNull().default("08:00"),
  windowEnd: text("window_end").notNull().default("20:00"),
  sundays: boolean("sundays").notNull().default(false),
  /** Proteção contra bloqueio: intervalo aleatório entre envios automáticos e limite por dia, por número. */
  gapMinSeconds: integer("gap_min_seconds").notNull().default(30),
  gapMaxSeconds: integer("gap_max_seconds").notNull().default(90),
  dailyLimit: integer("daily_limit").notNull().default(120),
  updatedAt: updatedAt(),
});

/** Respostas rápidas (atalho "/" no campo de mensagem). */
export const quickReplies = pgTable(
  "quick_replies",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shortcut: text("shortcut").notNull(),
    body: text("body").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quick_replies_org_shortcut_uq").on(t.organizationId, t.shortcut)],
);

/** Tarefas da equipe (ligar, mandar proposta...), com aviso no WhatsApp na hora. */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_org_assignee_idx").on(t.organizationId, t.assignedUserId, t.dueAt),
    index("tasks_deal_idx").on(t.dealId),
  ],
);

/** Rodízio de vendedores: quem recebe os leads novos, em ordem. */
export const leadRotation = pgTable("lead_rotation", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  userIds: jsonb("user_ids").$type<string[]>().notNull().default([]),
  lastUserId: uuid("last_user_id"),
  /** Avisa no WhatsApp pessoal do vendedor. */
  notify: boolean("notify").notNull().default(true),
  updatedAt: updatedAt(),
});

/** Avisos de WhatsApp para a equipe, enviados por um timer (não dependem de quem gerou). */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => whatsappConnections.id, { onDelete: "cascade" }),
    toPhone: text("to_phone").notNull(),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_pending_idx").on(t.sentAt, t.createdAt)],
);

export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];

export const schemaVersion = 9 as const;
export type Role = (typeof roleEnum.enumValues)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gestor",
  seller: "Vendedor",
  agent: "Atendente",
};
export type ConversationStatus = (typeof conversationStatusEnum.enumValues)[number];
export type MessageType = (typeof messageTypeEnum.enumValues)[number];
export type MessageStatus = (typeof messageStatusEnum.enumValues)[number];
export type StageKind = (typeof stageKindEnum.enumValues)[number];
export type AppointmentStatus = (typeof appointmentStatusEnum.enumValues)[number];
