import { expect, type Page } from "@playwright/test";

/** Abre uma tela pelo menu: no celular pela aba "Mais"; no computador abre as categorias fechadas. */
export async function openFromMenu(page: Page, name: string) {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) {
    await page.getByRole("button", { name: "Mais" }).click();
    await page.getByRole("dialog", { name: "Mais" }).getByRole("link", { name, exact: true }).click();
    return;
  }
  // Repete: a página pode ainda estar redirecionando (ex.: logo depois de entrar).
  const side = page.locator("aside nav");
  await expect(async () => {
    const closed = side.locator('button[aria-expanded="false"]');
    while ((await closed.count()) > 0) await closed.first().click({ timeout: 2_000 });
    await side.getByRole("link", { name, exact: true }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
