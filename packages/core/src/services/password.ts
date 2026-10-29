import {
  type Database,
  loginAttempts,
  memberships,
  organizations,
  passwordResets,
  sessions,
  users,
  whatsappConnections,
} from "@crm/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hashPassword, newToken, passwordProblem, sha256 } from "../auth/crypto.js";
import { type Actor, can } from "../auth/permissions.js";
import { normalizeEmail } from "../text.js";
import type { EvolutionApi } from "../whatsapp/evolution.js";
import { AppError } from "./errors.js";

type ActorU = Actor & { userId: string };

export const RESET_MINUTES = 30;
const MAX_REQUESTS_PER_HOUR = 3;

function appUrl() {
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}
const linkFor = (token: string) => `${appUrl()}/redefinir-senha?t=${token}`;

async function createReset(db: Database, userId: string, via: string) {
  const token = newToken();
  await db.insert(passwordResets).values({
    userId,
    tokenHash: sha256(token),
    via,
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000),
  });
  return token;
}

/** Conexão de WhatsApp aberta de alguma empresa ativa da pessoa (para mandar o link). */
async function connectionFor(db: Database, userId: string) {
  const [c] = await db
    .select({ instanceName: whatsappConnections.instanceName })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .innerJoin(whatsappConnections, eq(whatsappConnections.organizationId, memberships.organizationId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.active, true),
        eq(organizations.status, "active"),
        eq(whatsappConnections.status, "open"),
        eq(whatsappConnections.active, true),
      ),
    )
    .limit(1);
  return c ?? null;
}

/**
 * "Esqueci minha senha": manda o link pelo WhatsApp cadastrado em Conta. A resposta é sempre a mesma,
 * exista o e-mail ou não (não revela quem tem conta). Devolve true só para os testes.
 */
export async function requestPasswordReset(db: Database, evo: EvolutionApi, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;
  const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
  if (!user?.active || !user.phone) return false;
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(passwordResets)
    .where(
      and(eq(passwordResets.userId, user.id), gt(passwordResets.createdAt, new Date(Date.now() - 3600_000))),
    );
  if ((recent?.n ?? 0) >= MAX_REQUESTS_PER_HOUR) return false;
  const conn = await connectionFor(db, user.id);
  if (!conn) return false;
  const token = await createReset(db, user.id, "whatsapp");
  try {
    await evo.sendText(
      conn.instanceName,
      user.phone,
      `🔐 Nova senha do CRM\nOlá, ${user.name.split(" ")[0]}! Para criar uma senha nova, abra em até ${RESET_MINUTES} minutos:\n${linkFor(token)}\n\nSe não foi você, ignore esta mensagem.`,
    );
    return true;
  } catch (e) {
    console.error("[senha] falha ao enviar link:", (e as Error).message);
    return false;
  }
}

/**
 * Administrador/gestor gera o link para alguém da equipe (sem WhatsApp cadastrado, por exemplo).
 * Não vale para conta master nem para quem também está em outra empresa (evita tomar conta alheia).
 */
export async function createResetLinkForMember(
  db: Database,
  actor: ActorU,
  organizationId: string,
  userId: string,
) {
  if (!can(actor, "members.manage"))
    throw new AppError("forbidden", "Só administradores geram link de senha.");
  if (userId === actor.userId)
    throw new AppError("validation", "Para a sua senha, use Conta → Trocar senha.");
  const member = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)),
  });
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!member || !user) throw new AppError("not_found", "Pessoa não encontrada na equipe.");
  if (user.isMaster) throw new AppError("forbidden", "Não é possível para esta conta.");
  const [others] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), sql`${memberships.organizationId} <> ${organizationId}`));
  if ((others?.n ?? 0) > 0)
    throw new AppError(
      "forbidden",
      "Essa pessoa também usa outra empresa: ela precisa usar Esqueci minha senha.",
    );
  const token = await createReset(db, userId, `admin:${actor.userId}`);
  return { link: linkFor(token), minutes: RESET_MINUTES };
}

/** Confere se o link ainda vale (para a tela mostrar o formulário ou o aviso). */
export async function checkResetToken(db: Database, token: string) {
  if (!token) return null;
  const r = await db.query.passwordResets.findFirst({
    where: and(
      eq(passwordResets.tokenHash, sha256(token)),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, new Date()),
    ),
  });
  if (!r) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, r.userId) });
  return user?.active ? { email: user.email, name: user.name } : null;
}

/** Troca a senha pelo link: usa uma vez, derruba as sessões abertas e libera o bloqueio de tentativas. */
export async function resetPassword(db: Database, token: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new AppError("validation", problem);
  const [r] = await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResets.tokenHash, sha256(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .returning({ userId: passwordResets.userId });
  if (!r) throw new AppError("validation", "Link vencido ou já usado. Peça um novo.");
  const user = await db.query.users.findFirst({ where: eq(users.id, r.userId) });
  if (!user?.active) throw new AppError("forbidden", "Conta desativada.");
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
  await db
    .delete(loginAttempts)
    .where(and(eq(loginAttempts.email, normalizeEmail(user.email)), eq(loginAttempts.success, false)));
  return { email: user.email };
}
