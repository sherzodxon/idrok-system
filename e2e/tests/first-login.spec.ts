import { expect, test } from "@playwright/test";
import { login } from "../support/login";
import { TEMP_PASSWORD, USERS } from "../support/users";

test("first login: temporary password → forced change → dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/); // no session → login page

  await login(page, USERS.firstLogin, TEMP_PASSWORD);
  await expect(page).toHaveURL(/\/change-password$/);

  // Nothing else is reachable until the password is changed.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/change-password$/);

  const fields = page.locator('input[type="password"]');
  await fields.nth(0).fill(TEMP_PASSWORD);
  await fields.nth(1).fill("Yangi-demo-parol-7");
  await fields.nth(2).fill("Yangi-demo-parol-7");
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dashboard-title")).toBeVisible();
  await expect(page.getByTestId("sidebar")).toBeVisible();
});

test("wrong password shows the translated error and stays on the login page", async ({ page }) => {
  await login(page, USERS.theme, "xato-parol-123");
  await expect(page.locator("form [role=alert]")).toHaveText("Login yoki parol noto'g'ri");
  await expect(page).toHaveURL(/\/login$/);
});
