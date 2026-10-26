"use server";

import { saveAgent, saveFollowupSettings } from "@crm/core";
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

export async function saveFollowupAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    const hours = fd.getAll("stepHours").map((v) => String(v));
    const texts = fd.getAll("stepText").map((v) => String(v));
    await saveFollowupSettings(getDb(), ctx.actor, ctx.organization.id, {
      enabled: str(fd, "enabled") === "on",
      steps: hours
        .map((h, i) => ({ hours: Number(h), text: texts[i]?.trim() || null }))
        .filter((s) => s.hours > 0),
      windowStart: str(fd, "windowStart") || "08:00",
      windowEnd: str(fd, "windowEnd") || "20:00",
      sundays: str(fd, "sundays") === "on",
      gapMinSeconds: Number(str(fd, "gapMinSeconds") || 30),
      gapMaxSeconds: Number(str(fd, "gapMaxSeconds") || 90),
      dailyLimit: Number(str(fd, "dailyLimit") || 120),
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/agente");
  return { ok: true, message: "Follow-up salvo." };
}
