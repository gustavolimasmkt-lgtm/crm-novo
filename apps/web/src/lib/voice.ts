"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Grava áudio no navegador (vai para o cliente como mensagem de voz do WhatsApp). */
export function useVoiceRecorder() {
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resolveRef = useRef<((f: File | null) => void) | null>(null);
  const discardRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const release = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
    recRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t0 = Date.now();
    const iv = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(iv);
  }, [recording]);

  useEffect(() => () => release(), [release]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não grava áudio.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
      discardRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const mime = (rec.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
        const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
        const file =
          discardRef.current || !chunksRef.current.length
            ? null
            : new File(chunksRef.current, `audio.${ext}`, { type: mime });
        release();
        resolveRef.current?.(file);
        resolveRef.current = null;
      };
      streamRef.current = stream;
      recRef.current = rec;
      rec.start(250);
      setRecording(true);
      return true;
    } catch {
      setError("Não consegui usar o microfone. Libere o acesso ao microfone para este site.");
      release();
      return false;
    }
  }, [release]);

  /** Para e devolve o arquivo gravado. */
  const stop = useCallback(
    () =>
      new Promise<File | null>((resolve) => {
        const rec = recRef.current;
        if (!rec) return resolve(null);
        resolveRef.current = resolve;
        rec.stop();
      }),
    [],
  );

  const cancel = useCallback(() => {
    discardRef.current = true;
    if (recRef.current) recRef.current.stop();
    else release();
  }, [release]);

  return { recording, seconds, error, start, stop, cancel };
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
