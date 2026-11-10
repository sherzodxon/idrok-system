// M7 (UAT TG-02, TG-03): the admin issues a one-time code, the guardian sends it to the bot (real webhook → worker →
// fake Bot API), then opens the Mini App on a phone and lands in the portal without a password.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { expectNoHorizontalScroll, loginToDashboard } from "../support/login";
import { sentMessages, signInitData } from "../support/telegram";
import { API_URL, TELEGRAM, USERS } from "../support/users";

const TG_USER = 880001;

// Telegram calls the webhook without any browser cookie: a separate request context.
async function sendToBot(request: APIRequestContext, text: string, updateId: number) {
  const res = await request.post(`${API_URL}/telegram/webhook`, {
    headers: { "X-Telegram-Bot-Api-Secret-Token": TELEGRAM.webhookSecret },
    data: {
      update_id: updateId,
      message: { message_id: updateId, chat: { id: TG_USER, type: "private" }, from: { id: TG_USER }, text },
    },
  });
  expect(res.status()).toBe(200);
}

test("admin code links a guardian, then the Mini App opens the portal", async ({ page, browser, request }) => {
  await loginToDashboard(page, USERS.telegramAdmin);
  // Other specs import hundreds of guardians: find ours by phone.
  await page.goto("/admin/telegram?q=998900000001");
  const row = page.getByTestId("telegram-guardians").locator("tr", { hasText: "Ona Demo" });
  await expect(row).toContainText("Bog'lanmagan");
  await row.getByRole("button", { name: "Kod berish" }).click();
  const code = (await page.getByTestId("link-code-value").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{10}$/);
  await expect(page.getByTestId("link-code")).toContainText(`t.me/${TELEGRAM.botUsername}?start=${code}`);

  await sendToBot(request, `/start ${code}`, 5001);
  await expect
    .poll(
      async () =>
        (await sentMessages())
          .filter((m) => String(m.chat_id) === String(TG_USER))
          .map((m) => m.text)
          .join("\n"),
      {
        timeout: 20_000,
      },
    )
    .toContain("Bog'landi");
  await page.goto("/admin/telegram?status=LINKED");
  await expect(page.getByTestId("telegram-guardians")).toContainText("Ona Demo");

  // The Mini App, in a fresh phone-sized context without any cookie session.
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "uz-UZ" });
  const tg = await phone.newPage();
  await tg.goto(`/tg#tgWebAppData=${encodeURIComponent(signInitData(TG_USER))}&tgWebAppVersion=8.0`);
  await expect(tg).toHaveURL(/\/home$/);
  await expect(tg.getByTestId("children")).toContainText("Farzand Demo");
  await expectNoHorizontalScroll(tg);
  await tg.goto("/me");
  await expect(tg.getByTestId("portal-notifications")).toContainText("Bog'langan");

  // A Telegram account that is not linked gets an explanation, not the portal.
  const other = await phone.newPage();
  await other.goto(`/tg#tgWebAppData=${encodeURIComponent(signInitData(880099))}`);
  await expect(other.getByTestId("mini-app-notLinked")).toBeVisible();
  // Opened outside Telegram.
  const outside = await (await browser.newContext()).newPage();
  await outside.goto("/tg");
  await expect(outside.getByTestId("mini-app-outside")).toBeVisible();
  await phone.close();
});
