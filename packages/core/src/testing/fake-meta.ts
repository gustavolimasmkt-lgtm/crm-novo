/** Graph API da Meta falsa, só para testes: conjunto de dados, eventos, conta de anúncios, insights e anúncios. */
import { createServer, type Server } from "node:http";

export type FakeMeta = {
  url: string;
  events: Record<string, unknown>[];
  failEvents: boolean;
  close(): Promise<void>;
};

export const FAKE_ADS = [
  {
    ad_id: "120001",
    ad_name: "HR-V prata vídeo",
    adset_name: "Criciúma 25-55",
    campaign_id: "9001",
    campaign_name: "Seminovos | WhatsApp",
    spend: "150.00",
  },
  {
    ad_id: "120002",
    ad_name: "Feirão carrossel",
    adset_name: "Região",
    campaign_id: "9002",
    campaign_name: "Feirão Outubro",
    spend: "80.50",
  },
];

export async function startFakeMeta(opts: { port?: number } = {}): Promise<FakeMeta> {
  const api: FakeMeta = {
    url: "",
    events: [],
    failEvents: false,
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
      const u = new URL(req.url ?? "/", "http://x");
      if (!u.searchParams.get("access_token"))
        return send(400, { error: { message: "An access token is required", code: 104 } });
      if (u.searchParams.get("access_token") === "token-ruim")
        return send(400, { error: { message: "Invalid OAuth access token.", code: 190 } });
      const path = u.pathname.replace(/^\/v[\d.]+\//, "");
      const ev = path.match(/^(\d+)\/events$/);
      if (req.method === "POST" && ev) {
        if (api.failEvents) return send(400, { error: { message: "Invalid parameter" } });
        const b = JSON.parse(body || "{}") as { data?: unknown[] };
        api.events.push({ dataset: ev[1], ...(b as object) });
        return send(200, { events_received: b.data?.length ?? 0, fbtrace_id: "x" });
      }
      const ins = path.match(/^act_(\d+)\/insights$/);
      if (req.method === "GET" && ins) return send(200, { data: FAKE_ADS });
      const acc = path.match(/^act_(\d+)$/);
      if (req.method === "GET" && acc)
        return send(200, { id: `act_${acc[1]}`, name: "Conta GreenCar", currency: "BRL" });
      const ad = FAKE_ADS.find((a) => a.ad_id === path);
      if (req.method === "GET" && ad)
        return send(200, {
          id: ad.ad_id,
          name: ad.ad_name,
          adset: { name: ad.adset_name },
          campaign: { id: ad.campaign_id, name: ad.campaign_name },
        });
      if (req.method === "GET" && /^\d+$/.test(path)) return send(200, { id: path, name: "Pixel da Loja" });
      send(404, { error: { message: "Unknown path" } });
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const addr = server.address();
  api.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return api;
}
