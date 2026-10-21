import { timingSafeEqual } from "node:crypto";
import { type Database, users } from "@crm/db";
import { eq, sql } from "drizzle-orm";
import { hashPassword, passwordProblem } from "../auth/crypto.js";
import { normalizeEmail } from "../text.js";
import { AppError } from "./errors.js";

export async function masterExists(db: Database): Promise<boolean> {
  const row = await db.query.users.findFirst({ where: eq(users.isMaster, true), columns: { id: true } });
  return !!row;
}

function sameToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Primeiro acesso: cria o Master uma única vez, protegido pelo SETUP_TOKEN do ambiente. */
export async function setupMaster(
  db: Database,
  input: { token: string; expectedToken: string | undefined; name: string; email: string; password: string },
) {
  if (!input.expectedToken || input.expectedToken.length < 24) {
    throw new AppError("forbidden", "Configuração inicial desativada neste ambiente.");
  }
  if (!sameToken(input.token, input.expectedToken))
    throw new AppError("forbidden", "Link de configuração inválido.");
  if (await masterExists(db)) throw new AppError("conflict", "O Master já foi criado. Faça login.");
  const problem = passwordProblem(input.password);
  if (problem) throw new AppError("validation", problem);
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("validation", "E-mail inválido.");
  const name = input.name.trim() || "Master";
  const existing = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
  const passwordHash = await hashPassword(input.password);
  if (existing) {
    await db.update(users).set({ isMaster: true, passwordHash, name }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, name, passwordHash, isMaster: true });
  }
  return { email };
}
