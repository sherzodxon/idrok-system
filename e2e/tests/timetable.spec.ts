// M2 step 2: the admin builds a timetable draft in the grid, sees a conflict, fixes it and publishes.
import { expect, test } from "@playwright/test";
import { apiPost, loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test("build, fix a conflict and publish a timetable", async ({ page }) => {
  await loginToDashboard(page, USERS.importer);
  // Own reference data, so the test does not depend on other specs.
  await apiPost(page, "/subjects", { name: "E2E jadval fani" });
  await apiPost(page, "/employees", { firstName: "E2E", lastName: "Jadvalchi" });

  await page.goto("/admin/timetable");
  await page.getByTestId("timetable-new").click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.getByTestId("timetable-version")).toContainText("Qoralama");
  await page.getByTestId("timetable-target").selectOption({ label: "7-A" });

  const addLesson = async (cell: string) => {
    await page.locator(`[data-cell="${cell}"]`).click();
    await page.getByTestId("cell-subject").selectOption({ label: "E2E jadval fani" });
    await page.getByTestId("cell-teacher").selectOption({ label: "Jadvalchi E2E" });
    await page.getByTestId("drawer-save").click();
    await expect(page.locator(`[data-cell="${cell}"]`)).toContainText("E2E jadval fani");
  };
  await addLesson("1-1");
  await addLesson("3-2");

  // A second lesson for the same class in the same slot is a conflict; publishing is blocked.
  await addLesson("1-1");
  await expect(page.getByTestId("timetable-conflicts")).toBeVisible();
  await expect(page.getByTestId("timetable-publish")).toBeDisabled();
  await page.locator('[data-cell="1-1"]').click();
  await page.getByTestId("cell-remove").first().click();
  await expect(page.getByTestId("timetable-conflicts")).toHaveCount(0);

  await page.getByTestId("timetable-publish").click();
  await page.getByTestId("publish-date").fill("2026-09-01");
  await page.getByTestId("publish-confirm").click();
  await expect(page.getByTestId("timetable-version")).toContainText("E'lon qilingan");
  // Published: the grid is read-only.
  await expect(page.locator('[data-cell="2-1"]')).toBeDisabled();
});
