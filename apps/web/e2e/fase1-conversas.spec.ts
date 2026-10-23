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

async function incoming(from: string, text: string) {
  const r = await fetch(`${FAKE}/__test/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, text }),
  });
  expect(r.ok).toBe(true);
}

async function lastSent() {
  const list = (await (await fetch(`${FAKE}/__test/sent`)).json()) as {
    kind: string;
    to: string;
    body: Record<string, unknown>;
  }[];
  return list.at(-1);
}

test("conversas: recebe em tempo real, responde, anexa, fecha, inicia nova e respeita quem vê o quê", async ({
  page,
  browser,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente1 = mobile ? "5511977770001" : "5511966660001";
  const cliente2 = mobile ? "5511977770002" : "5511966660002";

  // Empresa nova com WhatsApp conectado
  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Conversas ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Conversas");
  await page.getByLabel("E-mail do administrador").fill(`adm-conv-${tag}@teste.com`);
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
  await expect(page.getByRole("dialog")).toBeVisible();
  await fetch(`${FAKE}/__test/scan-latest`, { method: "POST" });
  await expect(page.getByText("WhatsApp conectado", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Concluir" }).click();

  // Abre Conversas pelo menu; mensagem chega sem recarregar
  await page.getByRole("link", { name: "Conversas" }).first().click();
  await expect(page.getByRole("heading", { name: "Conversas" })).toBeVisible();
  await expect(page.locator("[title='Atualizando em tempo real']")).toBeVisible({ timeout: 10_000 });
  await incoming(cliente1, "Oi, o Tiggo 2 ainda está disponível?");
  const item = page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item).toContainText("Oi, o Tiggo 2 ainda está disponível?");
  await expect(item).toContainText("1");

  // Abre e responde com Enter
  await item.click();
  const thread = page.getByTestId("thread-messages");
  await expect(thread.getByText("Oi, o Tiggo 2 ainda está disponível?")).toBeVisible();
  await page.getByLabel("Mensagem").fill("Está sim! Quer agendar uma visita?");
  await page.getByLabel("Mensagem").press("Enter");
  await expect(thread.getByText("Está sim! Quer agendar uma visita?")).toBeVisible();
  expect(await lastSent()).toMatchObject({ kind: "sendText", to: cliente1 });
  await expect(
    page.getByLabel("Enviada").or(page.getByLabel("Entregue")).or(page.getByLabel("Lida")).first(),
  ).toBeVisible();

  // Nova mensagem chega com a conversa aberta
  await incoming(cliente1, "Pode ser amanhã às 10h?");
  await expect(thread.getByText("Pode ser amanhã às 10h?")).toBeVisible({ timeout: 10_000 });
  await expect(thread.getByTestId("message")).toHaveCount(3);

  // Anexo
  await page.getByTestId("file-input").setInputFiles({
    name: "proposta.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 teste"),
  });
  await expect(page.getByText("proposta.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(thread.getByRole("link", { name: "proposta.pdf" })).toBeVisible();
  expect((await lastSent())?.body).toMatchObject({ mediatype: "document", fileName: "proposta.pdf" });
  await page.screenshot({ path: `test-results/conversas-${testInfo.project.name}-chat.png` });

  // Fecha: sai de Abertas e aparece em Fechadas
  await page.getByRole("button", { name: "Fechar" }).click();
  if (mobile) await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Fechadas" }).click();
  await expect(page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" })).toBeVisible();
  await page.getByRole("tab", { name: "Abertas" }).click();

  // Inicia conversa nova pelo número
  await page.getByRole("button", { name: "Nova conversa" }).click();
  await page.getByRole("textbox", { name: /^Número/ }).fill("(48) 99674-3297");
  await page.getByRole("button", { name: "Iniciar conversa" }).click();
  await expect(page.getByTestId("thread-title")).toHaveText("+55 (48) 99674-3297");
  await page.getByLabel("Mensagem").fill("Olá, aqui é da loja!");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(thread.getByText("Olá, aqui é da loja!")).toBeVisible();
  expect(await lastSent()).toMatchObject({ to: "5548996743297" });
  if (mobile) await page.getByRole("button", { name: "Voltar" }).click();
  await page.screenshot({
    path: `test-results/conversas-${testInfo.project.name}-lista.png`,
    fullPage: true,
  });

  // Vendedor: não vê conversas do admin, vê a nova sem dono
  await page.goto("/equipe");
  await page.getByLabel("E-mail").fill(`vend-conv-${tag}@teste.com`);
  await page.getByLabel("Papel").first().selectOption("seller");
  await page.getByRole("button", { name: "Criar convite" }).click();
  const sellerLink = (await page.locator("code").first().textContent()) ?? "";
  const ctx2 = await browser.newContext({ ...testInfo.project.use });
  const p2 = await ctx2.newPage();
  await p2.goto(new URL(sellerLink).pathname);
  await p2.getByLabel("Seu nome").fill("Vendedor Conversas");
  await p2.getByLabel("Crie uma senha").fill("Venda12345");
  await p2.getByRole("button", { name: "Aceitar e entrar" }).click();
  await p2.waitForURL((u) => u.pathname === "/");
  await p2.goto("/conversas");
  await expect(p2.getByText("Nenhuma conversa aqui.")).toBeVisible();
  await incoming(cliente2, "Bom dia, vocês financiam?");
  const sellerItem = p2.getByTestId("conversation-item").filter({ hasText: "Bom dia, vocês financiam?" });
  await expect(sellerItem).toBeVisible({ timeout: 10_000 });
  await expect(p2.getByTestId("conversation-item")).toHaveCount(1);
  await sellerItem.click();
  await p2.getByRole("button", { name: "Puxar para mim" }).click();
  await expect(p2.getByText("Sua")).toBeVisible();
  await ctx2.close();
});
