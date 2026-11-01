// M1 acceptance: the admin imports 300 students and 40 teachers from Excel through the UI, with an error preview.
import { expect, test, type Page } from "@playwright/test";
import { CLASSES, SUBJECTS, classRows, filledTemplate, studentRows, teacherRows } from "../support/excel";
import { loginToDashboard } from "../support/login";
import { USERS } from "../support/users";

test.describe.configure({ mode: "serial", timeout: 240_000 });

async function upload(page: Page, kind: string, rows: Record<string, string>[], fileName: string) {
  await page.goto("/admin/imports/new");
  await page.locator(`[data-kind="${kind}"]`).click();
  const buffer = await filledTemplate(page.request, kind, rows);
  await page.getByTestId("import-file").setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByTestId("import-upload").click();
  await expect(page).toHaveURL(/\/admin\/imports\/[0-9a-f-]{36}$/);
}

const summary = (page: Page, key: string) => page.locator(`[data-summary="${key}"]`);

async function commitAndWait(page: Page) {
  await page.getByTestId("import-commit").click();
  // The summary counts up while committing; wait for the final state.
  await expect(page.getByTestId("import-running")).toBeVisible();
  await expect(page.getByTestId("import-running")).toHaveCount(0, { timeout: 180_000 });
  await expect(summary(page, "created")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await loginToDashboard(page, USERS.importer);
});

test("subjects and classes", async ({ page }) => {
  await upload(
    page,
    "SUBJECTS",
    SUBJECTS.map((name) => ({ name })),
    "fanlar.xlsx",
  );
  await expect(summary(page, "total")).toHaveText("4", { timeout: 30_000 });
  await commitAndWait(page);
  await expect(summary(page, "created")).toHaveText("4");

  // 7-A exists in the seed: a warning, not an error.
  await upload(page, "CLASS_GROUPS", classRows(), "sinflar.xlsx");
  await expect(summary(page, "total")).toHaveText(String(CLASSES.length), { timeout: 30_000 });
  await expect(summary(page, "errors")).toHaveText("0");
  await commitAndWait(page);
  await expect(summary(page, "created")).toHaveText(String(CLASSES.length - 1));
});

test("300 students with guardians: errors are previewed, skipped, then committed", async ({ page }) => {
  const rows: Record<string, string>[] = studentRows();
  rows.push({ lastName: "", firstName: "Demo", className: "7-A" });
  rows.push({ lastName: "Demo-xato", firstName: "Demo", className: "11-Z" });
  await upload(page, "STUDENTS_GUARDIANS", rows, "oquvchilar.xlsx");

  await expect(summary(page, "total")).toHaveText("302", { timeout: 60_000 });
  await expect(summary(page, "errors")).toHaveText("2");
  // The preview names the reason of each error, in the user's language.
  await page.getByRole("tab", { name: "Xatolar" }).click();
  await expect(page.getByText('"11-Z" sinfi topilmadi').first()).toBeVisible();
  await expect(page.getByText("to'ldirilmagan").first()).toBeVisible();

  await expect(page.getByTestId("import-commit")).toBeDisabled();
  await page.getByTestId("skip-errors").check();
  await commitAndWait(page);
  await expect(summary(page, "created")).toHaveText("300");
  await expect(summary(page, "skipped")).toHaveText("2");
  await expect(summary(page, "failed")).toHaveText("0");

  // Credentials are downloadable once.
  const download = page.waitForEvent("download");
  await page.getByTestId("import-credentials").click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  await page.goto("/admin/students");
  await expect(page.getByTestId("students-table")).toContainText("Demo-familiya-000");
  await expect(page.getByText(/\/ 301$/)).toBeVisible();
});

test("40 teachers with roles and assignments", async ({ page }) => {
  await upload(page, "EMPLOYEES_ASSIGNMENTS", teacherRows(), "xodimlar.xlsx");
  await expect(summary(page, "total")).toHaveText("40", { timeout: 60_000 });
  await expect(summary(page, "errors")).toHaveText("0");
  await commitAndWait(page);
  await expect(summary(page, "created")).toHaveText("40");

  await page.goto("/admin/employees");
  await expect(page.getByTestId("employees-table")).toContainText("Demo-ustoz-00");
});
