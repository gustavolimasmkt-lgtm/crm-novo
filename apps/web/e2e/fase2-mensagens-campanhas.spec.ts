import { expect, type Page, test } from "@playwright/test";
import { openFromMenu } from "./menu";

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

/** Ação do campo de mensagem: no celular fica atrás do botão "+" (Mais opções). */
async function composerAction(page: Page, name: string) {
  const more = page.getByRole("button", { name: "Mais opções" });
  // Celular (tela estreita): as ações ficam atrás do "+". Computador: botões direto no campo.
  if ((page.viewportSize()?.width ?? 1280) >= 768)
    return page.getByRole("button", { name, exact: true }).click();
  // A conversa pode recarregar logo depois de aberta: reabre o menu se ele fechar.
  await expect(async () => {
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await page
      .getByRole("list", { name: "Mais opções" })
      .getByRole("button", { name, exact: true })
      .click({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

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

test("mensagens: responder, editar, apagar, agendar, resumo da IA e campanha", async ({ page }, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const cliente = mobile ? "5511977770002" : "5511977770001";
  page.on("dialog", (d) => d.accept());

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Msg ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Msg");
  await page.getByLabel("E-mail do administrador").fill(`adm-msg-${tag}@teste.com`);
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
  await fetch(`${FAKE}/__test/incoming`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: cliente, text: "Tem HR-V prata?" }),
  });

  await page.goto("/conversas");
  await page.getByTestId("conversation-item").filter({ hasText: "Cliente Teste" }).click({ timeout: 10_000 });
  const thread = page.getByTestId("thread-messages");
  const box = page.getByLabel("Mensagem", { exact: true });

  // Responder citando
  const inMsg = thread.getByTestId("message").filter({ hasText: "Tem HR-V prata?" });
  await inMsg.getByRole("button", { name: "Ações da mensagem" }).click();
  await page.getByRole("button", { name: "Responder" }).click();
  await expect(page.getByText("Respondendo:")).toBeVisible();
  await box.fill("Temos sim!");
  await box.press("Enter");
  const mine = thread.getByTestId("message").filter({ hasText: "Temos sim!" });
  await expect(mine.getByTestId("citacao")).toContainText("Tem HR-V prata?");

  // Editar
  await mine.getByRole("button", { name: "Ações da mensagem" }).click();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(box).toHaveValue("Temos sim!");
  await box.fill("Temos sim, 2020 automático!");
  await page.getByRole("button", { name: "Salvar edição" }).click();
  const edited = thread.getByTestId("message").filter({ hasText: "Temos sim, 2020 automático!" });
  await expect(edited).toContainText("editada");

  // Apagar para todos
  await edited.getByRole("button", { name: "Ações da mensagem" }).click();
  await page.getByRole("button", { name: "Apagar para todos" }).click();
  await expect(edited.getByTestId("apagada")).toHaveText("Você apagou esta mensagem");

  // Agendar
  await composerAction(page, "Agendar mensagem");
  const when = new Date(Date.now() + 2 * 86_400_000 - 3 * 3600_000).toISOString().slice(0, 10);
  await page.getByLabel("Agendar para").fill(`${when}T09:30`);
  await box.fill("Bom dia! Ainda tem interesse no HR-V?");
  await page.getByRole("button", { name: "Agendar", exact: true }).click();
  const sched = page.getByTestId("agendadas");
  await expect(sched).toContainText("09:30");
  await expect(sched).toContainText("Bom dia! Ainda tem interesse no HR-V?");
  // Editar o agendado: texto com #periodo-dia e novo horário.
  await sched.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByLabel("Agendar para")).toHaveValue(`${when}T09:30`);
  await page.getByLabel("Agendar para").fill(`${when}T10:15`);
  await box.fill("#periodo-dia! Ainda tem interesse no HR-V?");
  await page.getByRole("button", { name: "Salvar agendamento" }).click();
  await expect(sched).toContainText("10:15");
  await expect(sched).toContainText("#periodo-dia! Ainda tem interesse no HR-V?");
  await sched.getByRole("button", { name: "Cancelar" }).click();
  await expect(sched).toHaveCount(0);

  if (mobile) {
    await page.getByRole("button", { name: "Mais opções" }).click();
    await page.screenshot({ path: `test-results/conversa-mais-${testInfo.project.name}.png` });
    await page.getByRole("button", { name: "Mais opções" }).click();
  }
  await page.screenshot({ path: `test-results/conversa-${testInfo.project.name}.png` });
  // Áudio gravado no navegador: vai como mensagem de voz do WhatsApp.
  const sentBefore = ((await (await fetch(`${FAKE}/__test/sent`)).json()) as unknown[]).length;
  await page.getByRole("button", { name: "Gravar áudio" }).click();
  await expect(page.getByTestId("gravando")).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `test-results/gravando-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Enviar áudio" }).click();
  await expect(page.getByTestId("gravando")).toHaveCount(0);
  await expect
    .poll(async () => {
      const sent = (await (await fetch(`${FAKE}/__test/sent`)).json()) as { kind: string }[];
      return sent.slice(sentBefore).map((x) => x.kind);
    })
    .toContain("sendWhatsAppAudio");
  await expect(page.getByTestId("thread-messages").locator("audio").last()).toBeVisible();

  // Resumo da IA
  await page.getByTestId("resumo-ia").getByRole("button", { name: "Resumir com IA" }).click();
  await expect(page.getByTestId("resumo-ia")).toContainText("Morno · 5/10");

  // Agendar pela negociação no CRM e editar na tela Agendadas.
  await page.goto("/crm");
  await page.getByTestId("deal-card").filter({ hasText: "Cliente Teste" }).first().click();
  const ag = page.getByRole("dialog", { name: "Negociação" }).getByTestId("agendar-negociacao");
  await ag.getByLabel("Mensagem para agendar").fill("Oi Maria, passando para confirmar a visita.");
  await ag.getByLabel("Enviar em").fill(`${when}T16:45`);
  await ag.getByRole("button", { name: "Agendar" }).click();
  await expect(ag).toContainText("Oi Maria, passando para confirmar a visita.");
  await page.goto("/agendadas");
  const item = page.getByTestId("programada").filter({ hasText: "confirmar a visita" });
  await item.getByRole("button", { name: "Editar" }).click();
  const editing = page.getByTestId("programada").filter({ has: page.getByLabel("Texto agendado") });
  await editing.getByLabel("Texto agendado").fill("Oi Maria, visita confirmada para amanhã?");
  await editing.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    page.getByTestId("programada").filter({ hasText: "visita confirmada para amanhã" }),
  ).toBeVisible();

  // Conversas filtradas pela etapa do CRM.
  await page.goto("/conversas");
  const items = page.getByTestId("conversation-item");
  await expect(items.filter({ hasText: "Cliente Teste" })).toHaveCount(1);
  await page.getByLabel("Etapa do CRM").selectOption({ label: "Proposta" });
  await expect(items).toHaveCount(0);
  await page.getByLabel("Etapa do CRM").selectOption({ label: "Novo lead" });
  await expect(items.filter({ hasText: "Cliente Teste" })).toHaveCount(1);

  // Campanha (pelo menu, a partir do Início)
  await page.goto("/");
  await openFromMenu(page, "Campanhas");
  await expect(page.getByText("Nenhuma campanha")).toBeVisible();
  await page.getByRole("button", { name: "Nova campanha" }).click();
  const dlg = page.getByRole("dialog", { name: "Nova campanha" });
  await dlg.getByLabel("Nome (só para você)").fill("Feirão");
  await dlg.getByLabel(/^Mensagem/).fill("Oi {nome}! Feirão sábado.");
  await expect(dlg.getByText("Oi Maria! Feirão sábado.")).toBeVisible();
  await expect(dlg.getByTestId("publico")).toContainText("1 contato(s)");
  await dlg.getByRole("button", { name: "Criar campanha" }).click();
  await expect(dlg).toBeHidden();
  const camp = page.getByTestId("campanha").filter({ hasText: "Feirão" });
  await expect(camp).toContainText("de 1");
  await camp.getByRole("button", { name: "Pausar" }).click();
  await expect(camp).toContainText("Pausada");
  await page.screenshot({ path: `test-results/campanhas-${testInfo.project.name}.png`, fullPage: true });
});
