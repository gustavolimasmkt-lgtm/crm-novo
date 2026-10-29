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

test("CRM em lista: filtros, ações em massa, exportar e regra de inatividade", async ({ page }, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Lista ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Lista");
  await page.getByLabel("E-mail do administrador").fill(`adm-lista-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // Três negociações pela API da própria tela.
  await page.goto("/crm");
  for (const [i, carro] of ["Onix 2020", "HR-V 2019", "Onix 2022"].entries()) {
    const r = await page.request.post("/api/crm/negociacoes", {
      data: { phone: `4899770000${i}`, contactName: `Cliente ${i}`, interest: carro },
    });
    expect(r.ok()).toBeTruthy();
  }

  await page.getByRole("tab", { name: "Lista" }).click();
  await expect(page).toHaveURL(/ver=lista/);
  const lista = page.getByTestId("lista-crm");
  await expect(lista.getByTestId("lista-linha")).toHaveCount(3);
  await page.getByLabel("Buscar negociações").fill("onix");
  await expect(lista.getByTestId("lista-linha")).toHaveCount(2);
  await expect(lista.getByTestId("lista-total")).toHaveText("2 negociações");

  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.screenshot({ path: `test-results/lista-tabela-${testInfo.project.name}.png`, fullPage: true });
  // Seleciona a página e move em massa.
  await lista.getByLabel("Selecionar a página").check();
  const barra = page.getByTestId("acoes-massa");
  await expect(barra).toContainText("2 selecionadas");
  await barra.getByLabel("Ação em massa").selectOption("move");
  await barra.getByLabel("Etapa de destino").selectOption({ label: "Proposta" });
  await barra.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Movidas: 2 de 2.")).toBeVisible();
  await lista.getByLabel("Etapa", { exact: true }).selectOption({ label: "Proposta" });
  await expect(lista.getByTestId("lista-linha")).toHaveCount(2);

  // Etiqueta em massa e marcação de desqualificado.
  await page.getByLabel("Buscar negociações").fill("");
  await lista.getByLabel("Etapa", { exact: true }).selectOption("");
  await expect(lista.getByTestId("lista-linha")).toHaveCount(3);
  await lista.getByLabel("Selecionar negociação 2").check();
  await barra.getByLabel("Ação em massa").selectOption("disqualified");
  await barra.getByLabel("Motivo").selectOption("Sem entrada");
  await barra.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Desqualificadas: 1 de 1.")).toBeVisible();
  await lista.getByLabel("Qualificação").selectOption("disqualified");
  await expect(lista.getByTestId("lista-linha")).toHaveCount(1);
  await expect(lista.getByTestId("lista-linha")).toContainText("HR-V 2019");

  // Exporta o filtro atual.
  const href = await lista.getByRole("link", { name: "Exportar" }).getAttribute("href");
  const csv = await (await page.request.get(href ?? "")).text();
  expect(csv).toContain("Carro / interesse");
  expect(csv).toContain("HR-V 2019");
  expect(csv).not.toContain("Onix 2020");

  // Linha abre a negociação.
  await lista.getByTestId("lista-linha").first().click();
  const panel = page.getByRole("dialog", { name: "Negociação" });
  await expect(panel.getByText("Marcou como desqualificado (Sem entrada)")).toBeVisible();
  await page.screenshot({ path: `test-results/lista-${testInfo.project.name}.png`, fullPage: true });
  await panel.getByRole("button", { name: "Fechar" }).last().click();

  // Regra de inatividade.
  await page.goto("/crm/configuracoes");
  const regra = page.getByTestId("inatividade");
  await regra.locator("label", { hasText: "Em atendimento" }).click();
  await regra.getByLabel("Dias parada").fill("5");
  await regra.getByLabel("Mover para").selectOption({ label: "Perdido" });
  await regra.getByRole("button", { name: "Ver quantas mudam" }).click();
  await expect(regra.getByText(/nenhuma negociação se encaixa/)).toBeVisible();
  await regra.getByRole("button", { name: "Salvar regra" }).click();
  await expect(regra.getByRole("listitem")).toContainText("Em atendimento → Perdido depois de 5 dias parada");
  await regra.getByRole("button", { name: "Pausar" }).click();
  await expect(regra.getByRole("button", { name: "Ligar" })).toBeVisible();
  await regra.getByRole("button", { name: "Excluir regra" }).click();
  await expect(regra.getByRole("listitem")).toHaveCount(0);
});
