"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { subscribeLive } from "@/lib/live";

const PREFS_KEY = "crm.avisos";
const DISMISS_KEY = "crm.avisos.pergunta";

export type NoticePrefs = { sound: boolean; desktop: boolean };

export function readPrefs(): NoticePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<NoticePrefs>;
    return { sound: v.sound !== false, desktop: v.desktop !== false };
  } catch {
    return { sound: true, desktop: true };
  }
}
export function writePrefs(p: NoticePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

let audio: AudioContext | null = null;
/** Libera o som (navegadores só tocam depois de um clique na página). */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {}
}
/** Dois toques curtos, gerados na hora (sem arquivo de áudio). */
export function playDing() {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    }
  } catch {}
}

export function showDesktopNotice(title: string, body: string, conversationId: string | null) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: conversationId ?? undefined });
    n.onclick = () => {
      window.focus();
      if (conversationId) window.location.href = `/conversas?c=${conversationId}`;
      n.close();
    };
  } catch {}
}

type Inbound = {
  t: "inbound";
  c: string | null;
  mine: boolean;
  n?: string;
  p?: string;
  ai: boolean;
  lead: boolean;
};

/**
 * Som, notificação do navegador e contador no título quando chega mensagem de cliente.
 * Fica montado em todas as telas do app. Não avisa se você já está olhando aquela conversa
 * ou se a IA vai responder (a não ser que seja lead novo).
 */
export function Notifier() {
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const hasApi = typeof Notification !== "undefined";
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    if (hasApi && Notification.permission === "default" && !dismissed) setAsk(true);

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    let unread = 0;
    const strip = () => document.title.replace(/^\(\d+\) /, "");
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        unread = 0;
        document.title = strip();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const off = subscribeLive((raw) => {
      const ev = raw as unknown as Inbound;
      if (raw.t === "connection_down") {
        const name = String(raw.n ?? "WhatsApp");
        if (readPrefs().sound) playDing();
        showDesktopNotice(
          `WhatsApp "${name}" desconectado`,
          "Mensagens de clientes não estão chegando. Reconecte em Conexões.",
          null,
        );
        return;
      }
      if (ev.t !== "inbound") return;
      if (ev.ai && !ev.lead) return;
      const viewing =
        document.visibilityState === "visible" &&
        window.location.pathname.startsWith("/conversas") &&
        new URLSearchParams(window.location.search).get("c") === ev.c;
      if (viewing) return;
      const prefs = readPrefs();
      if (prefs.sound) playDing();
      const title = ev.lead ? `Lead novo: ${ev.n ?? "cliente"}` : (ev.n ?? "Mensagem de cliente");
      if (document.visibilityState !== "visible") {
        unread++;
        document.title = `(${unread}) ${strip()}`;
        if (prefs.desktop) showDesktopNotice(title, ev.p ?? "", ev.c);
      }
    });
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", unlockAudio);
    };
  }, []);

  if (!ask) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setAsk(false);
  };
  return (
    <section
      className="mb-4 hidden items-center gap-3 rounded-[var(--radius-card)] bg-accent-soft px-4 py-2.5 text-[14px] md:flex"
      aria-label="Ativar avisos"
    >
      <Bell size={18} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1">
        <b>Avisar quando chegar mensagem?</b> Toca um som e aparece um aviso no computador, mesmo com o CRM em
        outra aba.
      </p>
      <Button
        size="sm"
        onClick={async () => {
          unlockAudio();
          try {
            await Notification.requestPermission();
          } catch {}
          playDing();
          close();
        }}
      >
        Ativar avisos
      </Button>
      <Button size="sm" variant="plain" onClick={close}>
        Agora não
      </Button>
    </section>
  );
}
