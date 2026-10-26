import { type Database, quickReplies } from "@crm/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { AppError } from "./errors.js";

type ActorU = Actor & { userId: string };

export async function listQuickReplies(db: Database, organizationId: string) {
  return db
    .select({ id: quickReplies.id, shortcut: quickReplies.shortcut, body: quickReplies.body })
    .from(quickReplies)
    .where(eq(quickReplies.organizationId, organizationId))
    .orderBy(asc(quickReplies.shortcut));
}

export const quickReplyInput = z.object({
  shortcut: z
    .string()
    .trim()
    .transform((v) =>
      v.replace(/^\/+/, "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-"),
    )
    .pipe(
      z
        .string()
        .min(2, "Atalho com pelo menos 2 letras.")
        .max(30, "Atalho com no máximo 30 letras.")
        .regex(/^[a-z0-9_-]+$/, "Atalho só com letras, números, - e _."),
    ),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(4000, "Mensagem longa demais."),
});

function requireManage(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores editam as respostas rápidas.");
}

export async function saveQuickReply(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string | null,
  raw: z.input<typeof quickReplyInput>,
) {
  requireManage(actor);
  const input = quickReplyInput.parse(raw);
  const dup = await db.query.quickReplies.findFirst({
    where: and(eq(quickReplies.organizationId, organizationId), eq(quickReplies.shortcut, input.shortcut)),
  });
  if (dup && dup.id !== id) throw new AppError("validation", `Já existe a resposta /${input.shortcut}.`);
  if (id) {
    const r = await db
      .update(quickReplies)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(quickReplies.id, id), eq(quickReplies.organizationId, organizationId)))
      .returning({ id: quickReplies.id });
    if (!r.length) throw new AppError("not_found", "Resposta não encontrada.");
    return id;
  }
  const [r] = await db
    .insert(quickReplies)
    .values({ organizationId, ...input, createdByUserId: actor.userId })
    .returning({ id: quickReplies.id });
  return r?.id ?? null;
}

export async function deleteQuickReply(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireManage(actor);
  await db
    .delete(quickReplies)
    .where(and(eq(quickReplies.id, id), eq(quickReplies.organizationId, organizationId)));
}

/** Troca {nome} pelo primeiro nome do contato (ou some com ele). */
export function fillQuickReply(body: string, contactName: string | null) {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  const name = /^[\p{L}'-]{2,}$/u.test(first) ? first : "";
  return body
    .replace(/\{nome\}/gi, name)
    .replace(/ +([!,.?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}
