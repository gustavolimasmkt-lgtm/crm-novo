import {
  auditLog,
  contacts,
  type Database,
  dealSources,
  deals,
  pipelineStages,
  pipelines,
  users,
} from "@crm/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { toCsv } from "../csv.js";
import { addDealTag, assignDeal, dealVisibility, deleteDeal, moveDeal, setDealQualification } from "./crm.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = <T extends z.ZodTypeAny>(t: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), t.optional());

export const dealFilterInput = z.object({
  pipelineId: opt(uuid),
  stageId: opt(uuid),
  status: opt(z.enum(["open", "won", "lost"])),
  assignedUserId: opt(z.union([uuid, z.literal("none")])),
  tagId: opt(uuid),
  sourceId: opt(uuid),
  qualification: opt(z.enum(["qualified", "disqualified", "none"])),
  fromAd: opt(z.coerce.boolean()),
  createdFrom: opt(day),
  createdTo: opt(day),
  /** Parado há pelo menos N dias (sem mensagem do cliente nem mudança de etapa). */
  idleDays: opt(z.coerce.number().int().min(1).max(3650)),
  q: opt(z.string().trim().max(100)),
  sort: opt(z.enum(["created", "activity", "value", "number", "title"])),
  dir: opt(z.enum(["asc", "desc"])),
  page: opt(z.coerce.number().int().min(1).max(10_000)),
});
export type DealFilter = z.input<typeof dealFilterInput>;

export const PAGE_SIZE = 50;

/** Última atividade: mudança de etapa ou mensagem do cliente (a que for mais recente). */
export const lastActivitySql = sql<Date>`greatest("deals"."stage_changed_at", coalesce((
  select max(m.sent_at) from messages m join conversations c on c.id = m.conversation_id
  where c.contact_id = "deals"."contact_id" and c.organization_id = "deals"."organization_id"
    and m.direction = 'in'), "deals"."created_at"))`;

/** Meia-noite de Brasília (UTC-3) do dia informado. */
const brDay = (d: string, plus = 0) => new Date(new Date(`${d}T03:00:00Z`).getTime() + plus * 86_400_000);

function conditions(actor: ActorU, organizationId: string, f: z.output<typeof dealFilterInput>) {
  const conds: (SQL | undefined)[] = [eq(deals.organizationId, organizationId), dealVisibility(actor)];
  if (f.pipelineId) conds.push(eq(deals.pipelineId, f.pipelineId));
  if (f.stageId) conds.push(eq(deals.stageId, f.stageId));
  if (f.status === "open") conds.push(sql`${pipelineStages.kind} in ('open','scheduled')`);
  if (f.status === "won") conds.push(eq(pipelineStages.kind, "won"));
  if (f.status === "lost") conds.push(eq(pipelineStages.kind, "lost"));
  if (f.assignedUserId === "none") conds.push(isNull(deals.assignedUserId));
  else if (f.assignedUserId) conds.push(eq(deals.assignedUserId, f.assignedUserId));
  if (f.tagId)
    conds.push(
      sql`exists (select 1 from deal_tags dt where dt.deal_id = "deals"."id" and dt.tag_id = ${f.tagId})`,
    );
  if (f.sourceId) conds.push(eq(deals.sourceId, f.sourceId));
  if (f.qualification === "none") conds.push(isNull(deals.qualification));
  else if (f.qualification) conds.push(eq(deals.qualification, f.qualification));
  if (f.fromAd) conds.push(or(isNotNull(deals.adId), isNotNull(deals.ctwaClid)));
  if (f.createdFrom) conds.push(gte(deals.createdAt, brDay(f.createdFrom)));
  if (f.createdTo) conds.push(lt(deals.createdAt, brDay(f.createdTo, 1)));
  if (f.idleDays) conds.push(sql`${lastActivitySql} < now() - make_interval(days => ${f.idleDays})`);
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(deals.title, `%${q}%`),
        ilike(deals.interest, `%${q}%`),
        ilike(contacts.name, `%${q}%`),
        ilike(contacts.pushName, `%${q}%`),
        digits.length >= 3 ? ilike(contacts.phone, `%${digits}%`) : undefined,
        /^\d+$/.test(q) ? eq(deals.number, Number(q)) : undefined,
      ),
    );
  }
  return and(...conds);
}

const columns = {
  id: deals.id,
  number: deals.number,
  title: deals.title,
  interest: deals.interest,
  valueCents: deals.valueCents,
  stageId: deals.stageId,
  stageName: pipelineStages.name,
  stageColor: pipelineStages.color,
  stageKind: pipelineStages.kind,
  pipelineName: pipelines.name,
  contactName: sql<string | null>`coalesce(${contacts.name}, ${contacts.pushName})`,
  contactPhone: contacts.phone,
  assignedUserId: deals.assignedUserId,
  assignedUserName: users.name,
  sourceName: dealSources.name,
  qualification: deals.qualification,
  qualificationReason: deals.qualificationReason,
  adTitle: deals.adTitle,
  createdAt: deals.createdAt,
  lastActivityAt: lastActivitySql,
  tagNames: sql<string[]>`coalesce((select array_agg(t.name order by t.name) from deal_tags dt
    join tags t on t.id = dt.tag_id where dt.deal_id = "deals"."id"), '{}')`,
};

function baseQuery(db: Database) {
  return db
    .select(columns)
    .from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(pipelines, eq(pipelines.id, deals.pipelineId))
    .leftJoin(users, eq(users.id, deals.assignedUserId))
    .leftJoin(dealSources, eq(dealSources.id, deals.sourceId));
}

function orderBy(f: z.output<typeof dealFilterInput>) {
  const dir = f.dir === "asc" ? asc : desc;
  switch (f.sort) {
    case "activity":
      return [dir(lastActivitySql), desc(deals.number)];
    case "value":
      return [dir(deals.valueCents), desc(deals.number)];
    case "number":
      return [dir(deals.number)];
    case "title":
      return [dir(sql`lower(${deals.title})`), desc(deals.number)];
    default:
      return [dir(deals.createdAt), desc(deals.number)];
  }
}

const daysAgo = (d: Date | string) =>
  Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

/** Lista paginada das negociações com filtros (tela Lista do CRM). */
export async function listDeals(db: Database, actor: ActorU, organizationId: string, raw: DealFilter) {
  const f = dealFilterInput.parse(raw);
  const where = conditions(actor, organizationId, f);
  const page = f.page ?? 1;
  const [rows, [{ n } = { n: 0 }]] = await Promise.all([
    baseQuery(db)
      .where(where)
      .orderBy(...orderBy(f))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(contacts, eq(contacts.id, deals.contactId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(where),
  ]);
  const showValues = can(actor, "deals.view_values");
  return {
    total: Number(n),
    page,
    pageSize: PAGE_SIZE,
    showValues,
    rows: rows.map((r) => ({
      ...r,
      valueCents: showValues ? Number(r.valueCents) : null,
      idleDays: daysAgo(r.lastActivityAt),
    })),
  };
}

const MAX_EXPORT = 20_000;
const QUAL_LABEL = { qualified: "Qualificado", disqualified: "Desqualificado" } as const;
const fmt = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

/** Planilha (CSV com ;) de tudo que bate com os filtros. Só gestor/admin. */
export async function exportDealsCsv(db: Database, actor: ActorU, organizationId: string, raw: DealFilter) {
  if (!can(actor, "reports.view")) throw new AppError("forbidden", "Só administradores e gestores exportam.");
  const f = dealFilterInput.parse(raw);
  const rows = await baseQuery(db)
    .where(conditions(actor, organizationId, f))
    .orderBy(...orderBy(f))
    .limit(MAX_EXPORT);
  const showValues = can(actor, "deals.view_values");
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "deal.exported",
    data: { total: rows.length, filters: f },
  });
  return toCsv([
    [
      "Número",
      "Título",
      "Carro / interesse",
      "Contato",
      "Telefone",
      "Funil",
      "Etapa",
      "Responsável",
      ...(showValues ? ["Valor"] : []),
      "Fonte",
      "Etiquetas",
      "Qualificação",
      "Motivo",
      "Anúncio",
      "Criada em",
      "Última atividade",
      "Dias parada",
    ],
    ...rows.map((r) => [
      String(r.number),
      r.title,
      r.interest ?? "",
      r.contactName ?? "",
      r.contactPhone ?? "",
      r.pipelineName,
      r.stageName,
      r.assignedUserName ?? "",
      ...(showValues ? [(Number(r.valueCents) / 100).toFixed(2).replace(".", ",")] : []),
      r.sourceName ?? "",
      (r.tagNames ?? []).join(", "),
      r.qualification ? QUAL_LABEL[r.qualification] : "",
      r.qualificationReason ?? "",
      r.adTitle ?? "",
      fmt(r.createdAt),
      fmt(r.lastActivityAt),
      String(daysAgo(r.lastActivityAt)),
    ]),
  ]);
}

export const bulkActionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), stageId: uuid }),
  z.object({ type: z.literal("assign"), userId: z.union([uuid, z.null()]) }),
  z.object({ type: z.literal("tag"), name: z.string().trim().min(1, "Informe a etiqueta.").max(40) }),
  z.object({
    type: z.literal("qualify"),
    value: z.enum(["qualified", "disqualified"]).nullable(),
    reason: z.string().max(200).nullable().optional(),
  }),
  z.object({ type: z.literal("delete") }),
]);
export const MAX_BULK = 1000;

/**
 * Ação em massa. Recebe os ids marcados ou "todos do filtro". Cada negociação passa pelas mesmas regras
 * da ação individual (permissão, histórico, fluxos e eventos para a Meta).
 */
export async function bulkDeals(
  db: Database,
  actor: ActorU,
  organizationId: string,
  target: { ids?: string[]; filter?: DealFilter },
  rawAction: z.input<typeof bulkActionInput>,
) {
  const action = bulkActionInput.parse(rawAction);
  if (action.type === "assign" && !can(actor, "deals.reassign"))
    throw new AppError("forbidden", "Só administradores e gestores trocam o responsável em massa.");
  if (action.type === "delete" && !can(actor, "deals.delete"))
    throw new AppError("forbidden", "Só administradores e gestores excluem negociações.");
  let ids: string[];
  if (target.filter) {
    const f = dealFilterInput.parse(target.filter);
    const rows = await db
      .select({ id: deals.id })
      .from(deals)
      .innerJoin(contacts, eq(contacts.id, deals.contactId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(conditions(actor, organizationId, f))
      .limit(MAX_BULK + 1);
    ids = rows.map((r) => r.id);
  } else {
    ids = [...new Set((target.ids ?? []).filter((i) => uuid.safeParse(i).success))];
    if (ids.length) {
      const ok = await db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.organizationId, organizationId), inArray(deals.id, ids), dealVisibility(actor)));
      ids = ok.map((r) => r.id);
    }
  }
  if (!ids.length) throw new AppError("validation", "Nenhuma negociação selecionada.");
  if (ids.length > MAX_BULK)
    throw new AppError("validation", `Máximo de ${MAX_BULK} negociações por vez. Filtre mais.`);
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      switch (action.type) {
        case "move":
          await moveDeal(db, actor, organizationId, id, action.stageId);
          break;
        case "assign":
          await assignDeal(db, actor, organizationId, id, action.userId);
          break;
        case "tag":
          await addDealTag(db, actor, organizationId, id, action.name);
          break;
        case "qualify":
          await setDealQualification(db, actor, organizationId, id, action.value, action.reason ?? null);
          break;
        case "delete":
          await deleteDeal(db, actor, organizationId, id);
          break;
      }
      done++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (action.type !== "delete")
    await db.insert(auditLog).values({
      organizationId,
      actorId: actor.userId,
      action: "deal.bulk",
      data: { type: action.type, total: ids.length, done },
    });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
  return { total: ids.length, done, failed: ids.length - done, error: errors[0] ?? null };
}
