// Users: the admin creates a login for a new employee card (password shown once), finds it by name, opens the user
// page and changes the login name.
import { expect, test } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test.describe.configure({ mode: "serial" });

test("a new employee login, then a new login name", async ({ page }) => {
  await loginToDashboard(page, USERS.coinAdmin);
  await page.getByTestId("sidebar").getByRole("link", { name: "Sozlamalar" }).click();
  await page.getByRole("tab", { name: "Foydalanuvchilar" }).click();
  await page.getByTestId("new-user").click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Familiya").fill("Yangixodim");
  await drawer.getByLabel("Ism").fill("Demo");
  await page.getByTestId("drawer-save").click();
  await expect(page.getByTestId("secret-username")).toHaveText("demo.yangixodim");
  await page.keyboard.press("Escape");

  await page.getByRole("searchbox", { name: "Login yoki ism" }).fill("yangixodim");
  await page.getByTestId("users-table").locator("tr", { hasText: "Yangixodim Demo" }).click();
  await expect(page.getByRole("heading", { name: "Demo Yangixodim" })).toBeVisible();
  await expect(page.getByTestId("user-account")).toContainText("Vaqtinchalik parol");

  await page.getByTestId("change-username").click();
  await page.getByRole("dialog").getByLabel("Yangi login").fill("demo.xodim");
  await page.getByTestId("save-username").click();
  await expect(page.getByTestId("user-account")).toContainText("demo.xodim");
});
