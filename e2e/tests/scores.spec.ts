// M3: the teacher scores a lesson in the journal (attendance, points, a reversal) and in the grid (quick entry), the guardian sees the result on a
// phone, and the admin's policy editor checks the component sum live. Data: the stack's "E2E chorak" and yesterday's
// lesson of the planner teacher in 7-A.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login, loginToDashboard, choose } from "../support/login";
import { USERS } from "../support/users";

test("journal: attendance, points and a reversal", async ({ page }) => {
  await loginToDashboard(page, USERS.planner);
  await page.getByTestId("sidebar").getByRole("link", { name: "Jurnal" }).click();
  await choose(page.getByRole("combobox", { name: "Guruh va fan" }), "7-A · E2E reja fani");
  const grid = page.getByTestId("gradebook");
  await expect(grid).toBeVisible();
  await grid.locator("thead a").first().click();

  const row = page.getByTestId("journal").locator("[data-student]").first();
  await expect(row).toBeVisible();
  const studentId = await row.getAttribute("data-student");
  await row.getByRole("button", { name: "Keldi" }).click();
  await expect(row.getByRole("button", { name: "Keldi" })).toHaveAttribute("aria-pressed", "true");
  await row.locator('[data-points="5"]').click();
  await expect(row.getByTestId("lesson-points")).toHaveText("5");
  await row.getByRole("button", { name: "Bekor qilish" }).click();
  await expect(row.getByTestId("lesson-points")).toHaveText("0");
  await row.locator('[data-points="4"]').click();
  await expect(row.getByTestId("lesson-points")).toHaveText("4");

  await page.getByRole("link", { name: "Orqaga" }).click();
  // Other specs add students to 7-A later in the period: look up the scored one.
  const gridRow = grid.locator(`[data-student="${studentId}"]`);
  const cell = gridRow.locator('[data-cell$=":0"]');
  await expect(cell).toHaveText("4");
  // Quick entry in the grid: digits, then Enter.
  await cell.focus();
  await page.keyboard.type("3");
  await expect(cell).toHaveText("+3");
  await page.keyboard.press("Enter");
  await expect(cell).toHaveText("7");
  await expect(gridRow.getByTestId("row-percent")).toHaveText("70");
  // The lesson maximum is 10: four more points are refused.
  await cell.focus();
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible();
  await expect(cell).toHaveText("7");
  // Arrows move between cells.
  const r = Number((await cell.getAttribute("data-cell"))!.split(":")[0]);
  await cell.focus();
  await page.keyboard.press(r > 0 ? "ArrowUp" : "ArrowDown");
  await expect(grid.locator(`[data-cell="${r > 0 ? r - 1 : r + 1}:0"]`)).toBeFocused();
});

test("the guardian sees the child's percent on a phone", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await login(page, USERS.guardian);
  await page.getByTestId("tab-bar").getByRole("link", { name: "Baholar" }).click();
  await page.getByRole("tab", { name: "Chorak" }).click();
  const subject = page.getByTestId("subjects").locator("li").filter({ hasText: "E2E reja fani" });
  await expect(subject.getByTestId("subject-percent")).toHaveText("70%");
  await expect(page.getByTestId("overall")).toContainText("70%");
  await expectNoHorizontalScroll(page);
  await page.close();
});

test("the policy editor checks the component sum as you type", async ({ page }) => {
  await loginToDashboard(page, USERS.importer);
  await page.getByTestId("sidebar").getByRole("link", { name: "Baholash" }).click();
  await page.getByRole("button", { name: "Shu asosda yangi versiya" }).click();
  await expect(page.getByRole("combobox", { name: "Versiya" })).toContainText("v2");
  await page.getByRole("textbox", { name: "Maksimum", exact: true }).nth(1).fill("40");
  await expect(page.getByTestId("components-sum")).toHaveText("Yig'indi: 90 / 100");
  await expect(page.getByTestId("policy-problems")).toContainText("davr maksimumiga teng emas");
  await expect(page.getByRole("button", { name: "E'lon qilish" })).toBeDisabled();
});
