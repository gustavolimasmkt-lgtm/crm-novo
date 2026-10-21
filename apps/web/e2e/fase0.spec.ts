import { expect, type Page, test } from "@playwright/test";

const MASTER = {
  email: process.env.E2E_MASTER_EMAIL ?? "master@local.test",
  password: process.env.E2E_MASTER_PASSWORD ?? "Master12345",
};
const run = Date.now().toString(36);

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function loginOk(page: Page, email: string, password: string) {
  await login(page, email, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Sair" }).first().click();
  await expect(page).toHaveURL(/\/login/);
}

test("login inválido mostra mensagem", async ({ page }) => {
  await login(page, `naoexiste-${run}@x.com`, "errada123");
  await expect(page.getByText("E-mail ou senha incorretos")).toBeVisible();
});

test("fluxo da Fase 0: master cria empresa, admin aceita convite, convida vendedor, troca de empresa", async ({
  page,
  browser,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const adminEmail = `admin-${tag}@teste.com`;
  const sellerEmail = `vendedor-${tag}@teste.com`;

  // Master cria a empresa
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Loja ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Teste");
  await page.getByLabel("E-mail do administrador").fill(adminEmail);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  await expect(page.getByText("Empresa criada")).toBeVisible();
  const adminLink = (await page.locator("code").first().textContent()) ?? "";
  expect(adminLink).toContain("/convite/");
  await expect(page.getByText(`Loja ${tag}`)).toBeVisible();
  await logout(page);

  // Admin aceita o convite e cai na empresa
  await page.goto(new URL(adminLink).pathname);
  await expect(page.getByText(`Loja ${tag}`)).toBeVisible();
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Admin");

  // Admin convida vendedor
  await page.goto("/equipe");
  await page.getByLabel("E-mail").fill(sellerEmail);
  await page.getByLabel("Papel").first().selectOption("seller");
  await page.getByRole("button", { name: "Criar convite" }).click();
  await expect(page.getByText("Convite criado")).toBeVisible();
  const sellerLink = (await page.locator("code").first().textContent()) ?? "";
  await expect(page.getByText("Convites pendentes")).toBeVisible();

  // Vendedor aceita em outra sessão e não vê a Equipe
  const ctx2 = await browser.newContext({ ...testInfo.project.use });
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(sellerLink).pathname);
  await p2.getByLabel("Seu nome").fill("Vendedor Teste");
  await p2.getByLabel("Crie uma senha").fill("Venda12345");
  await p2.getByRole("button", { name: "Aceitar e entrar" }).click();
  await expect(p2.getByRole("heading", { level: 1 })).toContainText("Vendedor");
  await expect(p2.getByRole("link", { name: "Equipe" })).toHaveCount(0);
  await p2.goto("/equipe");
  await expect(p2).toHaveURL(/sem-permissao/);
  await ctx2.close();

  // Admin agora aparece como membro e o convite saiu da lista
  await page.reload();
  await expect(page.getByText(sellerEmail)).toBeVisible();

  // Master cria segunda empresa para o mesmo admin, que troca de empresa
  await logout(page);
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Filial ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Teste");
  await page.getByLabel("E-mail do administrador").fill(adminEmail);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link2 = (await page.locator("code").first().textContent()) ?? "";
  await logout(page);
  await page.goto(new URL(link2).pathname);
  await page.getByLabel("Sua senha atual").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  // Entra direto na empresa do convite e consegue trocar para a outra
  const switcher = page.getByRole("button", { name: new RegExp(`Filial ${tag}`) }).first();
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page
    .getByRole("button", { name: `Loja ${tag}` })
    .first()
    .click();
  await expect(page.getByRole("button", { name: new RegExp(`Loja ${tag}`) }).first()).toBeVisible();
});

test("prévia visual: 4 telas", async ({ page }, testInfo) => {
  await loginOk(page, MASTER.email, MASTER.password);
  // entra numa empresa pelo painel Master
  await page.goto("/master");
  await page.getByRole("button", { name: "Entrar" }).first().click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/previa");
  for (const tab of ["Conversas", "CRM", "Negociação", "Dashboard"]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `test-results/previa-${testInfo.project.name}-${tab}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("tab", { name: "Conversas" }).click();
  await page.screenshot({
    path: `test-results/previa-${testInfo.project.name}-Conversas-escuro.png`,
    fullPage: true,
  });
});
