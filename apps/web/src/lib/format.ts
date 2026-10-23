/** Funções de formatação usadas no navegador e no servidor. */

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const rest = d.slice(4);
    return `+55 (${d.slice(2, 4)}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }
  return d ? `+${d}` : "";
}

export function contactLabel(c: {
  contactName: string | null;
  contactPushName: string | null;
  contactPhone: string | null;
}) {
  return c.contactName || c.contactPushName || formatPhone(c.contactPhone) || "Contato";
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const longDayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Hora se for hoje, "Ontem", ou dia/mês. */
export function listTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return timeFmt.format(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Ontem";
  return dayFmt.format(d);
}

export function messageTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Hoje";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Ontem";
  const s = longDayFmt.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
