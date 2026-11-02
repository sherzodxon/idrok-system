// M2 step 6 (runs after timetable.spec, which publishes 7-A lessons from tomorrow on):
// the admin cancels a lesson, the guardian sees the child's week, the teacher sees today's lessons and their week.
import { expect, test } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test("cancel a lesson; the guardian's week shows it", async ({ page, browser }) => {
  await loginToDashboard(page, USERS.importer);
  await page.goto("/admin/lessons");
  await page.getByTestId("lessons-class").selectOption({ label: "7-A" });
  await page.getByRole("button", { name: "Keyingi hafta" }).click();
  const first = page.locator("[data-lesson]").filter({ hasText: "E2E jadval fani" }).first();
  await expect(first).toBeVisible();
  await first.getByTestId("lesson-cancel").click();
  await page.getByTestId("cancel-reason").fill("Sport musobaqasi");
  await page.getByTestId("drawer-save").click();
  await expect(page.locator("[data-lesson]").filter({ hasText: "Sport musobaqasi" })).toContainText("Bekor qilingan");

  // The guardian's child is in 7-A.
  const guardian = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await guardian.goto("/login");
  await guardian.locator('input[name="username"]').fill(USERS.guardian);
  await guardian.locator('input[name="password"]').fill("Demo-parol-2026");
  await guardian.locator('button[type="submit"]').click();
  await guardian.getByTestId("tab-bar").getByRole("link", { name: "Jadval" }).click();
  await guardian.getByRole("button", { name: "Keyingi hafta" }).click();
  await expect(guardian.locator("[data-lesson]").filter({ hasText: "E2E jadval fani" }).first()).toBeVisible();
  await expect(guardian.locator("[data-lesson]").filter({ hasText: "Bekor qilingan" })).toHaveCount(1);
  await guardian.close();
});

test("a teacher sees today's lessons and their week", async ({ page }) => {
  await loginToDashboard(page, USERS.planner);
  await expect(page.getByText("Bugungi darslarim")).toBeVisible();
  await expect(page.getByText("Bugun darsingiz yo'q")).toBeVisible();
  await page.getByTestId("sidebar").getByRole("link", { name: "Jadvalim" }).click();
  await expect(page.getByTestId("week-range")).toBeVisible();
  // The stack's lesson of yesterday (for the M3 journal) is in this week from Tuesday on: either way, no timetable.
  await expect(
    page
      .getByText("Bu haftada dars yo'q")
      .or(page.locator("[data-lesson]").filter({ hasText: "E2E reja fani" }))
      .first(),
  ).toBeVisible();
});
