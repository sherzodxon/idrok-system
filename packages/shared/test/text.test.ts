import { describe, expect, it } from "vitest";
import { cleanName, normalizeText, normalizeUzPhone } from "../src/text";

describe("normalizeText", () => {
  it("treats apostrophe variants and spacing as equal", () => {
    const forms = ["O‘zbekiston", "o'zbekiston ", "O`zbekiston", "  Oʻzbekiston"];
    expect(new Set(forms.map(normalizeText)).size).toBe(1);
  });
});

describe("cleanName", () => {
  it("keeps case, unifies apostrophes and spaces", () => {
    expect(cleanName("  G'ulomov   Sa'dulla ")).toBe("Gʻulomov Saʻdulla");
  });
});

describe("normalizeUzPhone", () => {
  it.each([
    ["+998 90 123-45-67", "+998901234567"],
    ["998901234567", "+998901234567"],
    ["90 123 45 67", "+998901234567"],
    ["8 90 1234567", "+998901234567"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it("rejects invalid numbers", () => {
    expect(normalizeUzPhone("12345")).toBeNull();
    expect(normalizeUzPhone("+7 912 345 67 89")).toBeNull();
  });
});
