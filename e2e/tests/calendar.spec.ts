// M2 step 1: the admin marks calendar days, sets the working week and adds a shift with bell times.
import { expect, test } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test.beforeEach(async ({ page }) => {
  await loginToDashboard(page, USERS.importer);
});

test("mark a vacation range and a working Saturday on the month view", async ({ page }) => {
  await page.goto("/admin/calendar?tab=month");
  await expect(page.getByTestId("calendar-month")).toBeVisible();
  // Go to December 2026 (inside the seeded 2026-2027 year), whatever month today is.
  for (let i = 0; i < 12 && !(await page.locator('[data-date="2026-12-21"]').isVisible()); i++) {
    const month = await page.getByTestId("calendar-month").textContent();
    await page.getByRole("button", { name: /keyingi oy/i }).click();
    await expect(page.getByTestId("calendar-month")).not.toHaveText(month ?? "");
  }
  await page.locator('[data-date="2026-12-28"]').click();
  await page.getByTestId("day-kind").selectOption("VACATION");
  await page.getByTestId("day-title").fill("Qishki ta'til");
  await page.getByLabel("Qaysi sanagacha").fill("2026-12-31");
  await page.getByTestId("drawer-save").click();
  for (const d of ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31"])
    await expect(page.locator(`[data-date="${d}"]`)).toHaveAttribute("data-kind", "VACATION");

  await page.locator('[data-date="2026-12-26"]').click();
  await page.getByTestId("day-kind").selectOption("WORKING_OVERRIDE");
  await page.getByTestId("day-title").fill("Juma jadvali");
  await page.getByLabel("Qaysi kun jadvali bo'yicha").selectOption("5");
  await page.getByTestId("drawer-save").click();
  await expect(page.locator('[data-date="2026-12-26"]')).toHaveAttribute("data-kind", "WORKING_OVERRIDE");

  // Unmark one vacation day.
  await page.locator('[data-date="2026-12-31"]').click();
  await page.getByTestId("day-delete").click();
  await page.getByRole("dialog").last().getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.locator('[data-date="2026-12-31"]')).toHaveAttribute("data-kind", "");
});

test("working week, a shift and its bell schedule", async ({ page }) => {
  await page.goto("/admin/calendar?tab=week");
  await page.getByTestId("weekday-6").uncheck();
  await page.getByTestId("week-save").click();
  await page.reload();
  await expect(page.getByTestId("weekday-6")).not.toBeChecked();
  await expect(page.getByTestId("weekday-5")).toBeChecked();

  await page.goto("/admin/calendar?tab=bells");
  await page.getByTestId("shift-add").click();
  await page.getByLabel("Smena", { exact: true }).fill("1-smena");
  await page.getByTestId("drawer-save").click();
  await expect(page.getByRole("cell", { name: "1-smena" }).first()).toBeVisible();

  await page.getByTestId("bells-add").click();
  await page.getByLabel("Nomi").fill("1-smena qo'ng'iroqlari");
  await page.getByLabel("Smena").selectOption({ label: "1-smena" });
  await page.getByLabel("Amal qilish sanasi").fill("2026-09-01");
  await page.getByRole("button", { name: "Dars qo'shish" }).click();
  await page.getByTestId("drawer-save").click();
  await expect(page.getByText("2. 08:55–09:40")).toBeVisible();
});
