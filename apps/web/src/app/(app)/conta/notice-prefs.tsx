"use client";

import { useEffect, useState } from "react";
import { type NoticePrefs, playDing, readPrefs, showDesktopNotice, writePrefs } from "@/components/notifier";
import { Button, Notice } from "@/components/ui";

type Perm = "granted" | "denied" | "default" | "unsupported";

export function NoticePrefsForm() {
  const [prefs, setPrefs] = useState<NoticePrefs>({ sound: true, desktop: true });
  const [perm, setPerm] = useState<Perm>("default");
  useEffect(() => {
    setPrefs(readPrefs());
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  const update = (p: NoticePrefs) => {
    setPrefs(p);
    writePrefs(p);
  };
  return (
    <section className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5" data-testid="avisos-navegador">
      <div>
        <h2 className="text-[17px] font-semibold">Avisos neste navegador</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Quando chega mensagem de cliente seu ou sem dono (gestor recebe de todos). Não avisa se você já está
          na conversa ou se a IA vai responder. Vale só para este computador ou celular.
        </p>
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input
          type="checkbox"
          checked={prefs.sound}
          onChange={(e) => update({ ...prefs, sound: e.target.checked })}
          className="size-4 accent-[var(--accent)]"
        />
        Tocar som
      </label>
      <label className="flex items-center gap-2 text-[15px]">
        <input
          type="checkbox"
          checked={prefs.desktop}
          onChange={(e) => update({ ...prefs, desktop: e.target.checked })}
          className="size-4 accent-[var(--accent)]"
        />
        Mostrar aviso quando o CRM estiver em outra aba
      </label>
      {perm === "denied" && (
        <Notice>
          O navegador está bloqueando os avisos deste site. Libere no cadeado ao lado do endereço, em
          Notificações.
        </Notice>
      )}
      {perm === "unsupported" && (
        <Notice tone="accent">
          Este navegador não mostra avisos. No iPhone, só funciona com o CRM adicionado à Tela de Início.
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        {perm === "default" && (
          <Button
            size="sm"
            onClick={async () => {
              setPerm(await Notification.requestPermission());
            }}
          >
            Permitir avisos do navegador
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (prefs.sound) playDing();
            if (prefs.desktop) showDesktopNotice("Teste de aviso", "Assim aparece uma mensagem nova.", null);
          }}
        >
          Testar
        </Button>
      </div>
    </section>
  );
}
