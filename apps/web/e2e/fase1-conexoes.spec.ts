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

test("conexão de WhatsApp: cria, lê QR, conecta, respeita limite, desconecta e exclui", async ({
  page,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const adminEmail = `adm-conn-${tag}@teste.com`;

  // Master cria a empresa com limite de 1 conexão
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Conexoes ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Conexões");
  await page.getByLabel("E-mail do administrador").fill(adminEmail);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);

  // Admin aceita e abre Conexões pelo menu
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Conexões", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conexões");
  await expect(page.getByText("Nenhum WhatsApp conectado")).toBeVisible();
  await expect(page.getByText("0 de 1 conexão(ões) do seu plano.")).toBeVisible();

  // Cria e vê o QR code
  await page.getByLabel("Nome da conexão").fill("Loja");
  await page.getByRole("button", { name: "Criar e mostrar QR code" }).click();
  const dialog = page.getByRole("dialog", { name: "Conectar Loja" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText("QR code para conectar o WhatsApp")).toBeVisible();
  await page.screenshot({ path: `test-results/conexoes-${testInfo.project.name}-qr.png` });

  // O celular lê o QR (a Evolution falsa avisa o CRM pelo webhook)
  const scan = await fetch(`${FAKE}/__test/scan-latest`, { method: "POST" });
  expect(scan.ok).toBe(true);
  await expect(dialog.getByText("WhatsApp conectado")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("(48) 99674-3297")).toBeVisible();
  await dialog.getByRole("button", { name: "Concluir" }).click();

  const row = page.getByTestId("connection-row");
  await expect(row.getByText("Conectado")).toBeVisible();
  await expect(row.getByText("(48) 99674-3297")).toBeVisible();
  await expect(page.getByText("1 de 1 conexão(ões) do seu plano. Limite atingido.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova conexão" })).toBeDisabled();
  await page.screenshot({
    path: `test-results/conexoes-${testInfo.project.name}-conectado.png`,
    fullPage: true,
  });

  // Desconecta, depois exclui
  await row.getByRole("button", { name: "Desconectar" }).click();
  await expect(row.getByText("Desconectado")).toBeVisible();
  await row.getByRole("button", { name: "Excluir" }).click();
  await row.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Nenhum WhatsApp conectado")).toBeVisible();

  // A instância de outro sistema na mesma Evolution continua intacta
  const state = (await (await fetch(`${FAKE}/__test/state`)).json()) as Record<string, { state: string }>;
  expect(state.GREENCAR?.state).toBe("open");
});
