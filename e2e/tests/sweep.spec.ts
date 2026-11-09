// Phase 7 sweep: every main page of each role opens on a phone (375 px) in light and dark, without horizontal
// scroll, without a script error and with its heading — the UI rules checked on all pages, not only the new ones.
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, login, loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

const ADMIN = [
  "/dashboard",
  "/admin/reports",
  "/admin/students",
  "/admin/guardians",
  "/admin/employees",
  "/admin/structure",
  "/admin/calendar",
  "/admin/timetable",
  "/admin/lessons",
  "/admin/plans",
  "/admin/gradebook",
  "/admin/assessment",
  "/admin/tests",
  "/admin/attendance",
  "/admin/coins",
  "/admin/shop",
  "/admin/imports",
  "/admin/settings",
  "/profile",
];
const TEACHER = [
  "/dashboard",
  "/teacher/schedule",
  "/teacher/gradebook",
  "/teacher/attendance",
  "/teacher/coins",
  "/teacher/plans",
  "/teacher/tests",
  "/teacher/questions",
  "/teacher/groups",
  "/teacher/students",
];
const STUDENT = ["/home", "/schedule", "/progress", "/tests", "/coins", "/attendance", "/me"];

async function sweep(page: Page, paths: string[]) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("h1").first(), `${path} (${scheme})`).toBeVisible();
      // Let data load so tables and charts are measured at their real size.
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalScroll(page);
    }
  }
  expect(errors).toEqual([]);
}

test.use({ viewport: { width: 375, height: 812 } });

test("admin pages on a phone, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  await loginToDashboard(page, USERS.mobile);
  await sweep(page, ADMIN);
});

test("teacher pages on a phone, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  await loginToDashboard(page, USERS.planner);
  await sweep(page, TEACHER);
});

test("student pages on a phone, light and dark", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, USERS.student);
  await expect(page).toHaveURL(/\/home$/);
  await sweep(page, STUDENT);
});
