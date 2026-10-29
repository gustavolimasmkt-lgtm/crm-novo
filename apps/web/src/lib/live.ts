"use client";

/** Uma única conexão de tempo real (/api/eventos) por aba, compartilhada por todas as telas. */
type Listener = (ev: Record<string, unknown>) => void;
type StateListener = (open: boolean) => void;

let es: EventSource | null = null;
const listeners = new Set<Listener>();
const stateListeners = new Set<StateListener>();
let open = false;

function ensure() {
  if (es || typeof window === "undefined") return;
  es = new EventSource("/api/eventos");
  es.onopen = () => {
    open = true;
    for (const s of stateListeners) s(true);
  };
  es.onerror = () => {
    open = false;
    for (const s of stateListeners) s(false);
  };
  es.onmessage = (e) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const l of listeners) l(ev);
  };
}

/** Assina os eventos da empresa. Devolve a função para cancelar. */
export function subscribeLive(fn: Listener, onState?: StateListener) {
  ensure();
  listeners.add(fn);
  if (onState) {
    stateListeners.add(onState);
    onState(open);
  }
  return () => {
    listeners.delete(fn);
    if (onState) stateListeners.delete(onState);
    if (!listeners.size && es) {
      es.close();
      es = null;
      open = false;
    }
  };
}
