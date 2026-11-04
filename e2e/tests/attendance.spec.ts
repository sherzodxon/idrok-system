// M6: the admin switches school attendance on, adds a lateness band and a terminal (its key is shown once); a terminal
// push appears in the journal as late with its band; a face photo is uploaded in Face Check; the guardian sees the day
// on a phone.
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { addSchoolDays, isoWeekday, schoolToday } from "@idrok/shared/time";
import { expectNoHorizontalScroll, login, loginToDashboard } from "../support/login";
import { API_URL, USERS } from "../support/users";

test.describe.configure({ mode: "serial" });

/** The last Monday..Saturday before today (a finished school day). */
const DAY = (() => {
  let d = addSchoolDays(schoolToday(), -1);
  while (isoWeekday(d) === 7) d = addSchoolDays(d, -1);
  return d;
})();
let webhookPath = "";

/** A 240×320 grey PNG (big enough for a face photo check). */
function png(width = 240, height = 320): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x88);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function openAttendance(page: Page, tab: string) {
  await page.getByTestId("sidebar").getByRole("link", { name: "Davomat" }).click();
  await page.getByRole("tab", { name: tab }).click();
}

test("the admin switches attendance on, adds a band and a terminal", async ({ page }) => {
  await loginToDashboard(page, USERS.coinAdmin);
  await openAttendance(page, "Sozlamalar");
  await page.getByLabel("Maktab davomati (Face ID) yoqilgan").check();
  await page.getByRole("button", { name: "Saqlash" }).click();
  await expect(page.getByTestId("attendance-disabled")).toBeHidden();
  await page.getByRole("button", { name: "Oraliq qo'shish" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Nomi").fill("3-7 daqiqa");
  await drawer.getByLabel("Dan (daqiqa)").fill("3");
  await drawer.getByLabel("Gacha (daqiqa)").fill("7");
  await page.getByTestId("drawer-save").click();
  await expect(page.getByTestId("lateness-bands")).toContainText("3-7 daqiqa");

  await page.getByRole("tab", { name: "Qurilmalar" }).click();
  await page.getByRole("button", { name: "Qurilma qo'shish" }).click();
  await drawer.getByLabel("Nomi").fill("E2E kirish");
  await drawer.getByLabel("Bridge orqali ulanadi (maktab tarmog'idagi kompyuter)").uncheck();
  await page.getByTestId("drawer-save").click();
  const secret = page.getByTestId("secret-once");
  await expect(secret).toContainText("/attendance/hikvision-event/");
  webhookPath = (await secret.locator("code").first().textContent()) ?? "";
  await page.getByRole("button", { name: "Tayyor" }).click();
  await expect(page.getByTestId("devices")).toContainText("E2E kirish");
});

test("a terminal push shows up in the journal as late", async ({ page }) => {
  expect(webhookPath).toMatch(/hikvision-event\/[A-Za-z0-9_-]{40,}$/);
  const key = webhookPath.split("/").pop()!;
  const res = await page.request.post(`${API_URL}/attendance/hikvision-event/${key}`, {
    multipart: {
      event_log: JSON.stringify({
        eventType: "AccessControllerEvent",
        dateTime: `${DAY}T08:35:20+05:00`,
        AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: "STD-0001", serialNo: 77 },
      }),
    },
  });
  expect(await res.json()).toMatchObject({ accepted: 1 });

  await loginToDashboard(page, USERS.coinAdmin);
  await openAttendance(page, "Jurnal");
  await page.getByLabel("Sana").fill(DAY);
  const row = page.getByTestId("attendance-day").locator("tr", { hasText: "Farzand Demo" });
  await expect(row).toContainText("Kechikdi");
  await expect(row).toContainText("5 daqiqa (3-7 daqiqa)");
  await expect(row).toContainText("08:35");
});

test("a face photo is uploaded in Face Check", async ({ page }) => {
  await loginToDashboard(page, USERS.coinAdmin);
  await openAttendance(page, "Face Check");
  await page.getByTestId("face-profiles").locator("tr", { hasText: "Farzand Demo" }).click();
  const dialog = page.getByTestId("face-dialog");
  await expect(dialog).toContainText("Yuz rasmi yuklanmagan");
  await dialog.getByTestId("face-file").setInputFiles({ name: "face.png", mimeType: "image/png", buffer: png() });
  await expect(dialog.getByRole("img", { name: "O'quvchining yuz rasmi" })).toBeVisible();
  await expect(dialog.getByTestId("face-devices")).toContainText("E2E kirish");
});

test("the guardian sees the day on a phone", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await login(page, USERS.guardian);
  await page.getByTestId("home-attendance").click();
  const days = page.getByTestId("attendance-days");
  await expect(days).toContainText("Kechikdi");
  await expect(days).toContainText("08:35");
  await expectNoHorizontalScroll(page);
  await page.close();
});
