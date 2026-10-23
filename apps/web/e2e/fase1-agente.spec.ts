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

const LEGACY = JSON.stringify({
  tipo: "super_agente_modelo",
  agente: { nome: "AGENTE LOJA TESTE" },
  conhecimentos: [
    {
      tipo: "REGRA",
      titulo: "__BASIC_REGRAS__",
      conteudo: "Você é o assistente da Loja Teste. Vendemos carros seminovos.",
      is_active: true,
    },
  ],
  fluxoNos: [
    {
      tipo: "ETAPA",
      titulo: "__BASIC_ETAPA__",
      conteudo: "<p>Cumprimente e pergunte o nome.</p>",
      is_active: true,
    },
  ],
  parametros: { debounce_ms: 25000, historico_mensagens: 20 },
});

test("agente de IA: importa, simula, liga, responde no WhatsApp, transfere e religa", async ({
  page,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente = mobile ? "5511933330001" : "5511922220001";

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`IA ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin IA");
  await page.getByLabel("E-mail do administrador").fill(`adm-ia-${tag}@teste.com`);
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

  // Abre a tela do agente pelo menu
  if (mobile) await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Agente de IA" }).first().click();
  await expect(page.getByRole("heading", { name: "Agente de IA" })).toBeVisible();

  // Importa do sistema antigo
  await page
    .getByTestId("agent-import")
    .setInputFiles({ name: "agente.json", mimeType: "application/json", buffer: Buffer.from(LEGACY) });
  await expect(page.getByText("Instruções importadas.")).toBeVisible();
  await expect(page.getByLabel("Instruções do agente")).toHaveValue(/Você é o assistente da Loja Teste/);
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("AGENTE LOJA TESTE");

  // Simulador
  await page.getByLabel("Mensagem de teste").fill("vocês abrem sábado?");
  await page.getByRole("button", { name: "Enviar teste" }).click();
  await expect(page.getByTestId("sim-messages")).toContainText("Resposta automática: vocês abrem sábado?");

  // Liga e salva (sem espera, para o teste)
  await page.getByLabel("Esperar antes de responder (segundos)").fill("0");
  await page.getByLabel(/Agente ligado/).check();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Agente salvo.")).toBeVisible();
  // O formulário continua mostrando o que foi salvo.
  await expect(page.getByLabel(/Agente ligado/)).toBeChecked();
  await expect(page.getByLabel("Modelo de IA")).toHaveValue("claude-sonnet-5-5");
  await page.reload();
  await expect(page.getByLabel(/Agente ligado/)).toBeChecked();
  await expect(page.getByLabel("Instruções do agente")).toHaveValue(/Você é o assistente da Loja Teste/);
  await expect(page.getByText(/de 50\.000 créditos/)).toBeVisible();
  await page.screenshot({ path: `test-results/agente-${testInfo.project.name}.png`, fullPage: true });

  // Cliente escreve: a IA responde sozinha
  const incoming = (text: string) =>
    fetch(`${FAKE}/__test/incoming`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: cliente, text }),
    });
  await page.goto("/conversas");
  await incoming("Bom dia, tem Onix?");
  await page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" }).click({ timeout: 10_000 });
  const thread = page.getByTestId("thread-messages");
  await expect(thread.getByText("Resposta automática: Bom dia, tem Onix?")).toBeVisible({ timeout: 15_000 });
  await expect(thread.getByTestId("message").last()).toContainText("IA");
  await expect(page.getByTestId("ai-bar")).toContainText("IA respondendo esta conversa");

  // Pede um vendedor: a IA se despede e pausa
  await incoming("quero falar com um vendedor");
  await expect(thread.getByText("Claro! Vou chamar um vendedor para continuar com você.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("ai-bar")).toContainText(
    "IA pausada: Transferida pela IA: Cliente pediu um vendedor",
  );

  // Religa
  await page.getByRole("button", { name: "Religar IA" }).click();
  await expect(page.getByTestId("ai-bar")).toContainText("IA respondendo esta conversa");
});
