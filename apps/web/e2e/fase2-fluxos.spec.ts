import { expect, type Page, test } from "@playwright/test";

const MASTER = {
  email: process.env.E2E_MASTER_EMAIL ?? "master@local.test",
  password: process.env.E2E_MASTER_PASSWORD ?? "Master12345",
};
const FAKE = process.env.E2E_FAKE_EVOLUTION ?? "http://127.0.0.1:3199";
const run = Date.now().toString(36);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function loginOk(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("fluxos: cria, liga, inicia na conversa, aparece em Agendadas e para", async ({ page }, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente = mobile ? "5511944450002" : "5511944450001";
  page.on("dialog", (d) => d.accept());

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Fluxo ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Fluxo");
  await page.getByLabel("E-mail do administrador").fill(`adm-fluxo-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // Cria o fluxo pelo menu
  if (mobile) await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Fluxos" }).first().click();
  await expect(page.getByText("Nenhum fluxo")).toBeVisible();
  await page.getByRole("button", { name: "Novo fluxo" }).click();
  await page.getByLabel("Nome do fluxo").fill("Reaquecer cliente");
  await page.getByLabel("Começa quando").selectOption("manual");
  await page.getByLabel("Mensagem do passo 1").fill("Oi {nome}, tudo bem?");
  await page.getByRole("button", { name: "+ Foto, vídeo ou áudio" }).click();
  await page
    .getByTestId("midia-passo-2")
    .setInputFiles({ name: "hrv.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("hrv.png")).toBeVisible();
  await page.getByLabel("Legenda do passo 2").fill("Olha ele, {nome}");
  await page.getByRole("button", { name: "+ Esperar" }).click();
  await page.getByLabel("Espera do passo 3", { exact: true }).fill("2");
  await page.getByRole("button", { name: "+ Mensagem" }).click();
  await page.getByLabel("Mensagem do passo 4").fill("Chegaram carros novos no estoque!");
  await page.getByRole("button", { name: "+ Criar tarefa" }).click();
  await page.getByLabel("Tarefa do passo 5", { exact: true }).fill("Ligar se não respondeu");
  // Reordena: tarefa sobe uma posição e volta
  await page.getByRole("button", { name: "Subir passo 5" }).click();
  await expect(page.getByLabel("Tarefa do passo 4", { exact: true })).toHaveValue("Ligar se não respondeu");
  await page.getByRole("button", { name: "Descer passo 4" }).click();
  await page.getByRole("button", { name: "Salvar fluxo" }).click();
  await page.waitForURL(/\/fluxos$/);
  const row = page.getByTestId("fluxo").filter({ hasText: "Reaquecer cliente" });
  await expect(row).toContainText(
    "Botão Enviar fluxo na conversa · 5 passos · 2 mensagem(ns) · duração 2 dia(s)",
  );
  await row.getByRole("button", { name: "Ligar" }).click();
  await expect(row).toContainText("Ligado");

  // Conexão + cliente
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
    body: JSON.stringify({ from: cliente, text: "Oi" }),
  });

  // Envia o fluxo na conversa: texto e foto saem na hora; depois espera 2 dias
  await page.goto("/conversas");
  await page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" }).click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Enviar fluxo" }).click();
  await page.getByRole("button", { name: "Reaquecer cliente" }).click();
  const thread = page.getByTestId("thread-messages");
  await expect(thread.getByText("Oi Cliente, tudo bem?")).toBeVisible({ timeout: 15_000 });
  await expect(thread.getByText("Olha ele, Cliente")).toBeVisible({ timeout: 15_000 });
  await expect(thread.getByTestId("message").filter({ hasText: "Olha ele, Cliente" })).toContainText("Fluxo");
  await expect(page.getByTestId("fluxos-ativos")).toContainText("Reaquecer cliente");
  await expect(page.getByTestId("fluxos-ativos")).toContainText("passo 4 de 5");
  await expect(page.getByTestId("ai-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Enviar fluxo" }).click();
  await page.getByRole("button", { name: "Reaquecer cliente" }).click();
  await expect(page.getByText("Esse fluxo já está rodando para este cliente.")).toBeVisible();

  // Tela Agendadas mostra o próximo passo do fluxo
  await page.goto("/agendadas");
  const item = page.getByTestId("programada").filter({ hasText: "Cliente Teste" });
  await expect(item).toContainText("Fluxo");
  await expect(item).toContainText("Chegaram carros novos no estoque!");
  await item.getByRole("button", { name: "Parar" }).click();
  await expect(page.getByText("Nada programado")).toBeVisible();
  await page.screenshot({ path: `test-results/fluxos-${testInfo.project.name}.png`, fullPage: true });
});
