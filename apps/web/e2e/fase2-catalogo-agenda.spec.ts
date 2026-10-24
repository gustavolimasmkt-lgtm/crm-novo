import { expect, type Page, test } from "@playwright/test";

const MASTER = {
  email: process.env.E2E_MASTER_EMAIL ?? "master@local.test",
  password: process.env.E2E_MASTER_PASSWORD ?? "Master12345",
};
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

/** Próxima segunda-feira com folga de 2 dias (horário de Brasília). */
function nextMonday() {
  let d = new Date(Date.now() + 2 * 86_400_000);
  const br = (x: Date) => new Date(x.getTime() - 3 * 3600_000);
  while (br(d).getUTCDay() !== 1) d = new Date(d.getTime() + 86_400_000);
  return br(d).toISOString().slice(0, 10);
}

test("catálogo, agenda e rodízio: cadastra, simula o agente, marca visita e configura avisos", async ({
  page,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  page.on("dialog", (d) => d.accept());

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Loja F2 ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin F2");
  await page.getByLabel("E-mail do administrador").fill(`adm-f2-${tag}@teste.com`);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // Catálogo pelo menu
  if (mobile) await page.getByRole("button", { name: "Mais" }).click();
  await page.getByRole("link", { name: "Catálogo" }).first().click();
  await expect(page.getByRole("heading", { name: "Catálogo" })).toBeVisible();
  await expect(page.getByText("Catálogo vazio")).toBeVisible();

  // Importa do sistema antigo
  await page.getByTestId("importar-catalogo").setInputFiles({
    name: "agente.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        catalogo: [{ titulo: "Fiat Mobi Like 2022", descricao: "Branco", valor: "52.900,00" }],
      }),
    ),
  });
  await expect(page.getByText("Importado: 1 novo(s), 0 atualizado(s).")).toBeVisible();
  await expect(page.getByRole("button", { name: /Fiat Mobi Like 2022/ })).toBeVisible();

  // Novo item com foto
  await page.getByRole("button", { name: "Novo item" }).click();
  const sheet = page.getByRole("dialog", { name: "Novo item" });
  await sheet.getByLabel("Título").fill("Honda HR-V EXL 2020");
  await sheet.getByLabel("Preço (R$)").fill("119.900,00");
  await sheet.getByLabel(/Descrição/).fill("Prata, 45 mil km, automático");
  await sheet
    .getByTestId("fotos-produto")
    .setInputFiles({ name: "frente.png", mimeType: "image/png", buffer: PNG });
  await expect(sheet.getByText("Fotos (1/8)")).toBeVisible();
  await sheet.getByRole("button", { name: "Salvar" }).click();
  await expect(sheet).toBeHidden();
  const card = page.getByRole("button", { name: /Honda HR-V EXL 2020/ });
  await expect(card).toContainText("R$ 119.900,00");
  await expect(card).toContainText("1 foto");
  await page.getByLabel("Buscar no catálogo").fill("hrv");
  await expect(page.getByRole("button", { name: /Fiat Mobi/ })).toBeHidden();
  await expect(card).toBeVisible();

  // Agenda: libera a IA
  await page.goto("/agenda");
  await expect(page.getByText("Nenhuma visita marcada")).toBeVisible();
  await page.getByRole("button", { name: "Horários e IA" }).click();
  const cfg = page.getByRole("dialog", { name: "Horários e IA" });
  await cfg.getByLabel(/IA pode marcar visitas/).check();
  await cfg.getByLabel("Duração da visita (min)").fill("60");
  await cfg.getByRole("button", { name: "Salvar" }).click();
  await expect(cfg.getByText("Agenda salva.")).toBeVisible();
  await cfg.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByText("Visitas · o agente de IA pode marcar")).toBeVisible();

  // Agente mostra as ferramentas e usa no simulador
  await page.goto("/agente");
  const tools = page.getByTestId("ferramentas-agente");
  await expect(tools).toContainText("2 itens: busca e envia fotos");
  await expect(tools).toContainText("marca visitas sozinho");
  await page
    .getByLabel("Instruções do agente")
    .fill("Você é o assistente da Loja F2. Vendemos carros seminovos.");
  await page.getByLabel("Mensagem de teste").fill("tem hrv? manda foto");
  await page.getByRole("button", { name: "Enviar teste" }).click();
  const sim = page.getByTestId("sim-messages");
  await expect(sim).toContainText("1 foto(s) de Honda HR-V EXL 2020");
  await expect(sim).toContainText("enviaria as fotos de 1 item");
  const day = nextMonday();
  await page.getByLabel("Mensagem de teste").fill(`pode marcar visita ${day} 10:00`);
  await page.getByRole("button", { name: "Enviar teste" }).click();
  await expect(sim).toContainText("(simulação: nada foi salvo)");

  // Marca uma visita na mão e registra o comparecimento
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Marcar visita" }).click();
  const form = page.getByRole("dialog", { name: "Marcar visita" });
  await form.getByLabel("Telefone do cliente").fill("(11) 97777-0001");
  await form.getByLabel(/^Nome/).fill("Carlos Visita");
  await form.getByLabel("Dia").fill(day);
  await form.getByLabel("Hora").fill("10:00");
  await form.getByLabel("Observação").fill("Quer ver o HR-V");
  await form.getByRole("button", { name: "Marcar" }).click();
  await expect(form).toBeHidden();
  const visita = page.getByTestId("visita").filter({ hasText: "Carlos Visita" });
  await expect(visita).toContainText("10:00");
  await expect(visita).toContainText("Quer ver o HR-V");
  await expect(visita).toContainText("Marcada");
  await visita.getByRole("button", { name: "Compareceu" }).click();
  await expect(visita).toContainText("Compareceu");

  // Rodízio e telefone para avisos
  await page.goto("/conta");
  await page.getByLabel("Telefone com DDD").fill("(48) 98888-7777");
  await page.getByRole("button", { name: "Salvar telefone" }).click();
  await expect(page.getByText("Telefone salvo.")).toBeVisible();
  await page.goto("/equipe");
  const rot = page.locator("form").filter({ hasText: "Distribuição de leads" });
  await expect(rot).toContainText("avisos ok");
  await rot.getByLabel("Rodízio ligado").check();
  await rot.getByRole("checkbox", { name: /Admin F2/ }).check();
  await rot.getByRole("button", { name: "Salvar rodízio" }).click();
  await expect(rot.getByText("Rodízio salvo.")).toBeVisible();

  await page.screenshot({ path: `test-results/fase2-${testInfo.project.name}.png`, fullPage: true });
});
