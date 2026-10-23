/**
 * Cliente mínimo da Evolution API v2 (WhatsApp via QR code).
 *
 * Isolamento: a mesma Evolution pode atender outros sistemas (ex.: o WhatsApp da loja).
 * Todo método recusa nomes de instância sem o prefixo do CRM, então este cliente
 * não consegue ler, desconectar nem apagar instâncias que não foram criadas por ele.
 * Não existe aqui nenhum método que liste todas as instâncias do servidor.
 */

export const INSTANCE_PREFIX = "crm_";

/** Eventos que o CRM assina no webhook de cada instância. */
export const WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
] as const;

export type EvolutionState = "open" | "connecting" | "close";

export type QrCode = { base64: string | null; pairingCode: string | null };

export type InstanceInfo = {
  state: EvolutionState;
  ownerJid: string | null;
  profileName: string | null;
};

export interface EvolutionApi {
  createInstance(instanceName: string): Promise<{ qr: QrCode | null }>;
  setWebhook(instanceName: string, url: string): Promise<void>;
  connect(instanceName: string): Promise<{ state: EvolutionState | null; qr: QrCode | null }>;
  connectionState(instanceName: string): Promise<EvolutionState>;
  fetchInstance(instanceName: string): Promise<InstanceInfo | null>;
  logout(instanceName: string): Promise<void>;
  deleteInstance(instanceName: string): Promise<void>;
}

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

export function assertOwnedInstance(instanceName: string) {
  if (!instanceName.startsWith(INSTANCE_PREFIX) || !/^[a-z0-9_-]{5,80}$/.test(instanceName)) {
    throw new EvolutionError(`Instância fora do CRM recusada: ${instanceName}`);
  }
}

function toState(v: unknown): EvolutionState {
  return v === "open" || v === "connecting" ? v : "close";
}

function toQr(v: unknown): QrCode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const base64 = typeof o.base64 === "string" && o.base64 ? o.base64 : null;
  const pairingCode = typeof o.pairingCode === "string" && o.pairingCode ? o.pairingCode : null;
  return base64 || pairingCode ? { base64, pairingCode } : null;
}

export function createEvolutionClient(opts: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): EvolutionApi {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  async function call(method: string, path: string, body?: unknown, allow404 = false): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: { apikey: opts.apiKey, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
    } catch (e) {
      throw new EvolutionError(`Evolution indisponível (${(e as Error).message})`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      const detail =
        json && typeof json === "object"
          ? JSON.stringify((json as Record<string, unknown>).response ?? json).slice(0, 300)
          : String(text).slice(0, 300);
      throw new EvolutionError(`Evolution respondeu ${res.status}: ${detail}`, res.status);
    }
    return json;
  }

  const enc = encodeURIComponent;

  return {
    async createInstance(instanceName) {
      assertOwnedInstance(instanceName);
      const r = (await call("POST", "/instance/create", {
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      })) as Record<string, unknown> | null;
      return { qr: toQr(r?.qrcode) };
    },

    async setWebhook(instanceName, url) {
      assertOwnedInstance(instanceName);
      try {
        // Formato da v2.2+
        await call("POST", `/webhook/set/${enc(instanceName)}`, {
          webhook: { enabled: true, url, byEvents: false, base64: false, events: [...WEBHOOK_EVENTS] },
        });
      } catch (e) {
        if (!(e instanceof EvolutionError) || e.status !== 400) throw e;
        // Formato das versões 2.0/2.1
        await call("POST", `/webhook/set/${enc(instanceName)}`, {
          enabled: true,
          url,
          webhookByEvents: false,
          webhookBase64: false,
          events: [...WEBHOOK_EVENTS],
        });
      }
    },

    async connect(instanceName) {
      assertOwnedInstance(instanceName);
      const r = (await call("GET", `/instance/connect/${enc(instanceName)}`)) as Record<
        string,
        unknown
      > | null;
      const inst = r?.instance as Record<string, unknown> | undefined;
      return { state: inst?.state ? toState(inst.state) : null, qr: toQr(r) };
    },

    async connectionState(instanceName) {
      assertOwnedInstance(instanceName);
      const r = (await call(
        "GET",
        `/instance/connectionState/${enc(instanceName)}`,
        undefined,
        true,
      )) as Record<string, unknown> | null;
      const inst = r?.instance as Record<string, unknown> | undefined;
      return toState(inst?.state);
    },

    async fetchInstance(instanceName) {
      assertOwnedInstance(instanceName);
      const r = await call(
        "GET",
        `/instance/fetchInstances?instanceName=${enc(instanceName)}`,
        undefined,
        true,
      );
      const list = Array.isArray(r) ? r : r ? [r] : [];
      // Confere o nome: nunca aproveita dados de outra instância.
      const found = list.find((i) => {
        const o = i as Record<string, unknown>;
        const name = o.name ?? (o.instance as Record<string, unknown> | undefined)?.instanceName;
        return name === instanceName;
      }) as Record<string, unknown> | undefined;
      if (!found) return null;
      const inner = (found.instance as Record<string, unknown> | undefined) ?? found;
      return {
        state: toState(inner.connectionStatus ?? inner.status ?? inner.state),
        ownerJid:
          typeof inner.ownerJid === "string"
            ? inner.ownerJid
            : typeof inner.owner === "string"
              ? inner.owner
              : null,
        profileName: typeof inner.profileName === "string" ? inner.profileName : null,
      };
    },

    async logout(instanceName) {
      assertOwnedInstance(instanceName);
      await call("DELETE", `/instance/logout/${enc(instanceName)}`, undefined, true);
    },

    async deleteInstance(instanceName) {
      assertOwnedInstance(instanceName);
      await call("DELETE", `/instance/delete/${enc(instanceName)}`, undefined, true);
    },
  };
}

/** "554896229897@s.whatsapp.net" -> "554896229897" */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const digits = jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

/** "554896229897" -> "(48) 9622-9897"; outros países ficam com +código. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return `+${d}`;
}
