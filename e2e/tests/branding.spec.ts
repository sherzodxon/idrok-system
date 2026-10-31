import { expect, test } from "@playwright/test";
import { loginToDashboard } from "../support/login";
import { API_URL, USERS } from "../support/users";

// ROADMAP M1 acceptance: changing the brand colour updates the whole UI.
test("changing the brand colour updates the whole UI", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await loginToDashboard(page, USERS.branding);
  const kpi = page.locator(".bg-primary").first();
  await expect(kpi).toHaveCSS("background-color", "rgb(78, 146, 207)"); // default #4E92CF

  const csrf = (await context.cookies()).find((c) => c.name === "idrok_csrf")!.value;
  const res = await page.request.put(`${API_URL}/settings/branding`, {
    data: { primaryColor: "#2E7D32", schoolName: "Demo yashil maktab" },
    headers: { "X-CSRF-Token": csrf },
  });
  expect(res.status()).toBe(200);

  await page.reload();
  await expect(kpi).toHaveCSS("background-color", "rgb(46, 125, 50)");
  // Derived shades and texts follow: active menu item background, school name in the shell and the tab title.
  const activeItem = page.getByTestId("sidebar").locator('[aria-current="page"]');
  const soft = await activeItem.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(soft).not.toBe("rgb(234, 243, 251)"); // the old soft blue
  await expect(page.getByTestId("sidebar")).toContainText("Demo yashil maktab");
  await expect(page).toHaveTitle(/Demo yashil maktab/);

  // The login page (before login) uses it too.
  const anonymous = await (await page.context().browser()!.newContext()).newPage();
  await anonymous.goto(page.url().replace(/\/dashboard$/, "/login"));
  await expect(anonymous.locator(".bg-primary").first()).toHaveCSS("background-color", "rgb(46, 125, 50)");

  // Restore for other specs.
  await page.request.put(`${API_URL}/settings/branding`, {
    data: { primaryColor: "#4E92CF", schoolName: "Demo maktab" },
    headers: { "X-CSRF-Token": csrf },
  });
});
