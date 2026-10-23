/**
 * Ao subir o servidor:
 * - reprocessa eventos da Evolution que falharam (a cada 30 s);
 * - envia as respostas agendadas do agente de IA (a cada 3 s).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const core = await import("@crm/core");
  const { getDb } = await import("@crm/db");
  const g = globalThis as unknown as { __crmTimers?: boolean };
  if (g.__crmTimers) return;
  g.__crmTimers = true;

  setInterval(() => {
    core.processPendingEvents(getDb()).catch((e) => console.error("[reprocessador]", e));
  }, 30_000).unref?.();

  const { EVOLUTION_API_URL, EVOLUTION_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL } = process.env;
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !ANTHROPIC_API_KEY) {
    console.warn("[agente] desligado: falta EVOLUTION_API_URL, EVOLUTION_API_KEY ou ANTHROPIC_API_KEY");
    return;
  }
  const deps = {
    evo: core.createEvolutionClient({ baseUrl: EVOLUTION_API_URL, apiKey: EVOLUTION_API_KEY }),
    ai: core.createAnthropicClient({ apiKey: ANTHROPIC_API_KEY, baseUrl: ANTHROPIC_BASE_URL || undefined }),
  };
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await core.processAiJobs(getDb(), deps);
    } catch (e) {
      console.error("[agente]", e);
    } finally {
      running = false;
    }
  }, 3_000).unref?.();
}
