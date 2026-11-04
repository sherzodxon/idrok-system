import { expect, type Locator, type Page } from "@playwright/test";
import { API_URL, PASSWORD } from "./users";

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

/** POST to the API as the logged-in browser user (cookie session + CSRF header, like the web app). */
export async function apiPost<T>(page: Page, path: string, data: unknown): Promise<T> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "idrok_csrf")?.value ?? "";
  const res = await page.request.post(`${API_URL}${path}`, { data, headers: { "X-CSRF-Token": csrf } });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/**
 * Picks an option of the app's Select (ui/select.tsx): opens the list from its button and clicks the option — by its
 * label, or by value (looked up in the hidden native select next to the button).
 */
export async function choose(trigger: Locator, option: string | { value: string }) {
  let label = typeof option === "string" ? option : null;
  if (label === null) {
    const value = (option as { value: string }).value;
    label = await trigger
      .locator("xpath=preceding-sibling::select")
      .evaluate((s: HTMLSelectElement, v: string) => [...s.options].find((o) => o.value === v)?.text ?? null, value);
    if (label === null) throw new Error(`no option with value ${value}`);
  }
  await trigger.click();
  const list = trigger.page().locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
  await list.getByRole("option", { name: label, exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
