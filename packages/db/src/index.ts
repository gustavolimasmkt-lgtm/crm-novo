import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export * from "./schema/index.js";
export { schema };

export type Database = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL não definida");
  const client = postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 10), prepare: false });
  return drizzle(client, { schema, casing: "snake_case" });
}

const globalForDb = globalThis as unknown as { __crmDb?: Database };

/** Conexão única por processo (evita abrir várias no hot reload do Next). */
export function getDb(): Database {
  globalForDb.__crmDb ??= createDb();
  return globalForDb.__crmDb;
}
