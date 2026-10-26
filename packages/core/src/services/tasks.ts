import { contacts, type Database, deals, tasks, users } from "@crm/db";
import { and, asc, desc, eq, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";
import { notifyUser } from "./rotation.js";
import { brDateTime, formatBr } from "./schedule.js";

type ActorU = Actor & { userId: string };
const uuid = /^[0-9a-f-]{36}$/i;

export const taskInput = z.object({
  title: z.string().trim().min(1, "Escreva a tarefa.").max(200, "Título longo demais."),
  notes: z.string().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha o dia."),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Escolha a hora.")
    .default("09:00"),
  assignedUserId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
});

/** Quem vê a tarefa: gestor vê todas; vendedor, as dele e as que criou. */
function visible(actor: ActorU): SQL | undefined {
  if (can(actor, "deals.view_all")) return undefined;
  return or(eq(tasks.assignedUserId, actor.userId), eq(tasks.createdByUserId, actor.userId));
}

export async function createTask(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof taskInput>,
) {
  const input = taskInput.parse(raw);
  const dueAt = brDateTime(input.date, input.time);
  if (!dueAt) throw new AppError("validation", "Data inválida.");
  let contactId: string | null = null;
  if (input.dealId) {
    const d = await db.query.deals.findFirst({
      where: and(eq(deals.id, input.dealId), eq(deals.organizationId, organizationId)),
    });
    if (!d) throw new AppError("validation", "Negociação não encontrada.");
    if (!can(actor, "deals.view_all") && d.assignedUserId && d.assignedUserId !== actor.userId)
      throw new AppError("forbidden", "Essa negociação é de outra pessoa.");
    contactId = d.contactId;
  }
  // Vendedor só cria tarefa para si; gestor escolhe.
  const assigned = can(actor, "deals.reassign") ? (input.assignedUserId ?? actor.userId) : actor.userId;
  const [t] = await db
    .insert(tasks)
    .values({
      organizationId,
      title: input.title,
      notes: input.notes?.trim() || null,
      dueAt,
      assignedUserId: assigned,
      dealId: input.dealId ?? null,
      contactId,
      createdByUserId: actor.userId,
    })
    .returning({ id: tasks.id });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
  return t?.id ?? null;
}

export async function listTasks(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { mine?: boolean; done?: boolean; dealId?: string; limit?: number } = {},
) {
  const conds: (SQL | undefined)[] = [eq(tasks.organizationId, organizationId), visible(actor)];
  if (opts.mine) conds.push(eq(tasks.assignedUserId, actor.userId));
  if (opts.dealId) conds.push(eq(tasks.dealId, opts.dealId));
  if (opts.done === true) conds.push(isNotNull(tasks.doneAt));
  if (opts.done === false) conds.push(isNull(tasks.doneAt));
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      notes: tasks.notes,
      dueAt: tasks.dueAt,
      doneAt: tasks.doneAt,
      assignedUserId: tasks.assignedUserId,
      assignedUserName: users.name,
      dealId: tasks.dealId,
      dealTitle: deals.title,
      dealNumber: deals.number,
      contactName: sql<string | null>`coalesce(${contacts.name}, ${contacts.pushName}, ${contacts.phone})`,
      conversationId: sql<
        string | null
      >`(select c.id from conversations c where c.contact_id = ${tasks.contactId}
        order by c.last_message_at desc nulls last limit 1)`,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .where(and(...conds))
    .orderBy(opts.done ? desc(tasks.doneAt) : asc(tasks.dueAt))
    .limit(opts.limit ?? 200);
}

async function own(db: Database, actor: ActorU, organizationId: string, id: string) {
  if (!uuid.test(id)) throw new AppError("not_found", "Tarefa não encontrada.");
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId), visible(actor)));
  if (!t) throw new AppError("not_found", "Tarefa não encontrada.");
  return t;
}

export async function setTaskDone(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  done: boolean,
) {
  const t = await own(db, actor, organizationId, id);
  await db
    .update(tasks)
    .set({ doneAt: done ? new Date() : null, updatedAt: new Date() })
    .where(eq(tasks.id, t.id));
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

export async function deleteTask(db: Database, actor: ActorU, organizationId: string, id: string) {
  const t = await own(db, actor, organizationId, id);
  await db.delete(tasks).where(eq(tasks.id, t.id));
}

export async function countOverdueTasks(
  db: Database,
  actor: ActorU,
  organizationId: string,
  userId?: string | null,
) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        isNull(tasks.doneAt),
        lte(tasks.dueAt, new Date()),
        userId ? eq(tasks.assignedUserId, userId) : visible(actor),
      ),
    );
  return Number(r?.n ?? 0);
}

/** Na hora da tarefa, avisa o responsável no WhatsApp (uma vez). Chamado por um timer. */
export async function processTaskAlerts(db: Database, limit = 50) {
  const due = await db
    .update(tasks)
    .set({ notifiedAt: new Date() })
    .where(
      sql`${tasks.id} in (select t.id from tasks t where t.done_at is null and t.notified_at is null
        and t.due_at <= now() and t.due_at > now() - interval '1 day' and t.assigned_user_id is not null
        order by t.due_at limit ${limit})`,
    )
    .returning();
  for (const t of due) {
    const contact = t.contactId
      ? await db.query.contacts.findFirst({ where: eq(contacts.id, t.contactId) })
      : null;
    await notifyUser(
      db,
      t.organizationId,
      null,
      t.assignedUserId ?? "",
      `⏰ TAREFA: ${t.title}\nQuando: ${formatBr(t.dueAt)}${contact ? `\nCliente: ${contact.name ?? contact.pushName ?? contact.phone ?? ""}${contact.phone ? ` (${contact.phone})` : ""}` : ""}${t.notes ? `\nObs.: ${t.notes}` : ""}`,
    );
  }
  return due.length;
}
