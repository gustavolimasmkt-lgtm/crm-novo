"use server";

import {
  createInvitation,
  createOrganization,
  revokeInvitation,
  setOrganizationStatus,
  updateMember,
} from "@crm/core";
import { getDb, type Role } from "@crm/db";
import { revalidatePath } from "next/cache";
import { escapeHtml, sendEmail } from "@/lib/email";
import { type FormState, str, toFormError } from "@/lib/form";
import { appUrl, requireMaster, requireOrg } from "@/lib/session";

async function deliverInvite(email: string, orgName: string, token: string) {
  const link = `${appUrl()}/convite/${token}`;
  const sent = await sendEmail(
    email,
    `Convite para ${orgName}`,
    `<p>Você foi convidado para <strong>${escapeHtml(orgName)}</strong>.</p><p><a href="${link}">Aceitar convite</a></p><p>O link vale por 7 dias.</p>`,
  );
  return { link, sent };
}

export async function inviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    const inv = await createInvitation(getDb(), ctx.actor, ctx.organization.id, {
      email: str(fd, "email"),
      name: str(fd, "name") || undefined,
      role: str(fd, "role") as Role,
    });
    const { link, sent } = await deliverInvite(inv.email, ctx.organization.name, inv.token);
    revalidatePath("/equipe");
    return {
      ok: true,
      message: sent
        ? `Convite enviado para ${inv.email}.`
        : "Convite criado. Envie o link abaixo para a pessoa:",
      data: { link },
    };
  } catch (e) {
    return toFormError(e);
  }
}

export async function updateMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  const role = str(fd, "role") as Role | "";
  const active = str(fd, "active");
  try {
    await updateMember(getDb(), ctx.actor, ctx.organization.id, str(fd, "userId"), {
      ...(role ? { role } : {}),
      ...(active ? { active: active === "true" } : {}),
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/equipe");
  return { ok: true };
}

export async function revokeInviteAction(fd: FormData) {
  const ctx = await requireOrg();
  await revokeInvitation(getDb(), ctx.actor, ctx.organization.id, str(fd, "invitationId"));
  revalidatePath("/equipe");
}

export async function createOrganizationAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireMaster();
  try {
    const { organization, invite } = await createOrganization(
      getDb(),
      { isMaster: true, role: null, userId: ctx.user.id },
      {
        name: str(fd, "name"),
        adminEmail: str(fd, "adminEmail"),
        adminName: str(fd, "adminName"),
        whatsappConnections: Number(str(fd, "whatsappConnections") || 1),
        aiCreditsMonthly: Number(str(fd, "aiCreditsMonthly") || 50000),
      },
    );
    const { link, sent } = await deliverInvite(invite.email, organization.name, invite.token);
    revalidatePath("/master");
    return {
      ok: true,
      message: sent
        ? `Empresa criada. Convite enviado para ${invite.email}.`
        : `Empresa criada. Envie o link do administrador:`,
      data: { link },
    };
  } catch (e) {
    return toFormError(e);
  }
}

export async function setOrgStatusAction(fd: FormData) {
  const ctx = await requireMaster();
  await setOrganizationStatus(
    getDb(),
    { isMaster: true, role: null, userId: ctx.user.id },
    str(fd, "organizationId"),
    str(fd, "status") === "suspended" ? "suspended" : "active",
  );
  revalidatePath("/master");
}
