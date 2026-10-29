"use client";

import { WifiOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { subscribeLive } from "@/lib/live";

type Alert = { id: string; name: string; since: string; noAnswer: boolean };

const hhmm = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Faixa vermelha em todas as telas enquanto algum WhatsApp da empresa estiver fora do ar. */
export function ConnectionBanner({ initial, canManage }: { initial: Alert[]; canManage: boolean }) {
  const [alerts, setAlerts] = useState(initial);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/conexoes/saude", { cache: "no-store" });
      if (r.ok) setAlerts(((await r.json()) as { alerts: Alert[] }).alerts);
    } catch {}
  }, []);
  useEffect(() => {
    const off = subscribeLive((ev) => {
      if (ev.t === "connection" || ev.t === "connection_down") load();
    });
    const t = setInterval(load, 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [load]);

  if (!alerts.length) return null;
  return (
    <div className="mb-4 space-y-2" data-testid="faixa-conexao">
      {alerts.map((a) => (
        <div
          key={a.id}
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] bg-danger px-4 py-3 text-[14px] text-white"
        >
          <WifiOff size={18} className="shrink-0" />
          <p className="min-w-0 flex-1">
            <b>WhatsApp "{a.name}" desconectado</b> desde {hhmm(a.since)}.{" "}
            {a.noAnswer
              ? "O servidor do WhatsApp não está respondendo."
              : "Mensagens de clientes nesse número não estão chegando."}
          </p>
          {canManage ? (
            <Link
              href="/conexoes"
              className="inline-flex h-8 items-center rounded-full bg-white px-3 font-semibold text-danger"
            >
              Reconectar
            </Link>
          ) : (
            <span className="text-[13px] text-white/90">Avise o administrador.</span>
          )}
        </div>
      ))}
    </div>
  );
}
