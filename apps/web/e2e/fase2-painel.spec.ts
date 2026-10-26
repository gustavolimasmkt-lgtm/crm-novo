import { expect, type Page, test } from "@playwright/test";

const MASTER = {
  email: process.env.E2E_MASTER_EMAIL ?? "master@local.test",
  password: process.env.E2E_MASTER_PASSWORD ?? "Master12345",
};
const FAKE = process.env.E2E_FAKE_EVOLUTION ?? "http://127.0.0.1:3199";
const run = Date.now().toString(36);

async function loginOk(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("painel de vendas: leads, origem, funil, filtros e visão da IA", async ({ page }, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const cliente = testInfo.project.name === "mobile" ? "5511955550002" : "5511955550001";
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Painel ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Painel");
  await page.getByLabel("E-mail do administrador").fill(`adm-painel-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // Painel vazio
  await expect(page.getByTestId("kpis")).toContainText("Leads novos0");
  await expect(page.getByTestId("esperando")).toContainText("Nenhum cliente esperando");
  await expect(page.getByTestId("origens")).toContainText("Nenhum lead no período");

  // Conecta e recebe um lead
  await page.goto("/conexoes");
  await page.getByLabel("Nome da conexão").fill("Loja");
  await page.getByRole("button", { name: "Criar e mostrar QR code" }).click();
  await expect(page.getByRole("dialog", { name: "Conectar Loja" })).toBeVisible();
  await fetch(`${FAKE}/__test/scan-latest`, { method: "POST" });
  await expect(page.getByText("WhatsApp conectado", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Concluir" }).click();
  await fetch(`${FAKE}/__test/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: cliente, text: "Oi, quero um carro" }),
  });

  await page.goto("/");
  await expect(page.getByTestId("kpis")).toContainText("Leads novos1");
  await expect(page.getByTestId("origens")).toContainText("WhatsApp direto");
  await expect(page.getByTestId("funil")).toContainText("Novo lead");
  await expect(page.getByTestId("sla")).toContainText("Sem nenhuma resposta1");
  await expect(page.getByTestId("equipe-painel")).toContainText("Admin Painel");
  await expect(page.getByTestId("ia-painel")).toContainText("Créditos do mês");

  // Filtros
  await page.getByRole("link", { name: "Mês passado" }).click();
  await page.waitForURL(/p=mes-passado/);
  await expect(page.getByTestId("kpis")).toContainText("Leads novos0");
  await page.getByRole("link", { name: "Este mês" }).click();
  await page.waitForURL(/p=mes$/);
  await page.getByLabel("Pessoa").selectOption({ label: "Admin Painel" });
  await page.waitForURL(/pessoa=/);
  await expect(page.getByText("Mostrando Admin Painel")).toBeVisible();
  await expect(page.getByTestId("equipe-painel")).toHaveCount(0);
  // O lead não tem responsável: não conta para o Admin.
  await expect(page.getByTestId("kpis")).toContainText("Leads novos0");
  await expect(page.getByRole("link", { name: "Este mês" })).toHaveClass(/bg-ink/);
  await page.screenshot({ path: `test-results/painel-${testInfo.project.name}.png`, fullPage: true });
});
