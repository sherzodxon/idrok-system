import { expect, test } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test("LIGHT / DARK / SYSTEM switch and persist across reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await loginToDashboard(page, USERS.theme);
  const html = page.locator("html");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightBg = await background();

  await page.locator('[data-theme-option="DARK"]').first().click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const darkBg = await background();
  expect(darkBg).not.toBe(lightBg);

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await background()).toBe(darkBg);

  // SYSTEM follows the OS: no attribute, and the OS scheme decides.
  await page.locator('[data-theme-option="SYSTEM"]').first().click();
  await expect(html).not.toHaveAttribute("data-theme", /.+/);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).toBe(darkBg);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await background()).toBe(lightBg);
});

test("the saved theme follows the user to a new device", async ({ browser }) => {
  const first = await browser.newPage();
  await loginToDashboard(first, USERS.sidebar);
  await first.locator('[data-theme-option="DARK"]').first().click();
  await expect(first.locator("html")).toHaveAttribute("data-theme", "dark");
  await first.waitForTimeout(300); // preference PATCH

  const other = await (await browser.newContext()).newPage(); // fresh cookies = another device
  await loginToDashboard(other, USERS.sidebar);
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
});
