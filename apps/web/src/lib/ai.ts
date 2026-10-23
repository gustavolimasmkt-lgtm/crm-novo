import "server-only";
import { type AiClient, AppError, createAnthropicClient } from "@crm/core";

let cached: AiClient | null = null;

export function getAi(): AiClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new AppError("integration", "A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.");
  cached ??= createAnthropicClient({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined });
  return cached;
}
