"use server";

import {
  acceptInvitation,
  changePassword,
  login,
  logout,
  passwordProblem,
  switchOrganization,
} from "@crm/core";
import { getDb } from "@crm/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type FormState, str, toFormError } from "@/lib/form";
import {
  clearSessionCookie,
  requestMeta,
  requireSession,
  SESSION_COOKIE,
  setSessionCookie,
} from "@/lib/session";

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  try {
    const { token, expiresAt } = await login(getDb(), {
      email,
      password: str(fd, "password"),
      ...(await requestMeta()),
    });
    await setSessionCookie(token, expiresAt);
  } catch (e) {
    return { ...toFormError(e), data: { email } };
  }
  redirect("/");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

export async function acceptInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = str(fd, "token");
  try {
    const res = await acceptInvitation(getDb(), {
      token,
      name: str(fd, "name") || undefined,
      password: str(fd, "password"),
    });
    const session = await login(getDb(), {
      email: res.email,
      password: str(fd, "password"),
      ...(await requestMeta()),
    });
    await setSessionCookie(session.token, session.expiresAt);
  } catch (e) {
    return toFormError(e);
  }
  redirect("/");
}

export async function switchOrgAction(fd: FormData) {
  const ctx = await requireSession({ needOrg: false });
  await switchOrganization(getDb(), ctx, str(fd, "organizationId"));
  redirect("/");
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireSession({ needOrg: false });
  const next = str(fd, "next");
  if (next !== str(fd, "confirm")) return { error: "As senhas novas não são iguais." };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  try {
    await changePassword(getDb(), ctx.user.id, str(fd, "current"), next);
    return { ok: true, message: "Senha alterada." };
  } catch (e) {
    return toFormError(e);
  }
}
