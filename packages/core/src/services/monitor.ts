import {
  auditLog,
  type Database,
  memberships,
  notificationOutbox,
  users,
  whatsappConnections,
} from "@crm/db";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { EvolutionApi } from "../whatsapp/evolution.js";
import { notifyOrg } from "./events.js";

/** Só avisa se continuar fora do ar por este tempo (evita alarme em reconexão rápida). */
export const DOWN_GRACE_MS = 2 * 60_000;
/** Evolution sem responder por este tempo conta como fora do ar. */
const NO_ANSWER_MS = 5 * 60_000;

type Conn = typeof whatsappConnections.$inferSelect;

function isDown(c: Pick<Conn, "status" | "checkFailedSince">, now = Date.now()) {
  if (c.status !== "open") return true;
  return !!c.checkFailedSince && now - c.checkFailedSince.getTime() >= NO_ANSWER_MS;
}

/** Avisa a equipe pelo WhatsApp por outra conexão aberta da empresa (se houver). */
async function noticeByOtherConnection(db: Database, c: Conn, body: string) {
  const [other] = await db
    .select({ id: whatsappConnections.id })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.organizationId, c.organizationId),
        ne(whatsappConnections.id, c.id),
        eq(whatsappConnections.status, "open"),
        eq(whatsappConnections.active, true),
      ),
    )
    .limit(1);
  if (!other) return 0;
  const people = await db
    .select({ id: users.id, phone: users.phone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, c.organizationId),
        eq(memberships.active, true),
        inArray(memberships.role, ["admin", "manager"]),
        isNotNull(users.phone),
      ),
    );
  for (const p of people)
    await db.insert(notificationOutbox).values({
      organizationId: c.organizationId,
      connectionId: other.id,
      userId: p.id,
      toPhone: p.phone ?? "",
      body,
    });
  return people.length;
}

/**
 * Timer (a cada 2 min): confere na Evolution o estado real de cada conexão que já esteve conectada.
 * Pega queda sem webhook e Evolution fora do ar. Avisa uma vez por queda (som e aviso no navegador
 * de todos, WhatsApp dos gestores por outro número) e limpa quando volta.
 */
export async function monitorConnections(db: Database, evo: EvolutionApi) {
  const conns = await db
    .select()
    .from(whatsappConnections)
    .where(and(eq(whatsappConnections.active, true), isNotNull(whatsappConnections.connectedAt)));
  const out = { checked: conns.length, alerted: 0, recovered: 0 };
  for (const c of conns) {
    const now = new Date();
    let status = c.status;
    let checkFailedSince = c.checkFailedSince;
    try {
      const st = await evo.connectionState(c.instanceName);
      status = st === "open" || st === "connecting" ? st : "close";
      checkFailedSince = null;
    } catch {
      checkFailedSince = c.checkFailedSince ?? now;
    }
    const down = isDown({ status, checkFailedSince }, now.getTime());
    const downSince = down ? (c.downSince ?? now) : null;
    let downAlertedAt = down ? c.downAlertedAt : null;
    const shouldAlert =
      down && !c.downAlertedAt && now.getTime() - (downSince ?? now).getTime() >= DOWN_GRACE_MS;
    if (shouldAlert) downAlertedAt = now;
    await db
      .update(whatsappConnections)
      .set({
        ...(status !== c.status ? { status, updatedAt: now } : {}),
        downSince,
        downAlertedAt,
        checkFailedSince,
      })
      .where(eq(whatsappConnections.id, c.id));

    if (shouldAlert) {
      out.alerted++;
      const why = status === "open" ? "o servidor do WhatsApp não responde" : "o número saiu do ar";
      await db.insert(auditLog).values({
        organizationId: c.organizationId,
        action: "connection.down_alert",
        entity: "whatsapp_connection",
        entityId: c.id,
        data: { status, noAnswer: !!checkFailedSince },
      });
      await noticeByOtherConnection(
        db,
        c,
        `⚠️ WHATSAPP "${c.name}" DESCONECTADO\nDesde ${downSince?.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}: ${why}. Mensagens de clientes nesse número não estão chegando no CRM.\nReconecte em Conexões.`,
      );
      await notifyOrg(db, { o: c.organizationId, t: "connection_down", c: c.id, n: c.name });
    } else if (!down && c.downSince) {
      out.recovered++;
      await notifyOrg(db, { o: c.organizationId, t: "connection", c: c.id });
    } else if (status !== c.status) {
      await notifyOrg(db, { o: c.organizationId, t: "connection", c: c.id });
    }
  }
  return out;
}

/** Conexões fora do ar da empresa (faixa vermelha no topo das telas). */
export async function connectionAlerts(db: Database, organizationId: string) {
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.organizationId, organizationId),
        eq(whatsappConnections.active, true),
        isNotNull(whatsappConnections.connectedAt),
      ),
    );
  const now = Date.now();
  return rows
    .filter((c) => {
      if (!isDown(c, now)) return false;
      // "Fechada" é queda certa; "conectando" ou sem resposta só depois do tempo de tolerância.
      if (c.status === "close") return true;
      return !!c.downSince && now - c.downSince.getTime() >= DOWN_GRACE_MS;
    })
    .map((c) => ({
      id: c.id,
      name: c.name,
      since: (c.downSince ?? c.updatedAt).toISOString(),
      noAnswer: c.status === "open",
    }));
}
