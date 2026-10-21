import { isAppError } from "@crm/core";
import { ZodError } from "zod";

export type FormState = { ok?: boolean; error?: string; message?: string; data?: Record<string, string> };

/** Converte erros conhecidos em mensagem para a tela; erros inesperados viram mensagem genérica (e vão para o log). */
export function toFormError(e: unknown): FormState {
  if (isAppError(e)) return { error: e.message };
  if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Dados inválidos." };
  console.error(e);
  return { error: "Algo deu errado. Tente de novo em instantes." };
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
