// Role dashboards (audit phase 3): the school tiles for an admin, the teacher's day, the student's home — all on a
// phone without horizontal scroll.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login, loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test.use({ viewport: { width: 375, height: 812 } });

test("an admin sees the school tiles and the recent unscored lessons", async ({ page }) => {
  await loginToDashboard(page, USERS.mobile);
  const kpis = page.getByTestId("school-kpis");
  await expect(kpis).toContainText("Ball qo'yilmagan darslar");
  await expect(kpis).toContainText("Coin, 7 kun");
  await expect(page.getByTestId("school-counts")).toContainText("O'quvchilar");
  await expectNoHorizontalScroll(page);
});

test("a teacher sees today's lessons and what is left to score", async ({ page }) => {
  await loginToDashboard(page, USERS.teacher);
  const kpis = page.getByTestId("teacher-kpis");
  await expect(kpis).toContainText("Bugungi darslarim");
  await expect(kpis).toContainText("Oxirgi 7 kun");
  await expectNoHorizontalScroll(page);
});

test("a student's home: result tile, today's lessons and open tests", async ({ page }) => {
  await login(page, USERS.student);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("home-progress")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bugungi darslar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Testlar" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
