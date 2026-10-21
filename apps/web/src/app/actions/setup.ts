"use server";

import { login, setupMaster } from "@crm/core";
import { getDb } from "@crm/db";
import { redirect } from "next/navigation";
import { type FormState, str, toFormError } from "@/lib/form";
import { requestMeta, setSessionCookie } from "@/lib/session";

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { email } = await setupMaster(getDb(), {
      token: str(fd, "token"),
      expectedToken: process.env.SETUP_TOKEN,
      name: str(fd, "name"),
      email: str(fd, "email"),
      password: str(fd, "password"),
    });
    const s = await login(getDb(), { email, password: str(fd, "password"), ...(await requestMeta()) });
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return toFormError(e);
  }
  redirect("/master");
}
