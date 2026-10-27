import {
  contacts,
  conversations,
  type Database,
  dealEvents,
  deals,
  type FlowStep,
  flowRuns,
  flows,
  messages,
  pipelineStages,
  scheduledMessages,
  tags,
  tasks,
  users,
} from "@crm/db";
import { and, asc, desc, eq, gt, inArray, lte, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import type { EvolutionApi } from "../whatsapp/evolution.js";
import { conversationFor, getFollowupSettings, inWindow, reserveAutomatedSend } from "./automations.js";
import { getConversation, sendAiMessage } from "./conversations.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";
import { conversationLink, notifyUser } from "./rotation.js";

type ActorU = Actor & { userId: string };
const uuid = /^[0-9a-f-]{36}$/i;
const MAX_WAIT_MIN = 60 * 24 * 60; // 60 dias

function requireManage(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores criam e editam fluxos.");
}

const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    text: z.string().trim().min(1, "Escreva a mensagem do passo.").max(2000, "Mensagem longa demais."),
  }),
  z.object({
    type: z.literal("wait"),
    minutes: z.coerce
      .number()
      .int()
      .min(1, "Espera mínima: 1 minuto.")
      .max(MAX_WAIT_MIN, "Espera máxima: 60 dias."),
  }),
  z.object({ type: z.literal("move_stage"), stageId: z.string().uuid("Escolha a etapa.") }),
  z.object({
    type: z.literal("task"),
    title: z.string().trim().min(1, "Escreva a tarefa.").max(200),
    dueMinutes: z.coerce.number().int().min(0).max(MAX_WAIT_MIN).default(0),
  }),
  z.object({
    type: z.literal("notify"),
    text: z.string().trim().min(1, "Escreva o aviso.").max(1000),
  }),
]);

export const flowInput = z.object({
  name: z.string().trim().min(1, "Dê um nome ao fluxo.").max(80),
  trigger: z.enum(["manual", "lead_created", "stage_entered", "tag_added"]),
  triggerStageId: z.string().uuid().nullable().default(null),
  triggerTagId: z.string().uuid().nullable().default(null),
  stopOnReply: z.boolean().default(true),
  steps: z.array(stepSchema).min(1, "Adicione pelo menos um passo.").max(20, "No máximo 20 passos."),
});

async function validateRefs(db: Database, organizationId: string, input: z.infer<typeof flowInput>) {
  if (input.trigger === "stage_entered" && !input.triggerStageId)
    throw new AppError("validation", "Escolha a etapa que dispara o fluxo.");
  if (input.trigger === "tag_added" && !input.triggerTagId)
    throw new AppError("validation", "Escolha a etiqueta que dispara o fluxo.");
  if (!input.steps.some((s) => s.type === "message" || s.type === "notify" || s.type === "task"))
    throw new AppError("validation", "O fluxo precisa de pelo menos uma mensagem, aviso ou tarefa.");
  const stageIds = [
    ...input.steps.flatMap((s) => (s.type === "move_stage" ? [s.stageId] : [])),
    ...(input.trigger === "stage_entered" && input.triggerStageId ? [input.triggerStageId] : []),
  ];
  if (stageIds.length) {
    const found = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.organizationId, organizationId), inArray(pipelineStages.id, stageIds)));
    if (found.length !== new Set(stageIds).size) throw new AppError("validation", "Etapa inválida.");
  }
  if (input.trigger === "tag_added" && input.triggerTagId) {
    const t = await db.query.tags.findFirst({
      where: and(eq(tags.id, input.triggerTagId), eq(tags.organizationId, organizationId)),
    });
    if (!t) throw new AppError("validation", "Etiqueta inválida.");
  }
}

export async function saveFlow(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string | null,
  raw: z.input<typeof flowInput>,
) {
  requireManage(actor);
  const input = flowInput.parse(raw);
  await validateRefs(db, organizationId, input);
  const values = {
    name: input.name,
    trigger: input.trigger,
    triggerStageId: input.trigger === "stage_entered" ? input.triggerStageId : null,
    triggerTagId: input.trigger === "tag_added" ? input.triggerTagId : null,
    stopOnReply: input.stopOnReply,
    steps: input.steps as FlowStep[],
    updatedAt: new Date(),
  };
  if (id) {
    if (!uuid.test(id)) throw new AppError("not_found", "Fluxo não encontrado.");
    const r = await db
      .update(flows)
      .set(values)
      .where(and(eq(flows.id, id), eq(flows.organizationId, organizationId)))
      .returning({ id: flows.id });
    if (!r.length) throw new AppError("not_found", "Fluxo não encontrado.");
    return id;
  }
  const [f] = await db
    .insert(flows)
    .values({ organizationId, ...values, createdByUserId: actor.userId })
    .returning({ id: flows.id });
  return f?.id ?? null;
}

async function ownFlow(db: Database, organizationId: string, id: string) {
  if (!uuid.test(id)) throw new AppError("not_found", "Fluxo não encontrado.");
  const f = await db.query.flows.findFirst({
    where: and(eq(flows.id, id), eq(flows.organizationId, organizationId)),
  });
  if (!f) throw new AppError("not_found", "Fluxo não encontrado.");
  return f;
}

export async function setFlowActive(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  active: boolean,
) {
  requireManage(actor);
  const f = await ownFlow(db, organizationId, id);
  await db
    .update(flows)
    .set({
      active,
      activatedAt: active ? (f.active ? f.activatedAt : new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(flows.id, f.id));
  if (!active)
    await db
      .update(flowRuns)
      .set({ status: "stopped", stopReason: "fluxo desligado", finishedAt: new Date() })
      .where(and(eq(flowRuns.flowId, f.id), eq(flowRuns.status, "active")));
}

export async function deleteFlow(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireManage(actor);
  const f = await ownFlow(db, organizationId, id);
  await db.delete(flows).where(eq(flows.id, f.id));
}

export async function listFlows(db: Database, organizationId: string) {
  const rows = await db
    .select({
      id: flows.id,
      name: flows.name,
      active: flows.active,
      trigger: flows.trigger,
      triggerStageId: flows.triggerStageId,
      triggerTagId: flows.triggerTagId,
      stopOnReply: flows.stopOnReply,
      steps: flows.steps,
      updatedAt: flows.updatedAt,
      running: sql<number>`(select count(*)::int from flow_runs r where r.flow_id = "flows"."id" and r.status = 'active')`,
      finished: sql<number>`(select count(*)::int from flow_runs r where r.flow_id = "flows"."id" and r.status = 'done')`,
      stopped: sql<number>`(select count(*)::int from flow_runs r where r.flow_id = "flows"."id" and r.status in ('stopped','failed'))`,
    })
    .from(flows)
    .where(eq(flows.organizationId, organizationId))
    .orderBy(desc(flows.active), asc(flows.name));
  return rows.map((r) => ({
    ...r,
    running: Number(r.running),
    finished: Number(r.finished),
    stopped: Number(r.stopped),
  }));
}

/** Inicia o fluxo para o contato da conversa (botão na conversa). */
export async function startFlow(
  db: Database,
  actor: ActorU,
  organizationId: string,
  flowId: string,
  conversationId: string,
) {
  const f = await ownFlow(db, organizationId, flowId);
  if (!f.active) throw new AppError("validation", "Ligue o fluxo antes de usar.");
  const conv = await getConversation(db, actor, organizationId, conversationId);
  const deal = await db
    .select({ id: deals.id })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(eq(deals.contactId, conv.contactId), sql`${pipelineStages.kind} not in ('won','lost')`))
    .orderBy(desc(deals.updatedAt))
    .limit(1);
  const [r] = await db
    .insert(flowRuns)
    .values({
      organizationId,
      flowId: f.id,
      contactId: conv.contactId,
      dealId: deal[0]?.id ?? null,
      triggerKey: `manual:${crypto.randomUUID()}`,
      startedByUserId: actor.userId,
    })
    .onConflictDoNothing()
    .returning({ id: flowRuns.id });
  if (!r) throw new AppError("validation", "Esse fluxo já está rodando para este cliente.");
  await notifyOrg(db, { o: organizationId, t: "message", c: conv.id });
  return r.id;
}

export async function stopRun(db: Database, actor: ActorU, organizationId: string, runId: string) {
  if (!uuid.test(runId)) throw new AppError("not_found", "Execução não encontrada.");
  const run = await db.query.flowRuns.findFirst({
    where: and(eq(flowRuns.id, runId), eq(flowRuns.organizationId, organizationId)),
  });
  if (!run || run.status !== "active") throw new AppError("not_found", "Execução não encontrada.");
  if (!can(actor, "deals.view_all")) {
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.contactId, run.contactId),
    });
    if (conv?.assignedUserId && conv.assignedUserId !== actor.userId)
      throw new AppError("forbidden", "Esse cliente é de outra pessoa.");
  }
  await db
    .update(flowRuns)
    .set({ status: "stopped", stopReason: "parado pela equipe", finishedAt: new Date() })
    .where(eq(flowRuns.id, run.id));
}

/** Fluxos ativos de um contato (mostrados na conversa). */
export async function listContactRuns(db: Database, organizationId: string, contactId: string) {
  const rows = await db
    .select({
      id: flowRuns.id,
      flowName: flows.name,
      stepIndex: flowRuns.stepIndex,
      nextAt: flowRuns.nextAt,
      steps: flows.steps,
    })
    .from(flowRuns)
    .innerJoin(flows, eq(flows.id, flowRuns.flowId))
    .where(
      and(
        eq(flowRuns.organizationId, organizationId),
        eq(flowRuns.contactId, contactId),
        eq(flowRuns.status, "active"),
      ),
    );
  return rows.map(({ steps, ...r }) => ({
    ...r,
    totalSteps: steps.length,
    next: describeStep(steps[r.stepIndex]),
  }));
}

export function describeStep(s: FlowStep | undefined) {
  if (!s) return "fim";
  switch (s.type) {
    case "message":
      return `mensagem: ${s.text.slice(0, 80)}`;
    case "wait":
      return `esperar ${waitLabel(s.minutes)}`;
    case "move_stage":
      return "mover etapa";
    case "task":
      return `tarefa: ${s.title}`;
    case "notify":
      return "avisar responsável";
  }
}

export function waitLabel(min: number) {
  if (min % 1440 === 0) return `${min / 1440} dia(s)`;
  if (min % 60 === 0) return `${min / 60} hora(s)`;
  return `${min} min`;
}

// ---------------------------------------------------------------- execução

/** Cria execuções a partir do histórico das negociações (lead novo, mudança de etapa, etiqueta). */
export async function queueFlowTriggers(db: Database) {
  const r = await db.execute(sql`
    insert into flow_runs (organization_id, flow_id, contact_id, deal_id, trigger_key, next_at)
    select f.organization_id, f.id, d.contact_id, d.id, 'ev:' || e.id, now()
    from flows f
    join deal_events e on e.organization_id = f.organization_id
    join deals d on d.id = e.deal_id
    join contacts ct on ct.id = d.contact_id
    where f.active and f.trigger <> 'manual'
      and e.created_at >= f.activated_at and e.created_at > now() - interval '1 day'
      and not ct.opt_out
      and ((f.trigger = 'lead_created' and e.type = 'created')
        or (f.trigger = 'stage_entered' and e.type = 'stage' and e.data->>'toId' = f.trigger_stage_id::text)
        or (f.trigger = 'tag_added' and e.type = 'tags' and (e.data->'added') ? f.trigger_tag_id::text))
    on conflict do nothing
    returning id`);
  return r.length;
}

function firstName(c: { name: string | null; pushName: string | null } | null) {
  const n = (c?.name || c?.pushName || "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,}$/u.test(n) ? n : "";
}

function fillText(t: string, contact: { name: string | null; pushName: string | null } | null) {
  return t
    .replace(/\{nome\}/gi, firstName(contact))
    .replace(/ +([!,.?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

type Run = typeof flowRuns.$inferSelect;
type Flow = typeof flows.$inferSelect;

/** Motivo para parar antes do próximo passo (ou null para seguir). */
async function stopReasonFor(db: Database, run: Run, flow: Flow) {
  if (!flow.active) return "fluxo desligado";
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, run.contactId) });
  if (!contact) return "contato apagado";
  if (contact.optOut) return "cliente pediu para sair";
  if (run.dealId) {
    const [d] = await db
      .select({ kind: pipelineStages.kind })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(eq(deals.id, run.dealId));
    if (d?.kind === "won" || d?.kind === "lost")
      return d.kind === "won" ? "negociação ganha" : "negociação perdida";
  }
  if (flow.stopOnReply) {
    const [m] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(conversations.contactId, run.contactId),
          eq(messages.direction, "in"),
          gt(messages.createdAt, run.startedAt),
        ),
      )
      .limit(1);
    if (m) return "cliente respondeu";
  }
  return null;
}

async function assigneeOf(db: Database, run: Run, flow: Flow) {
  if (run.dealId) {
    const d = await db.query.deals.findFirst({ where: eq(deals.id, run.dealId) });
    if (d?.assignedUserId) return d.assignedUserId;
  }
  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.contactId, run.contactId),
    orderBy: desc(conversations.lastMessageAt),
  });
  return conv?.assignedUserId ?? run.startedByUserId ?? flow.createdByUserId ?? null;
}

/** Executa os passos que venceram. Chamado por um timer (mensagens passam pela fila anti-bloqueio). */
export async function processFlows(db: Database, evo: EvolutionApi, limit = 30) {
  await queueFlowTriggers(db);
  const due = await db
    .select({ run: flowRuns, flow: flows })
    .from(flowRuns)
    .innerJoin(flows, eq(flows.id, flowRuns.flowId))
    .where(and(eq(flowRuns.status, "active"), lte(flowRuns.nextAt, new Date())))
    .orderBy(asc(flowRuns.nextAt))
    .limit(limit);
  const out: { runId: string; result: string }[] = [];
  for (const { run, flow } of due) {
    // Reserva a execução (outro ciclo não pega a mesma).
    const claimed = await db
      .update(flowRuns)
      .set({ nextAt: new Date(Date.now() + 5 * 60_000) })
      // Ainda vencida = ninguém pegou (comparar o horário exato falha: o banco guarda microssegundos).
      .where(and(eq(flowRuns.id, run.id), lte(flowRuns.nextAt, new Date()), eq(flowRuns.status, "active")))
      .returning({ id: flowRuns.id });
    if (!claimed.length) continue;
    let step = run.stepIndex;
    let nextAt = new Date();
    let finished: { status: "done" | "stopped" | "failed"; reason: string | null } | null = null;
    let sent = false;
    try {
      for (let guard = 0; guard < 10; guard++) {
        const reason = await stopReasonFor(db, run, flow);
        if (reason) {
          finished = { status: "stopped", reason };
          break;
        }
        const s = flow.steps[step];
        if (!s) {
          finished = { status: "done", reason: null };
          break;
        }
        if (s.type === "wait") {
          nextAt = new Date(Date.now() + s.minutes * 60_000);
          step++;
          break;
        }
        if (s.type === "message") {
          if (sent) break; // uma mensagem por ciclo: a próxima espera a vez na fila
          const pace = await getFollowupSettings(db, run.organizationId);
          if (!inWindow(pace)) {
            nextAt = new Date(Date.now() + 15 * 60_000);
            break;
          }
          const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, run.contactId) });
          const deal = run.dealId
            ? await db.query.deals.findFirst({ where: eq(deals.id, run.dealId) })
            : null;
          if (!contact) throw new Error("contato não encontrado");
          const convId = await conversationFor(db, run.organizationId, contact, deal?.connectionId ?? null);
          const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, convId) });
          if (!conv || !(await reserveAutomatedSend(db, conv.connectionId, pace))) break; // tenta no próximo ciclo
          await sendAiMessage(db, evo, run.organizationId, convId, fillText(s.text, contact), {
            automation: "flow",
            typing: true,
            byUserId: run.startedByUserId ?? flow.createdByUserId ?? undefined,
          });
          sent = true;
          step++;
          continue;
        }
        if (s.type === "move_stage" && run.dealId) {
          const d = await db.query.deals.findFirst({ where: eq(deals.id, run.dealId) });
          const to = await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, s.stageId) });
          if (d && to && to.id !== d.stageId && to.pipelineId === d.pipelineId) {
            const from = await db.query.pipelineStages.findFirst({ where: eq(pipelineStages.id, d.stageId) });
            await db
              .update(deals)
              .set({
                stageId: to.id,
                stageChangedAt: new Date(),
                closedAt: to.kind === "won" || to.kind === "lost" ? new Date() : null,
                updatedAt: new Date(),
              })
              .where(eq(deals.id, d.id));
            await db.insert(dealEvents).values({
              organizationId: run.organizationId,
              dealId: d.id,
              type: "stage",
              data: {
                from: from?.name ?? null,
                to: to.name,
                toId: to.id,
                kind: to.kind,
                via: `fluxo ${flow.name}`,
              },
            });
          }
        } else if (s.type === "task") {
          const userId = await assigneeOf(db, run, flow);
          await db.insert(tasks).values({
            organizationId: run.organizationId,
            title: s.title,
            notes: `Criada pelo fluxo ${flow.name}`,
            dueAt: new Date(Date.now() + s.dueMinutes * 60_000),
            assignedUserId: userId,
            dealId: run.dealId,
            contactId: run.contactId,
            createdByUserId: flow.createdByUserId,
          });
        } else if (s.type === "notify") {
          const userId = await assigneeOf(db, run, flow);
          const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, run.contactId) });
          const conv = await db.query.conversations.findFirst({
            where: eq(conversations.contactId, run.contactId),
            orderBy: desc(conversations.lastMessageAt),
          });
          const link = conv ? conversationLink(conv.id) : "";
          if (userId)
            await notifyUser(
              db,
              run.organizationId,
              conv?.connectionId ?? null,
              userId,
              `⚡ ${flow.name.toUpperCase()}\nCliente: ${contact?.name ?? contact?.pushName ?? contact?.phone ?? ""}\n${fillText(s.text, contact ?? null)}${link ? `\nAbrir conversa: ${link}` : ""}`,
            );
        }
        step++;
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      console.error(`[fluxo] ${run.id}:`, msg);
      finished = { status: "failed", reason: msg };
    }
    await db
      .update(flowRuns)
      .set(
        finished
          ? { status: finished.status, stopReason: finished.reason, stepIndex: step, finishedAt: new Date() }
          : { stepIndex: step, nextAt },
      )
      .where(eq(flowRuns.id, run.id));
    out.push({ runId: run.id, result: finished ? finished.status : `passo-${step}` });
  }
  if (out.length) {
    const orgs = new Set(due.map((d) => d.run.organizationId));
    for (const o of orgs) await notifyOrg(db, { o, t: "conversation" });
  }
  return out;
}

// ---------------------------------------------------------------- programadas (tela Agendadas)

/** Tudo que vai sair: mensagens agendadas e próximos passos de fluxos. Vendedor vê só os clientes dele. */
export async function listUpcoming(
  db: Database,
  actor: ActorU,
  organizationId: string,
  opts: { mine?: boolean } = {},
) {
  const viewAll = can(actor, "deals.view_all") && !opts.mine;
  const convVisible: SQL | undefined = viewAll
    ? undefined
    : or(eq(conversations.assignedUserId, actor.userId), eq(scheduledMessages.createdByUserId, actor.userId));
  const sched = await db
    .select({
      id: scheduledMessages.id,
      at: scheduledMessages.sendAt,
      body: scheduledMessages.body,
      conversationId: scheduledMessages.conversationId,
      contactName: sql<string | null>`coalesce(${contacts.name}, ${contacts.pushName}, ${contacts.phone})`,
      byName: users.name,
    })
    .from(scheduledMessages)
    .innerJoin(conversations, eq(conversations.id, scheduledMessages.conversationId))
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(users, eq(users.id, scheduledMessages.createdByUserId))
    .where(
      and(
        eq(scheduledMessages.organizationId, organizationId),
        eq(scheduledMessages.status, "pending"),
        convVisible,
      ),
    )
    .orderBy(asc(scheduledMessages.sendAt))
    .limit(300);
  const runs = await db.execute<{
    id: string;
    next_at: string;
    step_index: number;
    steps: FlowStep[];
    flow_name: string;
    contact_name: string | null;
    conversation_id: string | null;
    assigned_user_id: string | null;
  }>(sql`
    select r.id, r.next_at, r.step_index, f.steps, f.name as flow_name,
           coalesce(ct.name, ct.push_name, ct.phone) as contact_name,
           c.id as conversation_id, c.assigned_user_id
    from flow_runs r
    join flows f on f.id = r.flow_id
    join contacts ct on ct.id = r.contact_id
    left join lateral (select id, assigned_user_id from conversations c where c.contact_id = r.contact_id
                       order by c.last_message_at desc nulls last limit 1) c on true
    where r.organization_id = ${organizationId}::uuid and r.status = 'active'
    order by r.next_at
    limit 300`);
  const items = [
    ...sched.map((s) => ({
      kind: "scheduled" as const,
      id: s.id,
      at: s.at,
      text: s.body,
      contactName: s.contactName,
      conversationId: s.conversationId,
      detail: s.byName ? `agendada por ${s.byName}` : "agendada",
    })),
    ...runs
      .filter((r) => viewAll || r.assigned_user_id === actor.userId)
      .map((r) => {
        // Próxima mensagem do fluxo a partir do passo atual (somando esperas no caminho).
        let at = new Date(r.next_at).getTime();
        let text: string | null = null;
        for (let i = r.step_index; i < r.steps.length; i++) {
          const s = r.steps[i];
          if (s?.type === "wait") at += s.minutes * 60_000;
          if (s?.type === "message") {
            text = s.text;
            break;
          }
        }
        return {
          kind: "flow" as const,
          id: r.id,
          at: new Date(at),
          text: text ?? describeStep(r.steps[r.step_index]),
          contactName: r.contact_name,
          conversationId: r.conversation_id,
          detail: `fluxo ${r.flow_name} · passo ${r.step_index + 1} de ${r.steps.length}`,
        };
      }),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}
