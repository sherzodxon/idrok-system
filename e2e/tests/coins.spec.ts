// M5: the admin adds a criterion and a product; the planner teacher (7-A) gives coins; the student buys on a phone;
// the admin approves and delivers the order.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login, loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test.describe.configure({ mode: "serial" });

test("the admin adds a criterion and a product", async ({ page }) => {
  await loginToDashboard(page, USERS.coinAdmin);
  await page.getByTestId("sidebar").getByRole("link", { name: "Coin", exact: true }).click();
  await page.getByRole("tab", { name: "Mezonlar" }).click();
  await page.getByRole("button", { name: "Mezon qo'shish" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Nomi").fill("E2E faollik");
  await drawer.getByLabel("Eng kam").fill("1");
  await drawer.getByLabel("Eng ko'p").fill("5");
  await drawer.getByLabel("Kim foydalanadi").selectOption("ALL_TEACHERS");
  await page.getByTestId("drawer-save").click();
  await expect(page.getByTestId("coin-criteria")).toContainText("E2E faollik");

  await page.getByTestId("sidebar").getByRole("link", { name: "Coin do'koni" }).click();
  await page.getByRole("tab", { name: "Mahsulotlar" }).click();
  await page.getByRole("button", { name: "Mahsulot qo'shish" }).click();
  await drawer.getByLabel("Mahsulot").fill("E2E ruchka");
  await drawer.getByLabel("Narxi").fill("3");
  await drawer.getByLabel("Qoldiq").fill("5");
  await page.getByTestId("drawer-save").click();
  await expect(page.getByTestId("coin-products")).toContainText("E2E ruchka");
});

test("the teacher gives coins from the student card", async ({ page }) => {
  await loginToDashboard(page, USERS.planner);
  await page.getByTestId("sidebar").getByRole("link", { name: "Coin", exact: true }).click();
  await page
    .getByTestId("coin-students")
    .getByRole("button", { name: /Farzand Demo/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mezon").selectOption({ label: "E2E faollik" });
  await dialog.getByRole("radio", { name: "5", exact: true }).click();
  await expect(dialog.getByTestId("coin-capacity")).toBeVisible();
  await page.getByTestId("give-coins").click();
  await expect(page.getByTestId("coin-students").getByRole("button", { name: /Farzand Demo/ })).toContainText("5 coin");
});

test("the student buys on a phone", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await login(page, USERS.student);
  await page.getByTestId("tab-bar").getByRole("link", { name: "Coin" }).click();
  await expect(page.getByTestId("coin-balance")).toHaveText("5");
  await expectNoHorizontalScroll(page);
  await page.getByRole("tab", { name: "Do'kon" }).click();
  const card = page.getByTestId("catalog").locator("li").filter({ hasText: "E2E ruchka" });
  await card.getByRole("button", { name: "Sotib olish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.getByTestId("coin-balance")).toHaveText("2");
  await page.getByRole("tab", { name: "Buyurtmalarim" }).click();
  await expect(page.getByTestId("my-orders")).toContainText("Kutilmoqda");
  await expectNoHorizontalScroll(page);
  await page.close();
});

test("the admin approves and delivers the order", async ({ page }) => {
  await loginToDashboard(page, USERS.coinAdmin);
  await page.getByTestId("sidebar").getByRole("link", { name: "Coin do'koni" }).click();
  const orders = page.getByTestId("coin-orders");
  await expect(orders).toContainText("E2E ruchka");
  await orders.getByRole("button", { name: "Tasdiqlash" }).first().click();
  await page.getByRole("tab", { name: /Tasdiqlangan/ }).click();
  await orders.getByRole("button", { name: "Topshirildi" }).first().click();
  await page.getByRole("tab", { name: /Topshirilgan/ }).click();
  await expect(orders).toContainText("E2E ruchka");
});
