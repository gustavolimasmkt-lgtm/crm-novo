"use server";

import {
  createConnection,
  deleteConnection,
  disconnectConnection,
  setConnectionActive,
  updateOrganizationLimits,
} from "@crm/core";
import { getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { getEvolution } from "@/lib/evolution";
import { type FormState, str, toFormError } from "@/lib/form";
import { appUrl, requireMaster, requirePermission } from "@/lib/session";

export async function createConnectionAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requirePermission("connections.manage");
  try {
    const c = await createConnection(
      getDb(),
      getEvolution(),
      ctx.actor,
      ctx.organization.id,
      { name: str(fd, "name") },
      appUrl(),
    );
    revalidatePath("/conexoes");
    return { ok: true, data: { id: c.id, name: c.name } };
  } catch (e) {
    return toFormError(e);
  }
}

export async function connectionCommandAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requirePermission("connections.manage");
  const id = str(fd, "id");
  const cmd = str(fd, "cmd");
  try {
    if (cmd === "disconnect")
      await disconnectConnection(getDb(), getEvolution(), ctx.actor, ctx.organization.id, id);
    else if (cmd === "delete")
      await deleteConnection(getDb(), getEvolution(), ctx.actor, ctx.organization.id, id);
    else if (cmd === "activate" || cmd === "deactivate")
      await setConnectionActive(getDb(), ctx.actor, ctx.organization.id, id, cmd === "activate");
    else return { error: "Ação desconhecida." };
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/conexoes");
  return { ok: true };
}

export async function updateLimitsAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireMaster();
  try {
    await updateOrganizationLimits(
      getDb(),
      { isMaster: true, role: null, userId: ctx.user.id },
      str(fd, "organizationId"),
      {
        whatsappConnections: Number(str(fd, "whatsappConnections")),
        aiCreditsMonthly: Number(str(fd, "aiCreditsMonthly")),
      },
    );
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/master");
  return { ok: true, message: "Limites salvos." };
}
