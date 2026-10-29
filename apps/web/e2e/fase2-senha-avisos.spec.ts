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

test("esqueci a senha pelo WhatsApp e aviso de mensagem no navegador", async ({
  page,
  context,
}, testInfo) => {
  const tag = `${run}-${testInfo.project.name}`;
  const mobile = testInfo.project.name === "mobile";
  const email = `adm-senha-${tag}@teste.com`;
  const fone = mobile ? "48977770002" : "48977770001";

  await loginOk(page, MASTER.email, MASTER.password);
  await page.goto("/master");
  await page.getByLabel("Nome da empresa").fill(`Senha ${tag}`);
  await page.getByLabel("Nome do administrador").fill("Admin Senha");
  await page.getByLabel("E-mail do administrador").fill(email);
  await page.getByRole("button", { name: "Criar empresa" }).click();
  const link = (await page.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.goto(new URL(link).pathname);
  await page.getByLabel("Crie uma senha").fill("Admin12345");
  await page.getByRole("button", { name: "Aceitar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // WhatsApp conectado e telefone cadastrado em Conta.
  await page.goto("/conexoes");
  await page.getByLabel("Nome da conexão").fill("Loja");
  await page.getByRole("button", { name: "Criar e mostrar QR code" }).click();
  await expect(page.getByRole("dialog", { name: "Conectar Loja" })).toBeVisible();
  await fetch(`${FAKE}/__test/scan-latest`, { method: "POST" });
  await expect(page.getByText("WhatsApp conectado", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.goto("/conta");
  await page.getByLabel("Telefone com DDD").fill(fone);
  await page.getByRole("button", { name: "Salvar telefone" }).click();
  await expect(page.getByText("Telefone salvo", { exact: false })).toBeVisible();
  await expect(page.getByTestId("avisos-navegador")).toContainText("Avisos neste navegador");

  // Aviso no navegador: aba "escondida" e notificação simulada.
  if (!mobile) {
    await context.grantPermissions(["notifications"]);
    await page.addInitScript(() => {
      const w = window as unknown as { __notices: string[] };
      w.__notices = [];
      Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
      class FakeNotification {
        static permission = "granted";
        static requestPermission = async () => "granted";
        onclick: (() => void) | null = null;
        constructor(title: string, opts?: { body?: string }) {
          w.__notices.push(`${title} | ${opts?.body ?? ""}`);
        }
        close() {}
      }
      (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    });
    await page.goto("/crm");
    await page.waitForTimeout(800);
    await fetch(`${FAKE}/__test/incoming`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "5511977776666", text: "Oi, ainda tem o Onix?" }),
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __notices: string[] }).__notices.join("\n")))
      .toContain("Lead novo: Cliente Teste | Oi, ainda tem o Onix?");
    await expect(page).toHaveTitle(/^\(1\) /);
  }

  // Esqueci a senha.
  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL(/\/login/);
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Mandar link" }).click();
  await expect(page.getByText("mandamos o link agora")).toBeVisible();
  let resetLink = "";
  await expect
    .poll(async () => {
      const sent = (await (await fetch(`${FAKE}/__test/sent`)).json()) as {
        to: string;
        body: { text?: string };
      }[];
      const msg = sent.filter((s) => s.to.includes(fone) && /redefinir-senha/.test(s.body.text ?? "")).at(-1);
      resetLink = msg?.body.text?.match(/https?:\/\/\S+redefinir-senha\?t=[\w-]+/)?.[0] ?? "";
      return resetLink;
    })
    .toContain("redefinir-senha");
  const path = new URL(resetLink).pathname + new URL(resetLink).search;
  await page.goto(path);
  await page.locator("input[name=password]").fill("NovaSenha123");
  await page.getByLabel("Repita a nova senha").fill("NovaSenha123");
  await page.getByRole("button", { name: "Salvar e entrar" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  // Link usado não vale de novo.
  await page.goto(path);
  await expect(page.getByText("Link vencido")).toBeVisible();
  await page.screenshot({ path: `test-results/senha-${testInfo.project.name}.png` });
});
