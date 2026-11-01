// M2 step 2: the admin builds a timetable draft in the grid, sees a conflict, fixes it and publishes.
import { expect, test } from "@playwright/test";
import { apiPost, loginToDashboard } from "../support/login";
import { API_URL, USERS } from "../support/users";

test("build, fix a conflict and publish a timetable", async ({ page }) => {
  await loginToDashboard(page, USERS.importer);
  // Own reference data, so the test does not depend on other specs.
  await apiPost(page, "/subjects", { name: "E2E jadval fani" });
  await apiPost(page, "/employees", { firstName: "E2E", lastName: "Jadvalchi" });
  // A period and bell times, so lessons can be generated after publishing.
  const years = await (await page.request.get(`${API_URL}/academic-years`)).json();
  const yearId = years.find((y: { status: string }) => y.status === "ACTIVE").id;
  await apiPost(page, `/academic-years/${yearId}/periods`, {
    type: "YEAR",
    name: "E2E yil",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
  });
  await apiPost(page, `/academic-years/${yearId}/bell-schedules`, {
    name: "E2E qo'ng'iroqlar",
    validFrom: "2026-09-01",
    slots: [
      { lessonNumber: 1, startTime: "08:00", endTime: "08:45" },
      { lessonNumber: 2, startTime: "08:55", endTime: "09:40" },
    ],
  });

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
  // Publishing opens the lesson review: lessons for the rest of the year are added.
  const preview = page.getByTestId("lessons-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-count="add"]')).not.toHaveText("0");
  await expect(preview.locator('[data-count="cancel"]')).toHaveText("0");
  await page.getByTestId("lessons-apply").click();
  await expect(page.getByTestId("lessons-preview")).toHaveCount(0);
  await expect(page.getByTestId("timetable-version")).toContainText("E'lon qilingan");
  // Published: the grid is read-only; reviewing again finds nothing to change.
  await expect(page.locator('[data-cell="2-1"]')).toBeDisabled();
  await page.getByTestId("lessons-generate").click();
  await expect(page.getByText("Darslar jadvalga mos — o'zgartirish kerak emas")).toBeVisible();
  await expect(page.getByTestId("lessons-apply")).toBeDisabled();
});
