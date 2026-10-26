"use server";

import { createTask, deleteQuickReply, deleteTask, saveQuickReply, setTaskDone } from "@crm/core";
import { getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { type FormState, str, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

export async function saveQuickReplyAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await saveQuickReply(getDb(), ctx.actor, ctx.organization.id, str(fd, "id") || null, {
      shortcut: str(fd, "shortcut"),
      body: str(fd, "body"),
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/respostas");
  return { ok: true, message: "Resposta salva." };
}

export async function deleteQuickReplyAction(id: string) {
  const ctx = await requireOrg();
  try {
    await deleteQuickReply(getDb(), ctx.actor, ctx.organization.id, id);
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/respostas");
  return { ok: true };
}

export async function createTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await createTask(getDb(), ctx.actor, ctx.organization.id, {
      title: str(fd, "title"),
      notes: str(fd, "notes") || undefined,
      date: str(fd, "date"),
      time: str(fd, "time") || "09:00",
      assignedUserId: str(fd, "assignedUserId") || null,
      dealId: str(fd, "dealId") || null,
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/tarefas");
  return { ok: true, message: "Tarefa criada." };
}

export async function setTaskDoneAction(id: string, done: boolean) {
  const ctx = await requireOrg();
  try {
    await setTaskDone(getDb(), ctx.actor, ctx.organization.id, id, done);
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/tarefas");
  return { ok: true };
}

export async function deleteTaskAction(id: string) {
  const ctx = await requireOrg();
  try {
    await deleteTask(getDb(), ctx.actor, ctx.organization.id, id);
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/tarefas");
  return { ok: true };
}
