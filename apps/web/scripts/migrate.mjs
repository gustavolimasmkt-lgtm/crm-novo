// Aplica as migrações do banco antes de iniciar o servidor (usado no contêiner de produção).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "./drizzle" });
await client.end();
console.log("Migrações aplicadas.");
