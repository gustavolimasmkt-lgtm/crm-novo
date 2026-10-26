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

test("Meta: lead de anúncio, integração, teste de conexão e resultado por campanha", async ({
  page,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente = mobile ? "5511988880002" : "5511988880001";

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Meta ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Meta");
  await page.getByLabel("E-mail do administrador").fill(`adm-meta-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // Integração pelo menu
  if (mobile) await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Integração Meta" }).first().click();
  await page.getByLabel("API de Conversões ligada").check();
  await page.getByLabel("ID do conjunto de dados (pixel)").fill("777000111");
  await page.getByLabel("Token de acesso da API de Conversões").fill("token-capi");
  await page.getByLabel("ID da conta de anúncios").fill("act_555");
  await page.getByLabel("Token de leitura de anúncios").fill("token-ads");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Integração salva.")).toBeVisible();
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByTestId("teste-meta")).toContainText("Conjunto de dados: Pixel da Loja");
  await expect(page.getByTestId("teste-meta")).toContainText("Conta GreenCar (BRL)");
  await page.reload();
  await expect(page.getByLabel("Token de acesso da API de Conversões")).toHaveValue("");
  await expect(page.getByText("Já guardado. Deixe vazio para manter.").first()).toBeVisible();

  // Conexão + lead vindo do anúncio
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
    body: JSON.stringify({ from: cliente, ad: true }),
  });

  // Resultado por campanha (nome e gasto vêm da Meta)
  await page.goto("/anuncios");
  const camp = page.getByTestId("por-campanha");
  await expect(camp).toContainText("Seminovos | WhatsApp");
  await expect(camp).toContainText("R$ 150,00");
  await expect(camp).toContainText("Feirão Outubro");
  await expect(page.getByTestId("por-anuncio")).toContainText("HR-V prata vídeo");

  // Negociação mostra o anúncio
  await page.goto("/crm");
  await page.getByText("Cliente Teste").first().click();
  await expect(page.getByTestId("anuncio-negociacao")).toContainText("HR-V prata 2020");
  await expect(page.getByTestId("anuncio-negociacao")).toContainText("Instagram");
  await page.screenshot({ path: `test-results/meta-${testInfo.project.name}.png`, fullPage: true });
});
