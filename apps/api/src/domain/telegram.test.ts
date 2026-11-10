import { describe, expect, it } from "vitest";
import { botLocale, hashLinkCode, looksLikeLinkCode, newLinkCode, signInitData, verifyInitData } from "./telegram";

const TOKEN = "42:unit-test-token-unit-test-token-000";
const NOW = 1_800_000_000;
const user = JSON.stringify({ id: 77, first_name: "Ali", username: "ali", language_code: "ru" });

describe("verifyInitData", () => {
  it("accepts data signed with the bot token", () => {
    const data = signInitData({ auth_date: String(NOW - 60), query_id: "q", user }, TOKEN);
    expect(verifyInitData(data, TOKEN, NOW)).toEqual({
      authDate: NOW - 60,
      user: { id: 77, firstName: "Ali", username: "ali", languageCode: "ru" },
    });
  });

  it("refuses another bot's signature, a changed field, a missing hash and stale or future dates", () => {
    const data = signInitData({ auth_date: String(NOW - 60), user }, TOKEN);
    expect(verifyInitData(data, "43:another-token-another-token-0000", NOW)).toBeNull();
    expect(verifyInitData(data.replace("Ali", "Vali"), TOKEN, NOW)).toBeNull();
    expect(verifyInitData(`auth_date=${NOW}&user=${encodeURIComponent(user)}`, TOKEN, NOW)).toBeNull();
    expect(verifyInitData(signInitData({ auth_date: String(NOW - 90_000), user }, TOKEN), TOKEN, NOW)).toBeNull();
    expect(verifyInitData(signInitData({ auth_date: String(NOW + 3_600), user }, TOKEN), TOKEN, NOW)).toBeNull();
    expect(verifyInitData(signInitData({ auth_date: String(NOW), user: "{}" }, TOKEN), TOKEN, NOW)).toBeNull();
    expect(verifyInitData("%%%", TOKEN, NOW)).toBeNull();
  });
});

describe("link codes", () => {
  it("10 unambiguous characters, compared case-insensitively by hash", () => {
    const code = newLinkCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    expect(looksLikeLinkCode(code.toLowerCase())).toBe(true);
    expect(looksLikeLinkCode("/start")).toBe(false);
    expect(hashLinkCode(code)).toBe(hashLinkCode(` ${code.toLowerCase()} `));
    expect(hashLinkCode(code)).not.toContain(code);
  });
});

it("bot language: portal choice, else Telegram's", () => {
  expect(botLocale("uz", "ru")).toBe("uz");
  expect(botLocale(null, "ru-RU")).toBe("ru");
  expect(botLocale(undefined, "en")).toBe("uz");
});
