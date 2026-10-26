"use server";

import {
  createAppointment,
  saveRotation,
  saveScheduleSettings,
  setAppointmentStatus,
  setMyPhone,
} from "@crm/core";
import { type AppointmentStatus, getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { type FormState, str, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

export async function createAppointmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await createAppointment(getDb(), ctx.actor, ctx.organization.id, {
      phone: str(fd, "phone"),
      contactName: str(fd, "contactName") || undefined,
      contactId: str(fd, "contactId") || undefined,
      date: str(fd, "date"),
      time: str(fd, "time"),
      assignedUserId: str(fd, "assignedUserId") || null,
      notes: str(fd, "notes") || undefined,
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/agenda");
  return { ok: true, message: "Visita marcada." };
}

export async function setAppointmentStatusAction(id: string, status: AppointmentStatus) {
  const ctx = await requireOrg();
  try {
    await setAppointmentStatus(getDb(), ctx.actor, ctx.organization.id, id, status);
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/agenda");
  return { ok: true };
}

export async function saveScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    const hours: Record<string, [string, string] | null> = {};
    for (let d = 0; d <= 6; d++)
      hours[String(d)] =
        str(fd, `open${d}`) === "on" ? [str(fd, `from${d}`) || "08:00", str(fd, `to${d}`) || "18:00"] : null;
    await saveScheduleSettings(getDb(), ctx.actor, ctx.organization.id, {
      aiCanBook: str(fd, "aiCanBook") === "on",
      durationMinutes: Number(str(fd, "durationMinutes") || 30),
      perSlot: Number(str(fd, "perSlot") || 1),
      hours,
      remindEnabled: str(fd, "remindEnabled") === "on",
      remindHours: str(fd, "remindHours")
        .split(/[^\d]+/)
        .filter(Boolean)
        .map(Number),
      remindTemplate: str(fd, "remindTemplate") || null,
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/agenda");
  return { ok: true, message: "Agenda salva." };
}

export async function saveRotationAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await saveRotation(getDb(), ctx.actor, ctx.organization.id, {
      enabled: str(fd, "enabled") === "on",
      notify: str(fd, "notify") === "on",
      notifyMessages: str(fd, "notifyMessages") === "on",
      userIds: fd.getAll("userIds").filter((v): v is string => typeof v === "string"),
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/equipe");
  return { ok: true, message: "Rodízio salvo." };
}

export async function setMyPhoneAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await setMyPhone(getDb(), ctx.user.id, str(fd, "phone"));
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/conta");
  return {
    ok: true,
    message: str(fd, "phone").trim() ? "Telefone salvo." : "Avisos por WhatsApp desligados.",
  };
}
