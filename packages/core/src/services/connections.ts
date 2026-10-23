import { timingSafeEqual } from "node:crypto";
import { auditLog, type Database, organizations, webhookEvents, whatsappConnections } from "@crm/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { newToken, sha256 } from "../auth/crypto.js";
import { type Actor, can } from "../auth/permissions.js";
import { slugify } from "../text.js";
import {
  type EvolutionApi,
  EvolutionError,
  type EvolutionState,
  INSTANCE_PREFIX,
  jidToPhone,
} from "../whatsapp/evolution.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";
import { processEventRow } from "./messages.js";

type ActorU = Actor & { userId: string };

/** QR code da Evolution expira em ~40s; acima disso pedimos um novo. */
const QR_TTL_MS = 35_000;

function requireManage(actor: Actor) {
  if (!can(actor, "connections.manage"))
    throw new AppError("forbidden", "Só administradores gerenciam conexões de WhatsApp.");
}

function integrationError(e: unknown, what: string): AppError {
  const detail = e instanceof EvolutionError ? e.message : (e as Error)?.message;
  console.error(`[evolution] ${what}:`, detail);
  return new AppError("integration", `Não foi possível ${what} na Evolution. Tente de novo em instantes.`);
}

export function webhookUrl(baseUrl: string, connectionId: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/webhooks/evolution/${connectionId}?t=${encodeURIComponent(token)}`;
}

/** Com QR na tela, o estado é "aguardando leitura" (pending), mesmo que a Evolution diga "connecting". */
function mapStatus(state: EvolutionState, hasQr: boolean) {
  if (state === "open") return "open" as const;
  if (hasQr) return "pending" as const;
  return state === "connecting" ? ("connecting" as const) : ("close" as const);
}

export type ConnectionView = {
  id: string;
  name: string;
  status: "pending" | "connecting" | "open" | "close";
  active: boolean;
  phone: string | null;
  profileName: string | null;
  qrCode: string | null;
  connectedAt: Date | null;
  createdAt: Date;
};

function view(c: typeof whatsappConnections.$inferSelect): ConnectionView {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    active: c.active,
    phone: c.phone,
    profileName: c.profileName,
    qrCode: c.status === "open" ? null : c.qrCode,
    connectedAt: c.connectedAt,
    createdAt: c.createdAt,
  };
}

async function getOwned(db: Database, organizationId: string, id: string) {
  const c = await db.query.whatsappConnections.findFirst({
    where: and(eq(whatsappConnections.id, id), eq(whatsappConnections.organizationId, organizationId)),
  });
  if (!c) throw new AppError("not_found", "Conexão não encontrada.");
  return c;
}

async function audit(
  db: Database,
  organizationId: string,
  actorId: string | null,
  action: string,
  entityId: string,
  data?: unknown,
) {
  await db
    .insert(auditLog)
    .values({ organizationId, actorId, action, entity: "whatsapp_connection", entityId, data: data ?? null });
}

export async function listConnections(db: Database, actor: Actor, organizationId: string) {
  requireManage(actor);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.organizationId, organizationId))
    .orderBy(asc(whatsappConnections.createdAt));
  return { connections: rows.map(view), limit: org?.limits.whatsappConnections ?? 0 };
}

export const createConnectionInput = z.object({
  name: z.string().trim().min(2, "Dê um nome para a conexão (ex.: Loja, Vendas).").max(40),
});

export async function createConnection(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof createConnectionInput>,
  baseUrl: string,
): Promise<ConnectionView> {
  requireManage(actor);
  const input = createConnectionInput.parse(raw);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  if (!org) throw new AppError("not_found", "Empresa não encontrada.");
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(whatsappConnections)
    .where(eq(whatsappConnections.organizationId, organizationId));
  if (n >= org.limits.whatsappConnections) {
    throw new AppError(
      "limit",
      `Limite de ${org.limits.whatsappConnections} conexão(ões) do plano atingido. Fale com o administrador da plataforma.`,
    );
  }

  const slug = (slugify(org.name) || "empresa").replace(/-/g, "").slice(0, 16) || "empresa";
  const instanceName = `${INSTANCE_PREFIX}${slug}_${newToken(6)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8)}`;
  const token = newToken(24);

  const [row] = await db
    .insert(whatsappConnections)
    .values({
      organizationId,
      name: input.name,
      instanceName,
      webhookTokenHash: sha256(token),
      createdBy: actor.userId,
    })
    .returning();
  if (!row) throw new Error("Falha ao gravar conexão");

  try {
    const { qr } = await evo.createInstance(instanceName);
    await evo.setWebhook(instanceName, webhookUrl(baseUrl, row.id, token));
    const [updated] = await db
      .update(whatsappConnections)
      .set({ qrCode: qr?.base64 ?? null, qrUpdatedAt: qr ? new Date() : null, updatedAt: new Date() })
      .where(eq(whatsappConnections.id, row.id))
      .returning();
    await audit(db, organizationId, actor.userId, "connection.created", row.id, { name: input.name });
    return view(updated ?? row);
  } catch (e) {
    // Não deixa sobra: remove a instância (se chegou a ser criada) e o registro.
    await evo.deleteInstance(instanceName).catch(() => {});
    await db.delete(whatsappConnections).where(eq(whatsappConnections.id, row.id));
    throw integrationError(e, "criar a conexão");
  }
}

/** Consulta a Evolution e atualiza o estado. Enquanto não conectar, garante um QR code válido. */
export async function refreshConnection(
  db: Database,
  evo: EvolutionApi,
  actor: Actor,
  organizationId: string,
  id: string,
): Promise<ConnectionView> {
  requireManage(actor);
  const c = await getOwned(db, organizationId, id);
  let state: EvolutionState;
  try {
    state = await evo.connectionState(c.instanceName);
  } catch (e) {
    throw integrationError(e, "consultar a conexão");
  }

  if (state === "open") {
    const info = await evo.fetchInstance(c.instanceName).catch(() => null);
    const [u] = await db
      .update(whatsappConnections)
      .set({
        status: "open",
        qrCode: null,
        qrUpdatedAt: null,
        phone: jidToPhone(info?.ownerJid) ?? c.phone,
        profileName: info?.profileName ?? c.profileName,
        connectedAt: c.connectedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConnections.id, c.id))
      .returning();
    if (c.status !== "open") await audit(db, organizationId, null, "connection.opened", c.id);
    return view(u ?? c);
  }

  const qrFresh = c.qrCode && c.qrUpdatedAt && Date.now() - c.qrUpdatedAt.getTime() < QR_TTL_MS;
  let qrCode = c.qrCode;
  let qrUpdatedAt = c.qrUpdatedAt;
  if (!qrFresh) {
    try {
      const r = await evo.connect(c.instanceName);
      if (r.qr?.base64) {
        qrCode = r.qr.base64;
        qrUpdatedAt = new Date();
      }
      if (r.state === "open") return refreshConnection(db, evo, actor, organizationId, id);
    } catch (e) {
      throw integrationError(e, "gerar o QR code");
    }
  }
  const [u] = await db
    .update(whatsappConnections)
    .set({ status: mapStatus(state, !!qrCode), qrCode, qrUpdatedAt, updatedAt: new Date() })
    .where(eq(whatsappConnections.id, c.id))
    .returning();
  return view(u ?? c);
}

export async function disconnectConnection(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  id: string,
) {
  requireManage(actor);
  const c = await getOwned(db, organizationId, id);
  try {
    await evo.logout(c.instanceName);
  } catch (e) {
    throw integrationError(e, "desconectar");
  }
  await db
    .update(whatsappConnections)
    .set({ status: "close", qrCode: null, qrUpdatedAt: null, updatedAt: new Date() })
    .where(eq(whatsappConnections.id, c.id));
  await audit(db, organizationId, actor.userId, "connection.disconnected", c.id);
}

export async function deleteConnection(
  db: Database,
  evo: EvolutionApi,
  actor: ActorU,
  organizationId: string,
  id: string,
) {
  requireManage(actor);
  const c = await getOwned(db, organizationId, id);
  try {
    await evo.logout(c.instanceName).catch(() => {});
    await evo.deleteInstance(c.instanceName);
  } catch (e) {
    throw integrationError(e, "excluir a conexão");
  }
  await db.delete(whatsappConnections).where(eq(whatsappConnections.id, c.id));
  await audit(db, organizationId, actor.userId, "connection.deleted", c.id, { name: c.name });
}

export async function setConnectionActive(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  active: boolean,
) {
  requireManage(actor);
  const c = await getOwned(db, organizationId, id);
  await db
    .update(whatsappConnections)
    .set({ active, updatedAt: new Date() })
    .where(eq(whatsappConnections.id, c.id));
  await audit(
    db,
    organizationId,
    actor.userId,
    active ? "connection.activated" : "connection.deactivated",
    c.id,
  );
}

function tokenMatches(token: string, hash: string) {
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Recebe um evento da Evolution. Valida o segredo do endereço e o nome da instância,
 * guarda o evento e já aplica os de conexão (QR e estado). Mensagens ficam pendentes
 * para o processador de mensagens.
 */
export async function handleEvolutionWebhook(
  db: Database,
  connectionId: string,
  token: string,
  payload: unknown,
): Promise<{ status: 200 | 401 | 404; stored: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId) || !token) return { status: 401, stored: false };
  const c = await db.query.whatsappConnections.findFirst({ where: eq(whatsappConnections.id, connectionId) });
  if (!c) return { status: 404, stored: false };
  if (!tokenMatches(token, c.webhookTokenHash)) return { status: 401, stored: false };

  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.instance === "string" && p.instance !== c.instanceName) return { status: 401, stored: false };
  const event = String(p.event ?? "unknown")
    .toLowerCase()
    .replace(/_/g, ".");
  const data = (p.data ?? {}) as Record<string, unknown>;

  const isConnectionEvent = event === "qrcode.updated" || event === "connection.update";
  // Não guarda a imagem do QR no log de eventos (é grande e vira lixo em segundos).
  const stored = isConnectionEvent
    ? { ...p, data: { ...data, qrcode: data.qrcode ? "[omitido]" : undefined } }
    : p;
  const [ev] = await db
    .insert(webhookEvents)
    .values({ connectionId: c.id, organizationId: c.organizationId, event, payload: stored })
    .returning({ id: webhookEvents.id });

  if (isConnectionEvent) {
    if (event === "qrcode.updated") {
      const qr = (data.qrcode ?? data) as Record<string, unknown>;
      if (typeof qr.base64 === "string" && qr.base64) {
        await db
          .update(whatsappConnections)
          .set({ qrCode: qr.base64, qrUpdatedAt: new Date(), status: "pending", updatedAt: new Date() })
          .where(eq(whatsappConnections.id, c.id));
      }
    } else {
      const state = data.state === "open" || data.state === "connecting" ? data.state : "close";
      const phone = jidToPhone(typeof data.wuid === "string" ? data.wuid : null);
      await db
        .update(whatsappConnections)
        .set({
          status: state === "close" && c.status === "pending" ? "pending" : state,
          ...(state === "open"
            ? {
                qrCode: null,
                qrUpdatedAt: null,
                connectedAt: c.connectedAt ?? new Date(),
                ...(phone ? { phone } : {}),
                ...(typeof data.profileName === "string" ? { profileName: data.profileName } : {}),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(whatsappConnections.id, c.id));
      if (state !== c.status && (state === "open" || c.status === "open")) {
        await audit(db, c.organizationId, null, `connection.${state}`, c.id);
      }
    }
    if (ev)
      await db
        .update(webhookEvents)
        .set({ processedAt: new Date(), attempts: 1 })
        .where(eq(webhookEvents.id, ev.id));
    await notifyOrg(db, { o: c.organizationId, t: "connection" });
  } else if (ev) {
    // Mensagens: processa já; se falhar, o evento fica pendente e o reprocessador tenta de novo.
    const row = await db.query.webhookEvents.findFirst({ where: eq(webhookEvents.id, ev.id) });
    if (row) await processEventRow(db, row);
  }
  return { status: 200, stored: true };
}

/** Master ajusta os limites do plano de uma empresa. */
export const limitsInput = z.object({
  whatsappConnections: z.coerce.number().int().min(0).max(50),
  aiCreditsMonthly: z.coerce.number().int().min(0).max(10_000_000),
});

export async function updateOrganizationLimits(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof limitsInput>,
) {
  if (!actor.isMaster) throw new AppError("forbidden", "Apenas o Master altera limites.");
  const limits = limitsInput.parse(raw);
  await db
    .update(organizations)
    .set({ limits, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "organization.limits",
    entity: "organization",
    entityId: organizationId,
    data: limits,
  });
}
