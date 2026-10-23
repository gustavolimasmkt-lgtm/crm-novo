export type ErrorCode =
  | "invalid_credentials"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "expired"
  | "limit"
  | "integration";

/** Erro de regra de negócio com mensagem pronta para mostrar ao usuário. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
