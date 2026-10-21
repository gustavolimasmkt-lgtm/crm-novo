import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://crm:crm@localhost:5432/crm_test";
  execSync("pnpm --filter @crm/db migrate", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
