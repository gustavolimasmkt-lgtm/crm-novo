/** "GreenCar Veículos" -> "greencar-veiculos" */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Iniciais para avatar: "Gustavo Lima" -> "GL" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** "bom dia" (5h às 11h59), "boa tarde" (12h às 17h59) ou "boa noite", no horário de Brasília. */
export function dayPeriod(now = new Date()): "bom dia" | "boa tarde" | "boa noite" {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (h >= 5 && h < 12) return "bom dia";
  if (h >= 12 && h < 18) return "boa tarde";
  return "boa noite";
}

const PERIOD_TAG = /#per[ií]odo-dia/gi;

/**
 * Troca a etiqueta #periodo-dia pela saudação do momento do envio (bom dia, boa tarde, boa noite).
 * No começo do texto ou de uma frase sai com maiúscula: "Bom dia".
 */
export function fillDayPeriod(text: string, now = new Date()): string {
  if (!text || !/#per[ií]odo-dia/i.test(text)) return text;
  const g = dayPeriod(now);
  return text.replace(PERIOD_TAG, (_m, offset: number, all: string) => {
    const before = all.slice(0, offset);
    const startOfSentence = /(^|[.!?]\s+|\n\s*)$/.test(before);
    return startOfSentence ? g.charAt(0).toUpperCase() + g.slice(1) : g;
  });
}
