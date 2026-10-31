import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test("the collapsed sidebar stays collapsed after a reload", async ({ page }) => {
  await loginToDashboard(page, USERS.sidebar);
  const sidebar = page.getByTestId("sidebar");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await page.getByTestId("sidebar-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.waitForTimeout(300);
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.getByTestId("sidebar-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
});

test.describe("mobile (375 px)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("no horizontal scroll; the menu opens as a drawer", async ({ page }) => {
    await page.goto("/login");
    await expectNoHorizontalScroll(page);
    await loginToDashboard(page, USERS.mobile);
    await expectNoHorizontalScroll(page);
    await expect(page.getByTestId("sidebar")).toBeHidden();
    await page.getByTestId("drawer-open").click();
    const drawer = page.locator("dialog[open]");
    await expect(drawer.getByRole("link", { name: "O'quvchilar" })).toBeVisible();
    await drawer.getByRole("link", { name: "O'quvchilar" }).click();
    await expect(page).toHaveURL(/\/admin\/students$/);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test("language switch: every text follows, and the choice is kept", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tizimga kirish");
  await page.getByTestId("locale-switcher").selectOption("ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Вход в систему");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Вход в систему");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByTestId("locale-switcher").selectOption("uz");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tizimga kirish");
});
