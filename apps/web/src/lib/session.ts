import "server-only";
import { can, getSession, type Permission, type SessionContext } from "@crm/core";
import { getDb } from "@crm/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export const SESSION_COOKIE = "crm_session";

export const currentSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSession(getDb(), token);
});

/** Exige login. Sem empresa selecionada, manda para a escolha (ou para o painel Master). */
export async function requireSession(opts: { needOrg?: boolean } = { needOrg: true }) {
  const ctx = await currentSession();
  if (!ctx) redirect("/login");
  if (opts.needOrg !== false && !ctx.organization) redirect(ctx.user.isMaster ? "/master" : "/sem-empresa");
  return ctx;
}

export async function requireOrg() {
  const ctx = await requireSession();
  // biome-ignore lint/style/noNonNullAssertion: garantido por requireSession
  return {
    ...ctx,
    organization: ctx.organization!,
    actor: { isMaster: ctx.user.isMaster, role: ctx.role, userId: ctx.user.id },
  };
}

export async function requirePermission(permission: Permission) {
  const ctx = await requireOrg();
  if (!can(ctx.actor, permission)) redirect("/?sem-permissao=1");
  return ctx;
}

export async function requireMaster() {
  const ctx = await requireSession({ needOrg: false });
  if (!ctx.user.isMaster) redirect("/");
  return ctx;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
