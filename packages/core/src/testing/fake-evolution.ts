/**
 * Evolution API falsa, só para testes automatizados (unidade, integração e E2E).
 * Implementa as rotas que o CRM usa e já vem com uma instância "de outro sistema"
 * (GREENCAR) para provar que o CRM nunca mexe nela.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

type Inst = {
  state: "open" | "connecting" | "close";
  ownerJid: string | null;
  profileName: string | null;
  webhook: string | null;
  qrCount: number;
};

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export type FakeEvolution = {
  url: string;
  apiKey: string;
  instances: Map<string, Inst>;
  calls: { method: string; path: string }[];
  scan(name: string, phone?: string, notify?: boolean): Promise<void>;
  close(): Promise<void>;
};

function body(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
    });
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

export async function startFakeEvolution(
  opts: { port?: number; apiKey?: string } = {},
): Promise<FakeEvolution> {
  const apiKey = opts.apiKey ?? "chave-teste";
  const instances = new Map<string, Inst>();
  instances.set("GREENCAR", {
    state: "open",
    ownerJid: "554896229897@s.whatsapp.net",
    profileName: "GreenCar",
    webhook: "https://outro-sistema.example/webhook",
    qrCount: 0,
  });
  const calls: { method: string; path: string }[] = [];

  async function notify(name: string, event: string, data: unknown) {
    const i = instances.get(name);
    if (!i?.webhook) return;
    await fetch(i.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, instance: name, data, date_time: new Date().toISOString() }),
    }).catch(() => {});
  }

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const path = decodeURIComponent(u.pathname);
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    // Controle de teste: simula a leitura do QR pelo celular.
    const scanM = path.match(/^\/__test\/scan\/([^/]+)$/);
    if (req.method === "POST" && scanM) {
      await api.scan(scanM[1] ?? "", "5548996743297", true);
      return send(200, { ok: true });
    }
    if (req.method === "POST" && path === "/__test/scan-latest") {
      const latest = [...instances.keys()].filter((n) => n.startsWith("crm_")).at(-1);
      if (!latest) return send(404, { error: "nenhuma instância do CRM" });
      await api.scan(latest, "5548996743297", true);
      return send(200, { ok: true, instance: latest });
    }
    if (req.method === "GET" && path === "/__test/state") {
      return send(200, Object.fromEntries(instances));
    }
    calls.push({ method: req.method ?? "", path: path + u.search });
    if (req.headers.apikey !== apiKey) return send(401, { status: 401, error: "Unauthorized" });

    const m = (re: RegExp) => path.match(re)?.[1];
    if (req.method === "POST" && path === "/instance/create") {
      const b = (await body(req)) as { instanceName?: string } | null;
      const name = b?.instanceName ?? "";
      if (!name || instances.has(name))
        return send(403, { status: 403, response: { message: ["nome em uso"] } });
      instances.set(name, { state: "close", ownerJid: null, profileName: null, webhook: null, qrCount: 1 });
      return send(201, {
        instance: { instanceName: name, status: "created" },
        hash: "hash-instancia",
        qrcode: { base64: `data:image/png;base64,${PNG_1PX}`, code: "2@qr1", pairingCode: null, count: 1 },
      });
    }
    let name = m(/^\/webhook\/set\/(.+)$/);
    if (req.method === "POST" && name) {
      const i = instances.get(name);
      if (!i) return send(404, { status: 404 });
      const b = (await body(req)) as { webhook?: { url?: string } } | null;
      i.webhook = b?.webhook?.url ?? null;
      return send(201, { webhook: b?.webhook });
    }
    name = m(/^\/instance\/connect\/(.+)$/);
    if (req.method === "GET" && name) {
      const i = instances.get(name);
      if (!i) return send(404, { status: 404 });
      if (i.state === "open") return send(200, { instance: { instanceName: name, state: "open" } });
      i.state = "connecting";
      i.qrCount++;
      return send(200, {
        pairingCode: null,
        code: `2@qr${i.qrCount}`,
        base64: `data:image/png;base64,${PNG_1PX}`,
        count: i.qrCount,
      });
    }
    name = m(/^\/instance\/connectionState\/(.+)$/);
    if (req.method === "GET" && name) {
      const i = instances.get(name);
      if (!i) return send(404, { status: 404 });
      return send(200, { instance: { instanceName: name, state: i.state } });
    }
    if (req.method === "GET" && path === "/instance/fetchInstances") {
      const q = u.searchParams.get("instanceName");
      const list = [...instances.entries()]
        .filter(([n]) => !q || n === q)
        .map(([n, i]) => ({
          name: n,
          connectionStatus: i.state,
          ownerJid: i.ownerJid,
          profileName: i.profileName,
        }));
      return send(200, list);
    }
    name = m(/^\/instance\/logout\/(.+)$/);
    if (req.method === "DELETE" && name) {
      const i = instances.get(name);
      if (!i) return send(404, { status: 404 });
      i.state = "close";
      i.ownerJid = null;
      return send(200, { status: "SUCCESS" });
    }
    name = m(/^\/instance\/delete\/(.+)$/);
    if (req.method === "DELETE" && name) {
      if (!instances.delete(name)) return send(404, { status: 404 });
      return send(200, { status: "SUCCESS" });
    }
    send(404, { status: 404, path });
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const api: FakeEvolution = {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    instances,
    calls,
    async scan(name, phone = "5548996743297", doNotify = false) {
      const i = instances.get(name);
      if (!i) throw new Error(`instância ${name} não existe`);
      i.state = "open";
      i.ownerJid = `${phone}@s.whatsapp.net`;
      i.profileName = "Celular de teste";
      if (doNotify)
        await notify(name, "connection.update", {
          instance: name,
          state: "open",
          wuid: i.ownerJid,
          profileName: i.profileName,
        });
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
  return api;
}
