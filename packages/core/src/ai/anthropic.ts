/** Cliente mínimo da API de mensagens da Anthropic (Claude). */

export const AI_MODELS = [
  { id: "claude-haiku-5-5", label: "Rápido e econômico (Haiku 5.5)" },
  { id: "claude-sonnet-5-5", label: "Equilibrado, recomendado (Sonnet 5.5)" },
  { id: "claude-opus-5-5", label: "Mais capaz e mais caro (Opus 5.5)" },
] as const;
export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

export type ContentBlock = Record<string, unknown>;
export type ChatMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
export type ChatResult = {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  /** Conteúdo bruto da resposta (para devolver junto com os resultados das ferramentas). */
  content: ContentBlock[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
};

export interface AiClient {
  chat(opts: {
    model: string;
    system: string;
    messages: ChatMessage[];
    tools?: ToolDef[];
    maxTokens?: number;
  }): Promise<ChatResult>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export function createAnthropicClient(opts: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): AiClient {
  const base = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async chat({ model, system, messages, tools, maxTokens }) {
      let res: Response;
      try {
        res = await doFetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens ?? 800,
            system,
            messages,
            ...(tools?.length ? { tools } : {}),
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
      } catch (e) {
        throw new AiError(`IA indisponível (${(e as Error).message})`);
      }
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const err = (j?.error as Record<string, unknown> | undefined)?.message;
        throw new AiError(`IA respondeu ${res.status}: ${String(err ?? "erro").slice(0, 300)}`, res.status);
      }
      const content = Array.isArray(j?.content) ? (j?.content as Record<string, unknown>[]) : [];
      const usage = (j?.usage ?? {}) as Record<string, number>;
      return {
        text: content
          .filter((c) => c.type === "text")
          .map((c) => String(c.text ?? ""))
          .join("\n")
          .trim(),
        toolCalls: content
          .filter((c) => c.type === "tool_use")
          .map((c) => ({
            id: String(c.id),
            name: String(c.name),
            input: (c.input ?? {}) as Record<string, unknown>,
          })),
        content,
        stopReason: typeof j?.stop_reason === "string" ? j.stop_reason : null,
        inputTokens:
          Number(usage.input_tokens ?? 0) +
          Number(usage.cache_read_input_tokens ?? 0) +
          Number(usage.cache_creation_input_tokens ?? 0),
        outputTokens: Number(usage.output_tokens ?? 0),
      };
    },
  };
}
