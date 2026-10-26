"use server";

import { saveMetaSettings } from "@crm/core";
import { getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { type FormState, str, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

export async function saveMetaAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await saveMetaSettings(getDb(), ctx.actor, ctx.organization.id, {
      capiEnabled: str(fd, "capiEnabled") === "on",
      datasetId: str(fd, "datasetId"),
      capiToken: str(fd, "capiToken"),
      testEventCode: str(fd, "testEventCode"),
      wabaId: str(fd, "wabaId"),
      sendLead: str(fd, "sendLead") === "on",
      sendSchedule: str(fd, "sendSchedule") === "on",
      sendPurchase: str(fd, "sendPurchase") === "on",
      adAccountId: str(fd, "adAccountId"),
      adsToken: str(fd, "adsToken"),
      removeAdsToken: str(fd, "removeAdsToken") === "on",
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/meta");
  return { ok: true, message: "Integração salva." };
}
