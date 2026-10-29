import {
  contacts,
  conversations,
  type Database,
  type LeadSummary,
  messages,
  organizations,
  users,
} from "@crm/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AiClient } from "../ai/anthropic.js";
import type { Actor } from "../auth/permissions.js";
import { getAiUsage, recordUsage } from "./agent.js";
import { getConversation } from "./conversations.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };
/** Resumo usa o modelo rápido: é tarefa simples e roda muito. */
const SUMMARY_MODEL = "claude-haiku-5-5";

const clip = (max: number) =>
  z
    .unknown()
    .transform((v) => (typeof v === "string" ? v.trim().slice(0, max) : null))
    .catch(null);
const summarySchema = z.object({
  resumo: z
    .string()
    .trim()
    .min(1)
    .transform((v) => v.slice(0, 1200)),
  interesse: clip(300),
  temperatura: z
    .string()
    .transform((v) => v.toLowerCase().trim())
    .pipe(z.enum(["quente", "morno", "frio"]))
    .catch("morno"),
  nota: z.coerce.number().min(0).max(10).catch(5),
  proximo_passo: clip(400),
  objecoes: clip(400),
});

const SUMMARY_TOOL = {
  name: "registrar_resumo",
  description: "Registra o resumo do atendimento para a equipe comercial.",
  input_schema: {
    type: "object",
    properties: {
      resumo: {
        type: "string",
        description: "3 a 5 frases: quem é o cliente, o que quer, o que já foi dito e onde a conversa parou",
      },
      interesse: { type: ["string", "null"], description: "produto ou serviço de interesse, ou null" },
      temperatura: { type: "string", enum: ["quente", "morno", "frio"] },
      nota: { type: "integer", minimum: 0, maximum: 10, description: "chance de fechar, de 0 a 10" },
      proximo_passo: {
        type: ["string", "null"],
        description: "ação concreta e curta para o vendedor, ou null",
      },
      objecoes: {
        type: ["string", "null"],
        description: "objeções ou dúvidas do cliente (preço, prazo, entrada...), ou null",
      },
    },
    required: ["resumo", "interesse", "temperatura", "nota", "proximo_passo", "objecoes"],
  },
};

const SYSTEM = `Você analisa atendimentos de WhatsApp de uma empresa de vendas para a equipe comercial.
Registre o resumo com a ferramenta registrar_resumo.
Quente: quer fechar ou visitar logo. Morno: interessado, sem urgência. Frio: só curiosidade, sumiu ou recusou.
Use só o que está na conversa. Não invente valores, nomes ou fatos.`;

/** Lê o resumo da chamada da ferramenta; se a IA respondeu em texto, tenta achar o JSON. */
function readSummary(r: { toolCalls: { input: Record<string, unknown> }[]; text: string }) {
  const input = r.toolCalls[0]?.input;
  if (input) {
    const ok = summarySchema.safeParse(input);
    if (ok.success) return ok.data;
  }
  const json = r.text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const ok = summarySchema.safeParse(JSON.parse(json));
    return ok.success ? ok.data : null;
  } catch {
    return null;
  }
}

function who(m: { direction: string; sentByAi: boolean; internal: boolean; userName: string | null }) {
  if (m.internal) return "[nota da equipe]";
  if (m.direction === "in") return "Cliente";
  return m.sentByAi ? "Loja (IA)" : `Loja${m.userName ? ` (${m.userName.split(" ")[0]})` : ""}`;
}

/** Gera (e guarda) o resumo do atendimento. Com actor, confere a permissão de ver a conversa. */
export async function summarizeConversation(
  db: Database,
  ai: AiClient,
  organizationId: string,
  conversationId: string,
  actor: ActorU | null = null,
): Promise<LeadSummary> {
  if (actor) await getConversation(db, actor, organizationId, conversationId);
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
  });
  if (!conv) throw new AppError("not_found", "Conversa não encontrada.");
  const usage = await getAiUsage(db, organizationId);
  if (usage.exhausted) throw new AppError("limit", "Os créditos de IA deste mês acabaram.");
  const rows = await db
    .select({
      direction: messages.direction,
      type: messages.type,
      body: messages.body,
      transcript: messages.transcript,
      sentByAi: messages.sentByAi,
      internal: messages.internal,
      userName: users.name,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sentByUserId))
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(80);
  if (!rows.some((r) => r.direction === "in"))
    throw new AppError("validation", "O cliente ainda não escreveu nada.");
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, conv.contactId) });
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  const lines = rows
    .reverse()
    .map((r) => {
      const content =
        r.type === "text"
          ? r.body
          : r.type === "audio"
            ? `[áudio] ${r.transcript ?? "(não transcrito)"}`
            : `[${r.type}]${r.body ? ` ${r.body}` : ""}`;
      return `${who(r)}: ${content ?? ""}`;
    })
    .join("\n");
  const ask = () =>
    ai.chat({
      model: SUMMARY_MODEL,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Empresa: ${org?.name ?? ""}\nCliente: ${contact?.name ?? contact?.pushName ?? "sem nome"}\n\nConversa:\n${lines.slice(-30_000)}`,
        },
      ],
      tools: [SUMMARY_TOOL],
      toolChoice: SUMMARY_TOOL.name,
      maxTokens: 1200,
    });
  let parsed: z.infer<typeof summarySchema> | null = null;
  // Uma segunda tentativa automática antes de mostrar erro.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const r = await ask();
    await recordUsage(db, organizationId, conversationId, "summary", SUMMARY_MODEL, r);
    parsed = readSummary(r);
    if (!parsed)
      console.error(
        `[resumo] resposta inválida (tentativa ${attempt + 1}, stop=${r.stopReason}):`,
        JSON.stringify(r.toolCalls[0]?.input ?? r.text).slice(0, 400),
      );
  }
  if (!parsed) throw new AppError("integration", "A IA não devolveu um resumo válido. Tente de novo.");
  const summary: LeadSummary = {
    resumo: parsed.resumo.trim(),
    interesse: parsed.interesse || null,
    temperatura: parsed.temperatura,
    nota: Math.round(parsed.nota),
    proximoPasso: parsed.proximo_passo || null,
    objecoes: parsed.objecoes || null,
  };
  await db
    .update(conversations)
    .set({ aiSummary: summary, aiSummaryAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await notifyOrg(db, { o: organizationId, t: "conversation", c: conversationId });
  return summary;
}

export function summaryText(s: LeadSummary) {
  return [
    `Resumo: ${s.resumo}`,
    s.interesse ? `Interesse: ${s.interesse}` : null,
    `Temperatura: ${s.temperatura} (nota ${s.nota}/10)`,
    s.objecoes ? `Objeções: ${s.objecoes}` : null,
    s.proximoPasso ? `Próximo passo: ${s.proximoPasso}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
