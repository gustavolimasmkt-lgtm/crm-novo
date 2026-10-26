import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "./services/errors.js";

/** Chave derivada de APP_SECRET (variável do servidor). Sem ela, não guardamos tokens de terceiros. */
function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16)
    throw new AppError(
      "integration",
      "Falta a variável APP_SECRET no servidor (texto aleatório com 32+ caracteres) para guardar tokens com segurança.",
    );
  return createHash("sha256").update(`crm:${secret}`).digest();
}

/** Criptografa (AES-256-GCM). Formato: v1.iv.tag.dados (base64url). */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

export function decryptSecret(enc: string) {
  const [v, iv, tag, data] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !data)
    throw new AppError("integration", "Token guardado em formato inválido.");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new AppError(
      "integration",
      "Não consegui ler o token guardado (APP_SECRET mudou?). Cadastre o token de novo.",
    );
  }
}

export function sha256(v: string) {
  return createHash("sha256").update(v).digest("hex");
}
