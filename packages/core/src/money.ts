/** "1.500,00", "1500", "R$ 1.500", "1500.5" -> centavos. Vazio ou inválido -> 0. */
export function parseMoneyToCents(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : 0;
  let s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g)?.length ?? 0) > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function formatCents(cents: number | null | undefined): string {
  return brl.format((cents ?? 0) / 100);
}

/** "20/10/2026, 11:10" ou "15/03/2025 14:30" ou "15/03/2025" (horário de Brasília) -> Date. */
export function parseBrDate(v: string | null | undefined): Date | null {
  const m = String(v ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h = "0", mi = "0"] = m;
  const iso = `${y}-${mo?.padStart(2, "0")}-${d?.padStart(2, "0")}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:00-03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
