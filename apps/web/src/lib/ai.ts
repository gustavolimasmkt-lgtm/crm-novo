import "server-only";
import {
  type AiClient,
  AppError,
  createAnthropicClient,
  createTranscriber,
  type Transcriber,
} from "@crm/core";

let cached: AiClient | null = null;

export function getAi(): AiClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new AppError("integration", "A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.");
  cached ??= createAnthropicClient({
    apiKey,
    baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
    workspaceId: process.env.ANTHROPIC_WORKSPACE_ID || undefined,
  });
  return cached;
}

let stt: Transcriber | null = null;

/** Transcrição de áudio (OpenAI ou Groq). Null se TRANSCRIBE_API_KEY não estiver configurada. */
export function getTranscriber(): Transcriber | null {
  const apiKey = process.env.TRANSCRIBE_API_KEY;
  if (!apiKey) return null;
  stt ??= createTranscriber({
    apiKey,
    baseUrl: process.env.TRANSCRIBE_BASE_URL || undefined,
    model: process.env.TRANSCRIBE_MODEL || undefined,
  });
  return stt;
}
