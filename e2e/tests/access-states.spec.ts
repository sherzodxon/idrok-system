// Menus follow permissions (the API checks again), and pages show empty and error states.
import { expect, test } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test("a teacher sees the teacher menu only, and an empty state for groups", async ({ page }) => {
  await loginToDashboard(page, USERS.teacher);
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar.getByRole("link", { name: "Mening guruhlarim" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Sozlamalar" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Import" })).toHaveCount(0);

  await sidebar.getByRole("link", { name: "Mening guruhlarim" }).click();
  await expect(page.getByText("Sizga hali guruh biriktirilmagan")).toBeVisible();

  // Typing the admin URL does not help: the API refuses, the page says so.
  await page.goto("/admin/settings");
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test("a failing API shows the error state with a retry", async ({ page }) => {
  await loginToDashboard(page, USERS.importer);
  let fail = true;
  await page.route(/\/api\/v1\/guardians(\?|$)/, (route) =>
    fail
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "errors.INTERNAL_ERROR" } }),
        })
      : route.continue(),
  );
  await page.goto("/admin/guardians");
  const alert = page.getByRole("alert").filter({ hasText: "Ma'lumotni yuklab bo'lmadi" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  fail = false;
  await alert.getByRole("button", { name: "Qayta urinish" }).click();
  await expect(alert).toHaveCount(0);
});

test("pages are served with a nonce CSP and run without violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/login");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(res?.headers()["x-frame-options"]).toBe("DENY");
  await loginToDashboard(page, USERS.importer);
  await page.goto("/admin/students");
  await expect(page.getByTestId("students-table")).toBeVisible();
  expect(violations).toEqual([]);
});
