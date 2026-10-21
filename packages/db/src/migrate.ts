import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida");
const client = postgres(url, { max: 1 });
const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
await migrate(drizzle(client), { migrationsFolder: folder });
await client.end();
console.log("Migrações aplicadas.");
