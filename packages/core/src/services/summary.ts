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

const summarySchema = z.object({
  resumo: z.string().min(1).max(1200),
  interesse: z.string().max(300).nullable().catch(null),
  temperatura: z.enum(["quente", "morno", "frio"]).catch("morno"),
  nota: z.coerce.number().min(0).max(10).catch(5),
  proximo_passo: z.string().max(400).nullable().catch(null),
  objecoes: z.string().max(400).nullable().catch(null),
});

const SYSTEM = `Você analisa atendimentos de WhatsApp de uma empresa de vendas para a equipe comercial.
Responda só com JSON válido, sem texto antes ou depois, neste formato:
{"resumo": "3 a 5 frases: quem é o cliente, o que quer, o que já foi dito e onde a conversa parou",
 "interesse": "produto ou serviço de interesse, ou null",
 "temperatura": "quente" | "morno" | "frio",
 "nota": número de 0 a 10 (chance de fechar),
 "proximo_passo": "ação concreta e curta para o vendedor, ou null",
 "objecoes": "objeções ou dúvidas do cliente (preço, prazo, entrada...), ou null"}
Quente: quer fechar ou visitar logo. Morno: interessado, sem urgência. Frio: só curiosidade, sumiu ou recusou.
Use só o que está na conversa. Não invente valores, nomes ou fatos.`;

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
  const r = await ai.chat({
    model: SUMMARY_MODEL,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Empresa: ${org?.name ?? ""}\nCliente: ${contact?.name ?? contact?.pushName ?? "sem nome"}\n\nConversa:\n${lines.slice(-30_000)}`,
      },
    ],
    maxTokens: 600,
  });
  await recordUsage(db, organizationId, conversationId, "summary", SUMMARY_MODEL, r);
  const json = r.text.match(/\{[\s\S]*\}/)?.[0];
  let parsed: z.infer<typeof summarySchema>;
  try {
    parsed = summarySchema.parse(JSON.parse(json ?? ""));
  } catch {
    throw new AppError("integration", "A IA não devolveu um resumo válido. Tente de novo.");
  }
  const summary: LeadSummary = {
    resumo: parsed.resumo.trim(),
    interesse: parsed.interesse?.trim() || null,
    temperatura: parsed.temperatura,
    nota: Math.round(parsed.nota),
    proximoPasso: parsed.proximo_passo?.trim() || null,
    objecoes: parsed.objecoes?.trim() || null,
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
