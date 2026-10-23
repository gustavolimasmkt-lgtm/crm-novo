/**
 * API da Anthropic falsa, só para testes. Responde de forma previsível:
 * - se a última mensagem do cliente pede "humano"/"vendedor", chama a ferramenta de transferência;
 * - senão, responde "Resposta automática: <última mensagem>".
 */
import { createServer, type Server } from "node:http";

export type FakeAnthropic = {
  url: string;
  requests: Record<string, unknown>[];
  failNext: number;
  close(): Promise<void>;
};

export async function startFakeAnthropic(opts: { port?: number } = {}): Promise<FakeAnthropic> {
  const requests: Record<string, unknown>[] = [];
  const api: FakeAnthropic = {
    url: "",
    requests,
    failNext: 0,
    close: () => new Promise((r) => server.close(() => r())),
  };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.method !== "POST" || req.url !== "/v1/messages") return send(404, {});
      if (!req.headers["x-api-key"]) return send(401, { error: { message: "sem chave" } });
      if (api.failNext > 0) {
        api.failNext--;
        return send(529, { error: { message: "sobrecarregado" } });
      }
      const b = JSON.parse(body || "{}") as { messages?: { role: string; content: unknown }[] };
      requests.push(b as Record<string, unknown>);
      const lastMsg = [...(b.messages ?? [])].reverse().find((m) => m.role === "user");
      // Segunda rodada: recebeu o resultado da ferramenta e encerra com texto.
      if (Array.isArray(lastMsg?.content)) {
        return send(200, {
          content: [{ type: "text", text: "Tudo bem! Obrigado pelo contato." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 500, output_tokens: 10 },
        });
      }
      const last = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      const lastLine = last.split("\n").at(-1) ?? "";
      if (/não quero mais|desisti/i.test(lastLine)) {
        return send(200, {
          content: [
            { type: "tool_use", id: "t2", name: "mover_etapa", input: { etapa: "perdido" } },
            { type: "tool_use", id: "t3", name: "encerrar_atendimento", input: {} },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 800, output_tokens: 20 },
        });
      }
      if (/humano|vendedor|atendente/i.test(lastLine)) {
        return send(200, {
          content: [
            { type: "text", text: "Claro! Vou chamar um vendedor para continuar com você." },
            {
              type: "tool_use",
              id: "t1",
              name: "transferir_para_humano",
              input: { motivo: "Cliente pediu um vendedor" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 1200, output_tokens: 40 },
        });
      }
      send(200, {
        content: [{ type: "text", text: `Resposta automática: ${lastLine}` }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 30 },
      });
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const addr = server.address();
  api.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return api;
}
