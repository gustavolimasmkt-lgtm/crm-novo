"use client";

import { useEffect } from "react";

/**
 * Celular com tela cheia (conversa aberta): no iPhone o teclado não encolhe a página, só cobre.
 * Acompanha a área visível de verdade em --vvh (altura) e --vvt (deslocamento) e trava a rolagem
 * do fundo, para a caixa de mensagem ficar sempre logo acima do teclado.
 */
export function useVisualViewport(active: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv || !window.matchMedia("(max-width: 767px)").matches) return;
    const root = document.documentElement;
    const set = () => {
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
      // Teclado aberto: tira a folga da barrinha do iPhone embaixo da caixa de mensagem.
      root.classList.toggle("kb-open", window.innerHeight - vv.height > 120);
    };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
      root.style.removeProperty("--vvh");
      root.style.removeProperty("--vvt");
      root.classList.remove("kb-open");
      document.body.style.overflow = prev;
    };
  }, [active]);
}
