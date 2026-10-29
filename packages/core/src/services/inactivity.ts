import { type Database, deals, inactivityRules, pipelineStages } from "@crm/db";
import { and, asc, eq, inArray, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { moveDealSystem } from "./crm.js";
import { lastActivitySql } from "./deal-list.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };

/** Por rodada e por regra: evita mover centenas de uma vez (e disparar fluxos em massa). */
const PER_RUN = 50;

export const inactivityInput = z.object({
  pipelineId: z.string().uuid("Escolha o funil."),
  fromStageIds: z.array(z.string().uuid()).max(50).default([]),
  days: z.coerce.number().int().min(1, "Mínimo 1 dia.").max(365, "Máximo 365 dias."),
  toStageId: z.string().uuid("Escolha para onde mover."),
  active: z.boolean().default(true),
});

function requireManage(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores configuram o CRM.");
}

async function validate(db: Database, organizationId: string, input: z.output<typeof inactivityInput>) {
  const stages = await db
    .select()
    .from(pipelineStages)
    .where(
      and(eq(pipelineStages.organizationId, organizationId), eq(pipelineStages.pipelineId, input.pipelineId)),
    );
  if (!stages.length) throw new AppError("validation", "Funil não encontrado.");
  if (!stages.some((s) => s.id === input.toStageId))
    throw new AppError("validation", "A etapa de destino precisa ser do mesmo funil.");
  const from = input.fromStageIds.filter((id) => id !== input.toStageId);
  if (from.some((id) => !stages.some((s) => s.id === id)))
    throw new AppError("validation", "Etapa de origem inválida.");
  return { ...input, fromStageIds: from };
}

function candidates(rule: {
  organizationId: string;
  pipelineId: string;
  fromStageIds: string[];
  days: number;
  toStageId: string;
}) {
  const conds: (SQL | undefined)[] = [
    eq(deals.organizationId, rule.organizationId),
    eq(deals.pipelineId, rule.pipelineId),
    ne(deals.stageId, rule.toStageId),
    rule.fromStageIds.length
      ? inArray(deals.stageId, rule.fromStageIds)
      : sql`${pipelineStages.kind} in ('open','scheduled')`,
    sql`${lastActivitySql} < now() - make_interval(days => ${rule.days})`,
  ];
  return and(...conds);
}

/** Quantas negociações a regra moveria agora (para mostrar antes de salvar). */
export async function previewInactivityRule(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof inactivityInput>,
) {
  requireManage(actor);
  const input = await validate(db, organizationId, inactivityInput.parse(raw));
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(candidates({ ...input, organizationId }));
  return Number(r?.n ?? 0);
}

export async function listInactivityRules(db: Database, organizationId: string) {
  return db
    .select()
    .from(inactivityRules)
    .where(eq(inactivityRules.organizationId, organizationId))
    .orderBy(asc(inactivityRules.createdAt));
}

export async function saveInactivityRule(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof inactivityInput>,
  id?: string,
) {
  requireManage(actor);
  const input = await validate(db, organizationId, inactivityInput.parse(raw));
  if (id) {
    const [r] = await db
      .update(inactivityRules)
      .set(input)
      .where(and(eq(inactivityRules.id, id), eq(inactivityRules.organizationId, organizationId)))
      .returning({ id: inactivityRules.id });
    if (!r) throw new AppError("not_found", "Regra não encontrada.");
    return r.id;
  }
  const count = await db.$count(inactivityRules, eq(inactivityRules.organizationId, organizationId));
  if (count >= 20) throw new AppError("validation", "Limite de 20 regras.");
  const [r] = await db
    .insert(inactivityRules)
    .values({ organizationId, ...input })
    .returning({ id: inactivityRules.id });
  return r?.id;
}

export async function deleteInactivityRule(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireManage(actor);
  if (!z.string().uuid().safeParse(id).success) return;
  await db
    .delete(inactivityRules)
    .where(and(eq(inactivityRules.id, id), eq(inactivityRules.organizationId, organizationId)));
}

/** Timer: aplica as regras ativas. Cada movimento entra no histórico e dispara fluxos da etapa. */
export async function processInactivity(db: Database) {
  const rules = await db.select().from(inactivityRules).where(eq(inactivityRules.active, true));
  let moved = 0;
  for (const rule of rules) {
    const rows = await db
      .select({ id: deals.id })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(candidates(rule))
      .orderBy(asc(lastActivitySql))
      .limit(PER_RUN);
    for (const d of rows) {
      try {
        if (
          await moveDealSystem(db, rule.organizationId, d.id, rule.toStageId, `parada há ${rule.days}+ dias`)
        )
          moved++;
      } catch (e) {
        console.error("[inatividade]", (e as Error).message);
      }
    }
    if (rows.length) await notifyOrg(db, { o: rule.organizationId, t: "conversation" });
  }
  return moved;
}
