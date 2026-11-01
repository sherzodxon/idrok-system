// M2 step 4: a teacher writes a curriculum plan and submits it; the administrator approves; changes need a new version.
import { expect, test, type Page } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

async function asTeacher(page: Page) {
  await loginToDashboard(page, USERS.planner);
  await page.getByTestId("sidebar").getByRole("link", { name: "Dars rejalarim" }).click();
  await expect(page).toHaveURL(/\/teacher\/plans$/);
}

test("write, submit, approve, then start a new version", async ({ page, browser }) => {
  await asTeacher(page);
  await page.getByTestId("plan-create").click();
  await page.getByTestId("plan-subject").selectOption({ label: "E2E reja fani" });
  await page.getByTestId("plan-grade").selectOption({ label: "7" });
  await page.getByTestId("plan-title").fill("E2E reja 7-sinf");
  await page.getByTestId("drawer-save").click();
  await expect(page).toHaveURL(/\/teacher\/plans\/[0-9a-f-]{36}$/);

  for (const [topic, hours] of [
    ["Kirish", "1"],
    ["Asosiy tushunchalar", "2"],
  ] as const) {
    await page.getByTestId("item-add").click();
    await page.getByTestId("item-topic").last().fill(topic);
    await page.getByTestId("item-hours").last().fill(hours);
  }
  await page.getByTestId("plan-save").click();
  await expect(page.getByTestId("plan-total")).toHaveText("2 ta mavzu, 3 soat");
  await expect(page.getByTestId("plan-save")).toBeDisabled();
  await page.getByTestId("plan-submit").click();
  await page.getByRole("dialog").getByRole("button", { name: "Tasdiqlash" }).click();
  await expect(page.getByText("Tasdiqlashda").first()).toBeVisible();
  await expect(page.getByTestId("item-add")).toHaveCount(0);
  const planUrl = page.url();

  // The administrator approves from the plans queue.
  const admin = await browser.newPage();
  await loginToDashboard(admin, USERS.importer);
  await admin.goto("/admin/plans?status=SUBMITTED");
  await admin.getByTestId("plans-table").getByText("E2E reja 7-sinf").first().click();
  await admin.getByTestId("plan-approve").click();
  await expect(admin.getByText("Tasdiqlangan").first()).toBeVisible();
  await admin.close();

  await page.goto(planUrl);
  await expect(page.getByText("Tasdiqlangan").first()).toBeVisible();
  await page.getByTestId("plan-new-version").click();
  await expect(page.getByTestId("plan-version")).toHaveText("v2");
  await expect(page.getByTestId("item-topic")).toHaveCount(2);
  await expect(page.getByText("Qoralama").first()).toBeVisible();
});
