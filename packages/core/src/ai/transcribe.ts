/**
 * Voz para texto em qualquer API compatível com a da OpenAI (/audio/transcriptions):
 * OpenAI (whisper-1) ou Groq (whisper-large-v3-turbo).
 */
export interface Transcriber {
  transcribe(data: Buffer, mime: string, fileName: string): Promise<string>;
}

export class TranscribeError extends Error {
  override name = "TranscribeError";
}

export function createTranscriber(opts: { apiKey: string; baseUrl?: string; model?: string }): Transcriber {
  const base = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = opts.model || "whisper-1";
  return {
    async transcribe(data, mime, fileName) {
      if (data.length > 24 * 1024 * 1024) throw new TranscribeError("Áudio grande demais para transcrever.");
      const fd = new FormData();
      const name = /\.\w+$/.test(fileName) ? fileName : `${fileName}.ogg`;
      fd.set("file", new Blob([new Uint8Array(data)], { type: mime.split(";")[0] || "audio/ogg" }), name);
      fd.set("model", model);
      fd.set("language", "pt");
      fd.set("response_format", "json");
      const r = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(60_000),
      });
      const j = (await r.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
      if (!r.ok) throw new TranscribeError(`Transcrição falhou (${r.status}): ${j.error?.message ?? "erro"}`);
      return String(j.text ?? "");
    },
  };
}
