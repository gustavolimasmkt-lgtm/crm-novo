import { expect, type Page, test } from "@playwright/test";

const MASTER = {
  email: process.env.E2E_MASTER_EMAIL ?? "master@local.test",
  password: process.env.E2E_MASTER_PASSWORD ?? "Master12345",
};
const run = Date.now().toString(36);

async function loginOk(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const CSV = `﻿nome;email;telefone
Edileuza;;554899253654
Michael Imoveis;michael@imoveis.com;554898275000
554899794780;;554899794780
Cris diplomata;;554796529447
Duplicado;;5548999253654
Sem telefone;x@y.com;
Inválido;;12345
`;

test("contatos: importa o export antigo, busca, edita, cria, exporta e exclui", async ({
  page,
  browser,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Contatos ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Contatos");
  await page.getByLabel("E-mail do administrador").fill(`adm-ct-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  await page.getByRole("link", { name: "Contatos" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contatos");
  await expect(page.getByText("0 contatos")).toBeVisible();

  // Importa
  await page.getByRole("button", { name: "Importar" }).click();
  await page
    .getByTestId("import-file")
    .setInputFiles({ name: "contatos.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.getByRole("button", { name: "Importar", exact: true }).last().click();
  await expect(page.getByText("4 contatos novos · 1 já existiam · 2 linhas com problema")).toBeVisible();
  await expect(page.getByText("Linha 7: Sem telefone")).toBeVisible();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByText("4 contatos")).toBeVisible();
  await expect(page.getByTestId("contact-row")).toHaveCount(4);

  // Busca e edita
  await page.getByLabel("Buscar contatos").fill("michael");
  await expect(page.getByTestId("contact-row")).toHaveCount(1);
  await page.getByTestId("contact-row").first().click();
  const panel = page.getByRole("complementary", { name: "Contato" });
  await expect(panel.getByText("michael@imoveis.com").or(panel.getByLabel("E-mail"))).toBeVisible();
  await panel.getByLabel("Nome").fill("Michael Corretor");
  await panel.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(panel.getByText("Contato salvo.")).toBeVisible();
  await expect(page.getByTestId("contact-row").first()).toContainText("Michael Corretor");
  await page.screenshot({ path: `test-results/contatos-${testInfo.project.name}.png`, fullPage: true });
  await panel.getByRole("button", { name: "Fechar" }).click();

  // Novo contato e duplicado pelo telefone (com o 9)
  await page.getByLabel("Buscar contatos").fill("");
  await page.getByRole("link", { name: "Novo contato" }).click();
  const novo = page.getByRole("complementary", { name: "Novo contato" });
  await novo.getByLabel("Nome").fill("Repetida");
  await novo.getByRole("textbox", { name: /^Telefone/ }).fill("(48) 99925-3654");
  await novo.getByRole("button", { name: "Salvar contato" }).click();
  await expect(novo.getByText(/Já existe um contato com esse telefone \(Edileuza\)/)).toBeVisible();
  await novo.getByLabel("Nome").fill("Bruna");
  await novo.getByRole("textbox", { name: /^Telefone/ }).fill("(48) 99696-0229");
  await novo.getByRole("button", { name: "Salvar contato" }).click();
  await expect(
    page.getByRole("complementary", { name: "Contato" }).getByText("+55 (48) 99696-0229").first(),
  ).toBeVisible();
  await expect(page.getByText("5 contatos")).toBeVisible();

  // Exporta no formato antigo (no celular, fecha a folha do contato antes)
  const mobile = testInfo.project.name === "mobile";
  if (mobile) await page.getByRole("complementary", { name: "Contato" }).getByRole("button", { name: "Fechar" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Exportar" }).click(),
  ]);
  const path = await download.path();
  const content = (await import("node:fs")).readFileSync(path ?? "", "utf8");
  expect(content).toContain("nome;email;telefone");
  expect(content).toContain("Michael Corretor;michael@imoveis.com;554898275000");

  // Exclui
  if (mobile) await page.getByTestId("contact-row").filter({ hasText: "Bruna" }).click();
  const detail = page.getByRole("complementary", { name: "Contato" });
  await detail.getByRole("button", { name: "Excluir contato" }).click();
  await detail.getByRole("button", { name: "Excluir de vez" }).click();
  await expect(page.getByText("4 contatos")).toBeVisible();

  // Vendedor não vê importar/exportar
  await page.goto("/equipe");
  await page.getByLabel("E-mail").fill(`vend-ct-${tag}@teste.com`);
  await page.getByLabel("Papel").first().selectOption("seller");
  await page.getByRole("button", { name: "Criar convite" }).click();
  const sellerLink = (await page.locator("code").first().textContent()) ?? "";
  const ctx2 = await browser.newContext({ ...testInfo.project.use });
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(sellerLink).pathname);
  await p2.getByLabel("Seu nome").fill("Vendedor Contatos");
  await p2.getByLabel("Crie uma senha").fill("Venda12345");
  await p2.getByRole("button", { name: "Aceitar e entrar" }).click();
  await p2.waitForURL((u) => u.pathname === "/");
  await p2.goto("/contatos");
  await expect(p2.getByText("4 contatos")).toBeVisible();
  await expect(p2.getByRole("button", { name: "Importar" })).toHaveCount(0);
  await expect(p2.getByRole("link", { name: "Exportar" })).toHaveCount(0);
  expect((await p2.request.get("/api/contatos/exportar")).status()).toBe(403);
  await ctx2.close();
});
