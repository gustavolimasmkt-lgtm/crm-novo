"use server";

import { createContact, deleteContact, startConversation, updateContact } from "@crm/core";
import { getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getEvolution } from "@/lib/evolution";
import { type FormState, str, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

export async function createContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  let id: string;
  try {
    id = await createContact(getDb(), ctx.actor, ctx.organization.id, {
      name: str(fd, "name"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      landline: str(fd, "landline") === "on",
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/contatos");
  redirect(`/contatos?id=${id}`);
}

export async function updateContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await updateContact(getDb(), ctx.actor, ctx.organization.id, str(fd, "id"), {
      name: str(fd, "name"),
      email: str(fd, "email"),
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/contatos");
  return { ok: true, message: "Contato salvo." };
}

export async function deleteContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  try {
    await deleteContact(getDb(), ctx.actor, ctx.organization.id, str(fd, "id"));
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/contatos");
  redirect("/contatos");
}

/** Abre (ou cria) a conversa com o contato e vai para a tela de Conversas. */
export async function talkToContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  let id: string;
  try {
    id = await startConversation(getDb(), getEvolution(), ctx.actor, ctx.organization.id, {
      connectionId: str(fd, "connectionId"),
      phone: str(fd, "phone"),
      brazil: str(fd, "phone").startsWith("55"),
    });
  } catch (e) {
    return toFormError(e);
  }
  redirect(`/conversas?c=${id}`);
}
