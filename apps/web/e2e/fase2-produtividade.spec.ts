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

test("produtividade: respostas rápidas, nota interna, áudio transcrito, tarefas e anti-bloqueio", async ({
  page,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente = mobile ? "5511966660002" : "5511966660001";
  page.on("dialog", (d) => d.accept());

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Prod ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Prod");
  await page.getByLabel("E-mail do administrador").fill(`adm-prod-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // Respostas rápidas pelo menu
  if (mobile) await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Respostas rápidas" }).first().click();
  await page.getByLabel("Atalho").fill("/Endereço");
  await page.getByLabel(/^Mensagem/).fill("Oi {nome}! Estamos na Av. Centenário, 100.");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByTestId("resposta")).toContainText("/endereco");

  // Conexão + cliente escrevendo
  await page.goto("/conexoes");
  await page.getByLabel("Nome da conexão").fill("Loja");
  await page.getByRole("button", { name: "Criar e mostrar QR code" }).click();
  await expect(page.getByRole("dialog", { name: "Conectar Loja" })).toBeVisible();
  await fetch(`${FAKE}/__test/scan-latest`, { method: "POST" });
  await expect(page.getByText("WhatsApp conectado", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Concluir" }).click();
  const incoming = (b: Record<string, unknown>) =>
    fetch(`${FAKE}/__test/incoming`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: cliente, ...b }),
    });
  await incoming({ text: "Onde fica a loja?" });

  await page.goto("/conversas");
  await page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" }).click({ timeout: 10_000 });
  const thread = page.getByTestId("thread-messages");
  const box = page.getByLabel("Mensagem", { exact: true });

  // "/" abre as respostas rápidas; Enter escolhe e troca {nome}
  await box.fill("/end");
  await expect(page.getByRole("button", { name: /\/endereco/ })).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue("Oi Cliente! Estamos na Av. Centenário, 100.");
  await box.press("Enter");
  await expect(thread.getByText("Oi Cliente! Estamos na Av. Centenário, 100.")).toBeVisible();

  // Nota interna: aparece só no CRM
  const before = ((await (await fetch(`${FAKE}/__test/sent`)).json()) as unknown[]).length;
  await page.getByRole("button", { name: "Nota interna" }).click();
  await page.getByLabel("Nota interna", { exact: true }).last().fill("Cliente prefere contato à tarde");
  await page.getByRole("button", { name: "Salvar nota" }).click();
  await expect(page.getByTestId("note")).toContainText("Cliente prefere contato à tarde");
  await expect(page.getByTestId("note")).toContainText("Nota interna · Admin");
  const after = ((await (await fetch(`${FAKE}/__test/sent`)).json()) as unknown[]).length;
  expect(after).toBe(before);
  await page.getByRole("button", { name: "Nota interna" }).first().click();

  // Áudio: botão Transcrever
  await incoming({ audio: true });
  await expect(thread.getByRole("button", { name: "Transcrever" })).toBeVisible({ timeout: 10_000 });
  await thread.getByRole("button", { name: "Transcrever" }).click();
  await expect(thread.getByTestId("transcricao")).toContainText("quero ver o hrv prata amanhã");

  // Tarefas
  await page.goto("/tarefas");
  await expect(page.getByText("Nada pendente")).toBeVisible();
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  const dlg = page.getByRole("dialog", { name: "Nova tarefa" });
  await dlg.getByLabel("O que fazer").fill("Ligar para o cliente");
  await dlg.getByLabel("Hora").fill("23:59");
  await dlg.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(dlg).toBeHidden();
  const task = page.getByTestId("tarefa").filter({ hasText: "Ligar para o cliente" });
  await expect(task).toBeVisible();
  await task.getByRole("button", { name: "Concluir Ligar para o cliente" }).click();
  await expect(page.getByText("Nada pendente")).toBeVisible();
  await page.getByRole("link", { name: "Concluídas" }).click();
  await expect(page.getByTestId("tarefa")).toContainText("Ligar para o cliente");

  // Anti-bloqueio no formulário de follow-up
  await page.goto("/agente");
  const fu = page.getByTestId("followup");
  await fu.getByLabel("Intervalo mín. (s)").fill("45");
  await fu.getByLabel("Intervalo máx. (s)").fill("120");
  await fu.getByLabel("Limite por dia").fill("80");
  await fu.getByRole("button", { name: "Salvar follow-up" }).click();
  await expect(fu.getByText("Follow-up salvo.")).toBeVisible();
  await page.reload();
  await expect(fu.getByLabel("Limite por dia")).toHaveValue("80");
  await fu.getByLabel("Intervalo mín. (s)").fill("200");
  await fu.getByRole("button", { name: "Salvar follow-up" }).click();
  await expect(fu.getByText("O intervalo máximo precisa ser maior ou igual ao mínimo.")).toBeVisible();
});
