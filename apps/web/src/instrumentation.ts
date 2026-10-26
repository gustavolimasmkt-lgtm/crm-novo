/**
 * Ao subir o servidor:
 * - reprocessa eventos da Evolution que falharam (a cada 30 s);
 * - envia os avisos de WhatsApp para a equipe (a cada 5 s);
 * - lembra os clientes das visitas e avisa tarefas na hora (a cada 20 s);
 * - follow-up: a IA retoma clientes que pararam de responder (a cada 20 s, respeitando o anti-bloqueio);
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

  const { EVOLUTION_API_URL: evoUrl, EVOLUTION_API_KEY: evoKey } = process.env;
  if (evoUrl && evoKey) {
    const evo = core.createEvolutionClient({ baseUrl: evoUrl, apiKey: evoKey });
    let sending = false;
    setInterval(async () => {
      if (sending) return;
      sending = true;
      try {
        await core.processOutbox(getDb(), evo);
      } catch (e) {
        console.error("[avisos]", e);
      } finally {
        sending = false;
      }
    }, 5_000).unref?.();
    let reminding = false;
    setInterval(async () => {
      if (reminding) return;
      reminding = true;
      try {
        await core.processReminders(getDb(), evo);
        await core.processTaskAlerts(getDb());
      } catch (e) {
        console.error("[lembretes]", e);
      } finally {
        reminding = false;
      }
    }, 20_000).unref?.();
  }

  const {
    EVOLUTION_API_URL,
    EVOLUTION_API_KEY,
    ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL,
    ANTHROPIC_WORKSPACE_ID,
  } = process.env;
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !ANTHROPIC_API_KEY) {
    console.warn("[agente] desligado: falta EVOLUTION_API_URL, EVOLUTION_API_KEY ou ANTHROPIC_API_KEY");
    return;
  }
  const deps = {
    evo: core.createEvolutionClient({ baseUrl: EVOLUTION_API_URL, apiKey: EVOLUTION_API_KEY }),
    ai: core.createAnthropicClient({
      apiKey: ANTHROPIC_API_KEY,
      baseUrl: ANTHROPIC_BASE_URL || undefined,
      workspaceId: ANTHROPIC_WORKSPACE_ID || undefined,
    }),
    stt: process.env.TRANSCRIBE_API_KEY
      ? core.createTranscriber({
          apiKey: process.env.TRANSCRIBE_API_KEY,
          baseUrl: process.env.TRANSCRIBE_BASE_URL || undefined,
          model: process.env.TRANSCRIBE_MODEL || undefined,
        })
      : undefined,
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
  let following = false;
  setInterval(async () => {
    if (following) return;
    following = true;
    try {
      await core.processFollowups(getDb(), deps);
    } catch (e) {
      console.error("[follow-up]", e);
    } finally {
      following = false;
    }
  }, 20_000).unref?.();
}
