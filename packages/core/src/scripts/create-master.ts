/**
 * Cria (ou atualiza a senha de) o usuário Master da plataforma.
 * Uso: MASTER_EMAIL=... MASTER_PASSWORD=... MASTER_NAME="Gustavo Lima" pnpm --filter @crm/core create-master
 */
import { createDb, users } from "@crm/db";
import { sql } from "drizzle-orm";
import { hashPassword, passwordProblem } from "../auth/crypto.js";
import { normalizeEmail } from "../text.js";

const email = normalizeEmail(process.env.MASTER_EMAIL ?? "");
const password = process.env.MASTER_PASSWORD ?? "";
const name = process.env.MASTER_NAME ?? "Master";
if (!email || !password) throw new Error("Defina MASTER_EMAIL e MASTER_PASSWORD");
const problem = passwordProblem(password);
if (problem) throw new Error(problem);

const db = createDb();
const passwordHash = await hashPassword(password);
const existing = await db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });
if (existing) {
  await db.update(users).set({ isMaster: true, passwordHash, name }).where(sql`${users.id} = ${existing.id}`);
  console.log(`Master atualizado: ${email}`);
} else {
  await db.insert(users).values({ email, name, passwordHash, isMaster: true });
  console.log(`Master criado: ${email}`);
}
process.exit(0);
