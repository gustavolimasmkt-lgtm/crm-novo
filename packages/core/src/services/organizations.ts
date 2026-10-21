import {
  auditLog,
  type Database,
  invitations,
  memberships,
  type OrgLimits,
  organizations,
  type Role,
  users,
} from "@crm/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, newToken, passwordProblem, sha256 } from "../auth/crypto.js";
import { type Actor, can, canInviteRole } from "../auth/permissions.js";
import { normalizeEmail, slugify } from "../text.js";
import { AppError } from "./errors.js";

const INVITE_DAYS = 7;

export const createOrganizationInput = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(80),
  adminEmail: z.string().trim().email("E-mail inválido."),
  adminName: z.string().trim().min(2, "Informe o nome do administrador.").max(80),
  whatsappConnections: z.coerce.number().int().min(0).max(50).default(1),
  aiCreditsMonthly: z.coerce.number().int().min(0).max(10_000_000).default(50_000),
});

/** Somente o Master cria empresas. Gera o convite do primeiro administrador. */
export async function createOrganization(
  db: Database,
  actor: Actor & { userId: string },
  raw: z.input<typeof createOrganizationInput>,
) {
  if (!actor.isMaster) throw new AppError("forbidden", "Apenas o Master pode criar empresas.");
  const input = createOrganizationInput.parse(raw);
  let slug = slugify(input.name) || "empresa";
  const taken = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (taken)
    slug = `${slug}-${newToken(3)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}`;

  const limits: OrgLimits = {
    whatsappConnections: input.whatsappConnections,
    aiCreditsMonthly: input.aiCreditsMonthly,
  };
  const [org] = await db.insert(organizations).values({ name: input.name, slug, limits }).returning();
  if (!org) throw new Error("Falha ao criar empresa");
  const invite = await createInvitation(db, { ...actor, role: "admin" }, org.id, {
    email: input.adminEmail,
    name: input.adminName,
    role: "admin",
  });
  await audit(db, org.id, actor.userId, "organization.created", "organization", org.id, { name: org.name });
  return { organization: org, invite };
}

export async function listOrganizationsForMaster(db: Database) {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      limits: organizations.limits,
      createdAt: organizations.createdAt,
      members: sql<number>`(select count(*)::int from ${memberships} m where m.organization_id = ${organizations.id} and m.active)`,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt));
}

export async function setOrganizationStatus(
  db: Database,
  actor: Actor & { userId: string },
  organizationId: string,
  status: "active" | "suspended",
) {
  if (!actor.isMaster) throw new AppError("forbidden", "Apenas o Master pode suspender empresas.");
  await db
    .update(organizations)
    .set({ status, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
  await audit(db, organizationId, actor.userId, `organization.${status}`, "organization", organizationId);
}

export const inviteInput = z.object({
  email: z.string().trim().email("E-mail inválido."),
  name: z.string().trim().max(80).optional(),
  role: z.enum(["admin", "manager", "seller", "agent"]),
});

export async function createInvitation(
  db: Database,
  actor: Actor & { userId: string },
  organizationId: string,
  raw: z.input<typeof inviteInput>,
): Promise<{ id: string; token: string; email: string; expiresAt: Date }> {
  const input = inviteInput.parse(raw);
  if (!canInviteRole(actor, input.role))
    throw new AppError("forbidden", "Você não pode convidar com esse papel.");
  const email = normalizeEmail(input.email);

  const existing = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        sql`lower(${users.email}) = ${email}`,
        eq(memberships.organizationId, organizationId),
        eq(memberships.active, true),
      ),
    );
  if (existing.length) throw new AppError("conflict", "Essa pessoa já faz parte da empresa.");

  // Um convite pendente por e-mail: o novo substitui o anterior.
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const [row] = await db
    .insert(invitations)
    .values({
      organizationId,
      email,
      name: input.name ?? null,
      role: input.role,
      tokenHash: sha256(token),
      invitedBy: actor.userId,
      expiresAt,
    })
    .returning({ id: invitations.id });
  if (!row) throw new Error("Falha ao criar convite");
  await audit(db, organizationId, actor.userId, "invitation.created", "invitation", row.id, {
    email,
    role: input.role,
  });
  return { id: row.id, token, email, expiresAt };
}

export async function getInvitation(db: Database, token: string) {
  const inv = await db.query.invitations.findFirst({ where: eq(invitations.tokenHash, sha256(token)) });
  if (!inv || inv.revokedAt) throw new AppError("not_found", "Convite não encontrado ou cancelado.");
  if (inv.acceptedAt) throw new AppError("conflict", "Este convite já foi usado. Faça login.");
  if (inv.expiresAt < new Date()) throw new AppError("expired", "Este convite expirou. Peça um novo.");
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, inv.organizationId) });
  const user = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${inv.email}` });
  return { invitation: inv, organizationName: org?.name ?? "", userExists: !!user };
}

export const acceptInput = z.object({
  token: z.string().min(10),
  name: z.string().trim().min(2, "Informe seu nome.").max(80).optional(),
  password: z.string().min(1),
});

/** Aceita convite: cria a conta (se não existir) ou exige a senha atual da conta existente. */
export async function acceptInvitation(db: Database, raw: z.input<typeof acceptInput>) {
  const input = acceptInput.parse(raw);
  const { invitation } = await getInvitation(db, input.token);
  return db.transaction(async (tx) => {
    let user = await tx.query.users.findFirst({ where: sql`lower(${users.email}) = ${invitation.email}` });
    if (!user) {
      const problem = passwordProblem(input.password);
      if (problem) throw new AppError("validation", problem);
      const [created] = await tx
        .insert(users)
        .values({
          email: invitation.email,
          name: input.name || invitation.name || invitation.email.split("@")[0] || "Usuário",
          passwordHash: await hashPassword(input.password),
          lastOrganizationId: invitation.organizationId,
        })
        .returning();
      user = created;
    } else {
      const { verifyPassword } = await import("../auth/crypto.js");
      if (!(await verifyPassword(input.password, user.passwordHash))) {
        throw new AppError("invalid_credentials", "Você já tem conta: use a sua senha atual para aceitar.");
      }
    }
    if (!user) throw new Error("Falha ao criar usuário");
    await tx
      .insert(memberships)
      .values({
        organizationId: invitation.organizationId,
        userId: user.id,
        role: invitation.role,
        active: true,
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: { role: invitation.role, active: true },
      });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
    // Quem acabou de aceitar entra direto na empresa do convite.
    await tx
      .update(users)
      .set({ lastOrganizationId: invitation.organizationId })
      .where(eq(users.id, user.id));
    await tx.insert(auditLog).values({
      organizationId: invitation.organizationId,
      actorId: user.id,
      action: "invitation.accepted",
      entity: "invitation",
      entityId: invitation.id,
    });
    return { userId: user.id, email: user.email, organizationId: invitation.organizationId };
  });
}

export async function listMembers(db: Database, actor: Actor, organizationId: string) {
  if (!can(actor, "members.view")) throw new AppError("forbidden", "Sem permissão para ver a equipe.");
  const members = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      active: memberships.active,
      since: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(users.name);
  const pending = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  return { members, pending };
}

export async function updateMember(
  db: Database,
  actor: Actor & { userId: string },
  organizationId: string,
  userId: string,
  patch: { role?: Role; active?: boolean },
) {
  if (!can(actor, "members.manage")) throw new AppError("forbidden", "Sem permissão para alterar a equipe.");
  if (userId === actor.userId && (patch.active === false || (patch.role && patch.role !== "admin"))) {
    throw new AppError("validation", "Você não pode remover o seu próprio acesso de administrador.");
  }
  if (patch.active === false || (patch.role && patch.role !== "admin")) {
    const admins = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.role, "admin"),
          eq(memberships.active, true),
        ),
      );
    const target = await db.query.memberships.findFirst({
      where: and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)),
    });
    if (target?.role === "admin" && (admins[0]?.n ?? 0) <= 1) {
      throw new AppError("validation", "A empresa precisa de pelo menos um administrador ativo.");
    }
  }
  await db
    .update(memberships)
    .set(patch)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  await audit(db, organizationId, actor.userId, "member.updated", "user", userId, patch);
}

export async function revokeInvitation(
  db: Database,
  actor: Actor & { userId: string },
  organizationId: string,
  invitationId: string,
) {
  if (!can(actor, "members.manage") && actor.role !== "manager")
    throw new AppError("forbidden", "Sem permissão.");
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, organizationId)));
  await audit(db, organizationId, actor.userId, "invitation.revoked", "invitation", invitationId);
}

async function audit(
  db: Database,
  organizationId: string | null,
  actorId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
  data?: unknown,
) {
  await db.insert(auditLog).values({ organizationId, actorId, action, entity, entityId, data: data ?? null });
}
