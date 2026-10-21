import {
  type Database,
  loginAttempts,
  memberships,
  organizations,
  type Role,
  sessions,
  users,
} from "@crm/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { hashPassword, newToken, sha256, verifyPassword } from "../auth/crypto.js";
import { normalizeEmail } from "../text.js";
import { AppError } from "./errors.js";

export const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const FAILED_WINDOW_MIN = 15;

export type SessionContext = {
  sessionId: string;
  user: { id: string; name: string; email: string; isMaster: boolean };
  organization: { id: string; name: string; slug: string; status: "active" | "suspended" } | null;
  role: Role | null;
};

export async function login(
  db: Database,
  input: { email: string; password: string; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const email = normalizeEmail(input.email);
  const since = new Date(Date.now() - FAILED_WINDOW_MIN * 60_000);
  const [failed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, since),
      ),
    );
  if ((failed?.n ?? 0) >= MAX_FAILED) {
    throw new AppError("rate_limited", "Muitas tentativas. Aguarde 15 minutos e tente de novo.");
  }

  const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
  const ok = !!user && user.active && (await verifyPassword(input.password, user.passwordHash));
  await db.insert(loginAttempts).values({ email, success: ok, ip: input.ip ?? null });
  if (!ok || !user) throw new AppError("invalid_credentials", "E-mail ou senha incorretos.");

  const orgId = await pickOrganization(db, user.id, user.lastOrganizationId, user.isMaster);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId: user.id,
    organizationId: orgId,
    expiresAt,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

async function pickOrganization(
  db: Database,
  userId: string,
  preferred: string | null,
  isMaster: boolean,
): Promise<string | null> {
  const rows = await db
    .select({ id: memberships.organizationId })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(eq(memberships.userId, userId), eq(memberships.active, true), eq(organizations.status, "active")),
    );
  if (preferred && rows.some((r) => r.id === preferred)) return preferred;
  if (rows[0]) return rows[0].id;
  if (isMaster && preferred) return preferred;
  return null;
}

export async function getSession(
  db: Database,
  token: string | undefined | null,
): Promise<SessionContext | null> {
  if (!token) return null;
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())),
  });
  if (!row) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user || !user.active) return null;

  let organization: SessionContext["organization"] = null;
  let role: Role | null = null;
  if (row.organizationId) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, row.organizationId) });
    const member = await db.query.memberships.findFirst({
      where: and(eq(memberships.organizationId, row.organizationId), eq(memberships.userId, user.id)),
    });
    const allowed = user.isMaster || (member?.active && org?.status === "active");
    if (org && allowed) {
      organization = { id: org.id, name: org.name, slug: org.slug, status: org.status };
      role = member?.active ? member.role : user.isMaster ? "admin" : null;
    }
  }
  return {
    sessionId: row.id,
    user: { id: user.id, name: user.name, email: user.email, isMaster: user.isMaster },
    organization,
    role,
  };
}

export async function logout(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function listMyOrganizations(db: Database, userId: string, isMaster: boolean) {
  if (isMaster) {
    return db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
      })
      .from(organizations)
      .orderBy(organizations.name);
  }
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(
      and(eq(memberships.userId, userId), eq(memberships.active, true), eq(organizations.status, "active")),
    )
    .orderBy(organizations.name);
}

export async function switchOrganization(
  db: Database,
  ctx: SessionContext,
  organizationId: string,
): Promise<void> {
  const orgs = await listMyOrganizations(db, ctx.user.id, ctx.user.isMaster);
  if (!orgs.some((o) => o.id === organizationId))
    throw new AppError("forbidden", "Você não tem acesso a essa empresa.");
  await db.update(sessions).set({ organizationId }).where(eq(sessions.id, ctx.sessionId));
  await db.update(users).set({ lastOrganizationId: organizationId }).where(eq(users.id, ctx.user.id));
}

export async function changePassword(
  db: Database,
  userId: string,
  current: string,
  next: string,
): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    throw new AppError("invalid_credentials", "Senha atual incorreta.");
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), updatedAt: new Date() })
    .where(eq(users.id, userId));
}
