"use client";

import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Instalar o CRM como app (ícone na tela inicial, abre em tela cheia). */
export function InstallApp() {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  return (
    <section className="space-y-3 rounded-[var(--radius-card)] bg-surface p-5" data-testid="instalar-app">
      <div className="flex items-center gap-2">
        <Smartphone size={18} className="text-accent" />
        <h2 className="text-[17px] font-semibold">CRM como app no celular</h2>
      </div>
      {installed ? (
        <p className="text-[14px] text-ok">Você já está usando o CRM instalado como app.</p>
      ) : (
        <>
          <p className="text-[13px] text-ink-2">
            Fica com ícone na tela inicial e abre em tela cheia, sem a barra do navegador.
          </p>
          {prompt ? (
            <Button
              size="sm"
              onClick={async () => {
                await prompt.prompt();
                setPrompt(null);
              }}
            >
              Instalar agora
            </Button>
          ) : ios ? (
            <p className="text-[14px]">
              No iPhone, abra no <b>Safari</b>, toque em <b>Compartilhar</b> (quadrado com seta) e depois em{" "}
              <b>Adicionar à Tela de Início</b>.
            </p>
          ) : (
            <p className="text-[14px]">
              No Android, abra no <b>Chrome</b>, toque nos <b>três pontinhos</b> e em <b>Instalar app</b> (ou
              Adicionar à tela inicial).
            </p>
          )}
        </>
      )}
    </section>
  );
}
