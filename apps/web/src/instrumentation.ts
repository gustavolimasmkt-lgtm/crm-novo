/** Ao subir o servidor: reprocessa de tempos em tempos eventos da Evolution que falharam. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { processPendingEvents } = await import("@crm/core");
  const { getDb } = await import("@crm/db");
  const g = globalThis as unknown as { __crmReprocessor?: NodeJS.Timeout };
  if (g.__crmReprocessor) return;
  g.__crmReprocessor = setInterval(() => {
    processPendingEvents(getDb()).catch((e) => console.error("[reprocessador]", e));
  }, 30_000);
  g.__crmReprocessor.unref?.();
}
