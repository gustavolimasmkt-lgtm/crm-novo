import "server-only";
import { AppError, createEvolutionClient, type EvolutionApi } from "@crm/core";

let cached: EvolutionApi | null = null;

/** Cliente da Evolution a partir das variáveis EVOLUTION_API_URL e EVOLUTION_API_KEY. */
export function getEvolution(): EvolutionApi {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new AppError("integration", "A Evolution API não está configurada no servidor.");
  }
  cached ??= createEvolutionClient({ baseUrl, apiKey });
  return cached;
}
