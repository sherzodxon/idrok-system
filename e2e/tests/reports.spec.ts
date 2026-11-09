// Audit phase 6: the reports centre — an admin sees the reports they may take and downloads an Excel file.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test("an admin downloads the attendance report", async ({ page }) => {
  await loginToDashboard(page, USERS.coinAdmin);
  await page.getByTestId("sidebar").getByRole("link", { name: "Hisobotlar" }).click();
  const reports = page.getByTestId("reports");
  for (const kind of ["attendance", "staff-attendance", "scores", "coins"])
    await expect(reports.locator(`[data-report="${kind}"]`)).toBeVisible();
  const card = reports.locator('[data-report="attendance"]');
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "Excel yuklab olish" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^attendance-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("the reports page on a phone", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await loginToDashboard(page, USERS.coinAdmin);
  await page.goto("/admin/reports");
  await expect(page.getByTestId("reports")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();
});
