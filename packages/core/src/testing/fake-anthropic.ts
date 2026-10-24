/**
 * API da Anthropic falsa, só para testes. Responde de forma previsível:
 * - se a última mensagem do cliente pede "humano"/"vendedor", chama a ferramenta de transferência;
 * - "tem <termo>" busca no catálogo (e "foto" na mesma frase pede as fotos do primeiro achado);
 * - "horarios AAAA-MM-DD" consulta a agenda; "marcar visita AAAA-MM-DD HH:MM" marca;
 * - pedido de follow-up: "Oi! Ainda tem interesse?" (ou NAO_ENVIAR se o cliente se despediu);
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
      const b = JSON.parse(body || "{}") as {
        messages?: { role: string; content: unknown }[];
        tools?: { name: string }[];
      };
      requests.push(b as Record<string, unknown>);
      const offered = new Set((b.tools ?? []).map((t) => t.name));
      const lastMsg = [...(b.messages ?? [])].reverse().find((m) => m.role === "user");
      const userText = String(
        [...(b.messages ?? [])].reverse().find((m) => m.role === "user" && typeof m.content === "string")
          ?.content ?? "",
      )
        .split("\n")
        .at(-1);
      const tool = (id: string, name: string, input: Record<string, unknown>) =>
        send(200, {
          content: [{ type: "tool_use", id, name, input }],
          stop_reason: "tool_use",
          usage: { input_tokens: 600, output_tokens: 15 },
        });
      const text = (t: string) =>
        send(200, {
          content: [{ type: "text", text: t }],
          stop_reason: "end_turn",
          usage: { input_tokens: 500, output_tokens: 10 },
        });
      // Rodada seguinte: recebeu o resultado da ferramenta.
      if (Array.isArray(lastMsg?.content)) {
        const result = String(
          (lastMsg.content as { type: string; content?: unknown }[]).find((c) => c.type === "tool_result")
            ?.content ?? "",
        );
        const prev = [...(b.messages ?? [])].reverse().find((m) => m.role === "assistant");
        const prevTool = Array.isArray(prev?.content)
          ? String(
              (prev.content as { type: string; name?: string }[]).find((c) => c.type === "tool_use")?.name,
            )
          : "";
        if (prevTool === "buscar_catalogo") {
          const id = result.match(/id: ([0-9a-f-]{36})/)?.[1];
          if (id && /foto/i.test(userText ?? "") && offered.has("enviar_fotos"))
            return tool("t5", "enviar_fotos", { produto_id: id });
          return text(`Encontrei: ${id ? (result.split("\n")[1] ?? result) : result}`);
        }
        if (prevTool === "enviar_fotos") return text(`Segue! (${result})`);
        if (prevTool === "ver_horarios" || prevTool === "marcar_visita") return text(result);
        return text("Tudo bem! Obrigado pelo contato.");
      }
      const line = userText ?? "";
      // Follow-up: o sistema pede uma retomada.
      if (line.startsWith("[Aviso do sistema")) {
        const fromClient = (b.messages ?? []).filter(
          (m) => m.role === "user" && typeof m.content === "string",
        );
        const prevClient = String(fromClient.at(-2)?.content ?? "");
        return text(
          /tchau|não tenho interesse/i.test(prevClient)
            ? "NAO_ENVIAR"
            : "Oi! Ainda tem interesse? Posso ajudar?",
        );
      }
      const book = line.match(/marcar visita (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/i);
      if (book && offered.has("marcar_visita"))
        return tool("t6", "marcar_visita", { data_hora: book[1], observacao: "pelo teste" });
      const slots = line.match(/hor[aá]rios (\d{4}-\d{2}-\d{2})/i);
      if (slots && offered.has("ver_horarios")) return tool("t7", "ver_horarios", { data: slots[1] });
      const want = line.match(/\btem ([\w\- ]+?)(\?|$| manda| me)/i);
      if (want && offered.has("buscar_catalogo")) return tool("t4", "buscar_catalogo", { termo: want[1] });
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
