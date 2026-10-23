import { sql } from "drizzle-orm";
import {
  boolean,
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

export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];

export const schemaVersion = 2 as const;
export type Role = (typeof roleEnum.enumValues)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gestor",
  seller: "Vendedor",
  agent: "Atendente",
};
