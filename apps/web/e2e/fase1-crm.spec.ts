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

const EXPORT = `﻿ID;Título;Valor;Funil;Etapa;Fonte;Responsável;Departamento;Anúncio;Score;Etiquetas;Produtos;Contato;Telefone;E-mail;Criado em;Atualizado em;Cidade
3918370;Edileuza;64900;Funil Comercial Automotivo;NOVO LEAD;FB_Ads;Kauã;;;;LEAD QUENTE;;Edileuza;554899253654;;20/10/2026, 08:57;;Criciúma
3900001;Paulo;1.250,50;Funil Comercial Automotivo;VENDA GANHA;Indicação;;;;;;;Paulo;554888887777;;01/10/2026, 10:00;;
`;

test("CRM: lead automático, etapas, valor, etiqueta, anotação, arrastar, nova negociação, configurar e importar", async ({
  page,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente = mobile ? "5511955550001" : "5511944440001";

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`CRM ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin CRM");
  await page.getByLabel("E-mail do administrador").fill(`adm-crm-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/conexoes");
  await page.getByLabel("Nome da conexão").fill("Loja");
  await page.getByRole("button", { name: "Criar e mostrar QR code" }).click();
  await expect(page.getByRole("dialog", { name: "Conectar Loja" })).toBeVisible();
  await fetch(`${FAKE}/__test/scan-latest`, { method: "POST" });
  await expect(page.getByText("WhatsApp conectado", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Concluir" }).click();

  // Lead automático
  await fetch(`${FAKE}/__test/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: cliente, text: "Quero o Tiggo 2" }),
  });
  await page.getByRole("link", { name: "CRM" }).first().click();
  await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
  const novoLead = page.getByRole("region", { name: "Etapa Novo lead" });
  await expect(novoLead.getByTestId("deal-card").filter({ hasText: "Cliente Teste" })).toBeVisible({
    timeout: 10_000,
  });

  // Abre, muda etapa, valor, etiqueta, anotação
  await novoLead.getByTestId("deal-card").filter({ hasText: "Cliente Teste" }).click();
  const panel = page.getByRole("dialog", { name: "Negociação" });
  await expect(panel.getByText("Negociação #1")).toBeVisible();
  await panel.getByLabel("Etapa").selectOption({ label: "Proposta" });
  await expect(page.getByRole("region", { name: "Etapa Proposta" }).getByTestId("deal-card")).toHaveCount(1);
  await panel.getByLabel("Valor (R$)").fill("64.900,00");
  await panel.getByLabel("Carro / interesse").fill("HR-V prata 2020");
  await panel.getByRole("button", { name: "Salvar" }).click();
  await expect(panel.getByText("Salvo.")).toBeVisible();
  await panel.getByLabel("Adicionar etiqueta").fill("Lead quente");
  await panel.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(panel.getByText("Lead quente").first()).toBeVisible();
  await panel.getByLabel("Anotação").fill("Cliente quer trocar o Gol 2012");
  await panel.getByRole("button", { name: "Anotar" }).click();
  await expect(panel.getByText("Cliente quer trocar o Gol 2012")).toBeVisible();
  await expect(panel.getByText("Mudou de Novo lead para Proposta")).toBeVisible();
  await panel.getByRole("button", { name: "Fechar" }).last().click();
  await expect(page.getByRole("region", { name: "Etapa Proposta" }).getByTestId("deal-interest")).toHaveText(
    "HR-V prata 2020",
  );
  await expect(page.getByRole("region", { name: "Etapa Proposta" })).toContainText("R$ 64.900,00");

  // Arrastar (computador) ou trocar etapa pelo painel (celular) para Ganho
  const card = page.getByRole("region", { name: "Etapa Proposta" }).getByTestId("deal-card").first();
  if (mobile) {
    await card.click();
    await panel.getByLabel("Etapa").selectOption({ label: "Ganho" });
    await panel.getByRole("button", { name: "Fechar" }).last().click();
  } else {
    await card.dragTo(page.getByRole("region", { name: "Etapa Ganho" }));
  }
  await expect(page.getByRole("region", { name: "Etapa Ganho" }).getByTestId("deal-card")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Etapa Ganho" })).toContainText("R$ 64.900,00");
  await expect(page.getByRole("region", { name: "Etapa Proposta" })).not.toContainText("R$ 64.900,00");
  await page.screenshot({ path: `test-results/crm-${testInfo.project.name}.png`, fullPage: true });

  // A conversa mostra a negociação
  await page.getByRole("link", { name: "Conversas" }).first().click();
  await page.getByRole("tab", { name: "Todas" }).click();
  await page.getByTestId("conversation-item").first().click();
  await expect(page.getByTestId("deal-chip")).toContainText("Funil de Vendas · Ganho");
  await page.goto("/crm");

  // Nova negociação
  await page.getByRole("button", { name: "Nova negociação" }).click();
  const novo = page.getByRole("dialog", { name: "Nova negociação" });
  await novo.getByLabel("Telefone do contato").fill("(48) 99111-2233");
  await novo.getByLabel("Nome do contato").fill("Rafael");
  await novo.getByLabel("Título (opcional)").fill("Onix 2020");
  await novo.getByLabel("Valor (R$)").fill("53900");
  await novo.getByRole("button", { name: "Criar negociação" }).click();
  await expect(page.getByRole("dialog", { name: "Negociação" }).getByText("Negociação #2")).toBeVisible();
  await page
    .getByRole("dialog", { name: "Negociação" })
    .getByRole("button", { name: "Fechar" })
    .last()
    .click();
  await expect(page.getByRole("region", { name: "Etapa Novo lead" })).toContainText("Onix 2020");

  // Configurar: nova etapa aparece no quadro
  await page.getByRole("link", { name: "Configurar" }).click();
  await expect(page.getByRole("heading", { name: "Configurar CRM" })).toBeVisible();
  await page.getByLabel("Nova etapa").first().fill("Financiamento");
  await page.getByRole("button", { name: "Adicionar etapa" }).first().click();
  await expect(page.getByTestId("stage-row")).toHaveCount(8);
  await page.goto("/crm");
  await expect(page.getByRole("region", { name: "Etapa Financiamento" })).toBeVisible();

  // Importar o export antigo cria o funil
  await page.getByRole("button", { name: "Importar" }).click();
  await page
    .getByTestId("deals-file")
    .setInputFiles({ name: "negociacoes.csv", mimeType: "text/csv", buffer: Buffer.from(EXPORT) });
  await page
    .getByRole("dialog", { name: "Importar negociações" })
    .getByRole("button", { name: "Importar" })
    .click();
  await expect(page.getByText("2 negociações criadas · 0 já existiam")).toBeVisible();
  await expect(page.getByText(/Kauã/)).toBeVisible();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.getByLabel("Funil").selectOption({ label: "Funil Comercial Automotivo" });
  await expect(page.getByRole("region", { name: "Etapa NOVO LEAD" })).toContainText("Edileuza");
  await expect(page.getByRole("region", { name: "Etapa VENDA GANHA" })).toContainText("R$ 1.250,50");
});
