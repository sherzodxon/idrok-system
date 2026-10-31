import { expect, type Page } from "@playwright/test";
import { PASSWORD } from "./users";

export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
}

export async function loginToDashboard(page: Page, username: string) {
  await login(page, username);
  await expect(page.getByTestId("dashboard-title")).toBeVisible();
}

/** No element wider than the viewport (CLAUDE.md §4: no horizontal scroll on mobile). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
