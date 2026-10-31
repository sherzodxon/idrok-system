import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, login } from "../support/login";
import { USERS } from "../support/users";

test.use({ viewport: { width: 375, height: 812 } });

test("a guardian lands in the mobile portal and sees only their child", async ({ page }) => {
  await login(page, "90 000 00 01"); // phone in any format
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("portal-title")).toBeVisible();
  await expect(page.getByTestId("children")).toContainText("Farzand Demo");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Staff pages are not for guardians: the shell sends them back to the portal.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/home$/);
  expect(USERS.guardian).toBe("+998900000001");
});
