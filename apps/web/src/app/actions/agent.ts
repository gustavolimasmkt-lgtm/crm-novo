"use server";

import { saveAgent } from "@crm/core";
import { getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { type FormState, str, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

export async function saveAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await saveAgent(getDb(), ctx.actor, ctx.organization.id, {
      name: str(fd, "name"),
      active: str(fd, "active") === "on",
      connectionId: str(fd, "connectionId") || null,
      model: str(fd, "model"),
      instructions: str(fd, "instructions"),
      replyDelaySeconds: Number(str(fd, "replyDelaySeconds") || 15),
      historyMessages: Number(str(fd, "historyMessages") || 20),
      handoffMessage: str(fd, "handoffMessage") || null,
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/agente");
  return { ok: true, message: "Agente salvo." };
}
