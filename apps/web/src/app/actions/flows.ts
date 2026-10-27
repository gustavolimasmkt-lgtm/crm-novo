"use server";

import { deleteFlow, saveFlow, setFlowActive } from "@crm/core";
import { type FlowStep, getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { type FormState, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

export async function saveFlowAction(
  id: string | null,
  input: {
    name: string;
    trigger: "manual" | "lead_created" | "stage_entered" | "tag_added";
    triggerStageId: string | null;
    triggerTagId: string | null;
    stopOnReply: boolean;
    steps: FlowStep[];
  },
): Promise<FormState & { id?: string }> {
  const ctx = await requireOrg();
  try {
    const fid = await saveFlow(getDb(), ctx.actor, ctx.organization.id, id, input);
    revalidatePath("/fluxos");
    return { ok: true, message: "Fluxo salvo.", id: fid ?? undefined };
  } catch (e) {
    return toFormError(e);
  }
}

export async function setFlowActiveAction(id: string, active: boolean) {
  const ctx = await requireOrg();
  try {
    await setFlowActive(getDb(), ctx.actor, ctx.organization.id, id, active);
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/fluxos");
  return { ok: true };
}

export async function deleteFlowAction(id: string) {
  const ctx = await requireOrg();
  try {
    await deleteFlow(getDb(), ctx.actor, ctx.organization.id, id);
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/fluxos");
  return { ok: true };
}
