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
  sent: { instance: string; kind: string; to: string; body: Record<string, unknown> }[];
  /** Números que "não têm WhatsApp" na checagem. */
  withoutWhatsapp: Set<string>;
  /** Faz o envio falhar com 500 enquanto true. */
  failSends: boolean;
  incoming(
    name: string,
    msg: {
      from: string;
      text?: string;
      id?: string;
      pushName?: string;
      image?: boolean;
      audio?: boolean;
      fromMe?: boolean;
    },
  ): Promise<string>;
  ack(name: string, id: string, status: "DELIVERY_ACK" | "READ"): Promise<void>;
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
  const sent: FakeEvolution["sent"] = [];
  const withoutWhatsapp = new Set<string>();
  let seq = 0;

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
    if (req.method === "POST" && path === "/__test/incoming") {
      const b = ((await body(req)) ?? {}) as { text?: string; from?: string; audio?: boolean };
      const latest = [...instances.entries()]
        .filter(([n, i]) => n.startsWith("crm_") && i.state === "open")
        .at(-1)?.[0];
      if (!latest) return send(404, { error: "nenhuma instância conectada" });
      const id = await api.incoming(latest, {
        from: b.from ?? "5511988887777",
        text: b.text ?? "Olá!",
        audio: b.audio === true,
        pushName: "Cliente Teste",
      });
      return send(200, { ok: true, id });
    }
    if (req.method === "POST" && path === "/__test/ack-all") {
      for (const s of sent)
        await api.ack(s.instance, String((s.body as Record<string, unknown>).__id ?? ""), "READ");
      return send(200, { ok: true });
    }
    if (req.method === "GET" && path === "/__test/sent") {
      return send(200, sent);
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
    name = m(/^\/chat\/whatsappNumbers\/(.+)$/);
    if (req.method === "POST" && name) {
      const b = (await body(req)) as { numbers?: string[] } | null;
      return send(
        200,
        (b?.numbers ?? []).map((n) => ({
          number: n,
          exists: !withoutWhatsapp.has(n),
          jid: withoutWhatsapp.has(n) ? null : `${n}@s.whatsapp.net`,
        })),
      );
    }
    const sendM = path.match(/^\/message\/(sendText|sendMedia|sendWhatsAppAudio)\/(.+)$/);
    if (req.method === "POST" && sendM) {
      const b = ((await body(req)) ?? {}) as Record<string, unknown>;
      if (api.failSends) return send(500, { status: 500, error: "falha simulada" });
      const inst = sendM[2] ?? "";
      const id = `FAKE${++seq}`;
      sent.push({ instance: inst, kind: sendM[1] ?? "", to: String(b.number), body: { ...b, __id: id } });
      // Como a Evolution real, avisa o envio pelo webhook (eco).
      const echo = {
        key: { id, remoteJid: `${b.number}@s.whatsapp.net`, fromMe: true },
        message:
          sendM[1] === "sendText" ? { conversation: b.text } : { documentMessage: { fileName: b.fileName } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      };
      setTimeout(() => void notify(inst, "send.message", echo), 10);
      return send(201, {
        key: { id, remoteJid: `${b.number}@s.whatsapp.net`, fromMe: true },
        status: "PENDING",
      });
    }
    name = m(/^\/chat\/getBase64FromMediaMessage\/(.+)$/);
    if (req.method === "POST" && name) {
      return send(201, { base64: PNG_1PX, mimetype: "image/png", fileName: null });
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
    sent,
    withoutWhatsapp,
    failSends: false,
    async incoming(name, msg) {
      const id = msg.id ?? `IN${++seq}`;
      const message = msg.audio
        ? { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 4, ptt: true } }
        : msg.image
          ? { imageMessage: { mimetype: "image/jpeg", caption: msg.text ?? null } }
          : { conversation: msg.text ?? "" };
      await notify(name, "messages.upsert", {
        key: { id, remoteJid: `${msg.from}@s.whatsapp.net`, fromMe: msg.fromMe === true },
        pushName: msg.pushName ?? null,
        message,
        messageType: msg.audio ? "audioMessage" : msg.image ? "imageMessage" : "conversation",
        messageTimestamp: Math.floor(Date.now() / 1000),
      });
      return id;
    },
    async ack(name, id, status) {
      await notify(name, "messages.update", { keyId: id, status, fromMe: true });
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
  return api;
}
