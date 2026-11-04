// M4: the planner teacher (E2E reja fani in 7-A) adds a question to the bank, builds and publishes a test; the
// student takes it on a phone and sees the result; the teacher sees the participant.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login, loginToDashboard, choose } from "../support/login";
import { USERS } from "../support/users";

test.describe.configure({ mode: "serial" });

test("the teacher builds and publishes a test", async ({ page }) => {
  await loginToDashboard(page, USERS.planner);
  await page.getByTestId("sidebar").getByRole("link", { name: "Savollar banki" }).click();
  await page.getByRole("button", { name: "Savol qo'shish" }).click();
  const drawer = page.getByRole("dialog");
  await choose(drawer.getByLabel("Fan", { exact: true }), "E2E reja fani");
  await choose(drawer.getByLabel("Sinf (parallel)"), "7");
  await drawer.getByLabel("Savol", { exact: true }).fill("12 × 12 = ?");
  for (const [letter, text] of [
    ["A", "124"],
    ["B", "144"],
    ["C", "132"],
    ["D", "154"],
  ] as const)
    await drawer.getByLabel(`${letter} varianti`).fill(text);
  await drawer.getByLabel("B — to'g'ri javob").check();
  await page.getByTestId("drawer-save").click();
  await expect(page.getByTestId("questions")).toContainText("12 × 12 = ?");

  await page.getByTestId("sidebar").getByRole("link", { name: "Testlar" }).click();
  await page.getByRole("button", { name: "Yangi test" }).click();
  await drawer.getByLabel("Test nomi").fill("E2E ko'paytirish");
  await choose(drawer.getByLabel("Fan", { exact: true }), "E2E reja fani");
  await choose(drawer.getByLabel("Sinf (parallel)"), "7");
  await choose(drawer.getByLabel("Turi"), "Oddiy test");
  await drawer.getByLabel("7-A").check();
  await page.getByTestId("drawer-save").click();
  await expect(page.getByRole("heading", { name: "E2E ko'paytirish" })).toBeVisible();
  await expect(page.getByTestId("test-problems")).toContainText("savollar tanlanmagan");

  await choose(page.getByLabel("Natijani ko'rsatish"), { value: "IMMEDIATE" });
  await page.getByRole("button", { name: "Sozlamalarni saqlash" }).click();
  await page.getByRole("tab", { name: "Savollar" }).click();
  await page.getByTestId("bank-picker").getByRole("button", { name: "Qo'shish" }).first().click();
  await page.getByTestId("save-questions").click();
  await expect(page.getByTestId("test-problems")).toBeHidden();
  await page.getByTestId("publish").click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.getByText("Ochiq", { exact: true })).toBeVisible();
});

test("the student takes it on a phone and sees the result", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await login(page, USERS.student);
  await page.getByTestId("tab-bar").getByRole("link", { name: "Testlar" }).click();
  const card = page.getByTestId("my-tests").locator("li").filter({ hasText: "E2E ko'paytirish" });
  await card.getByRole("button", { name: "Boshlash" }).click();
  await expect(page.getByTestId("attempt")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByTestId("question").getByText("144", { exact: true }).click();
  await expect(page.getByText(/Saqlanmagan/)).toBeHidden();
  await page.getByTestId("finish").click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.getByTestId("result-percent")).toHaveText("100%");
  await page.close();
});

test("the teacher sees the participant", async ({ page }) => {
  await loginToDashboard(page, USERS.planner);
  await page.getByTestId("sidebar").getByRole("link", { name: "Testlar" }).click();
  await page.getByTestId("tests").getByText("E2E ko'paytirish").first().click();
  await expect(page.getByTestId("test-summary")).toContainText(/1 \/ \d/);
  await expect(page.getByTestId("test-students")).toContainText("100");
});
