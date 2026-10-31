import { describe, expect, it } from "vitest";
import { D, ratio, roundTo, sum, toDecimalString } from "../src/decimal";

describe("decimal", () => {
  it("adds without float error", () => {
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
  });

  it("returns null for a zero denominator instead of 0%", () => {
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(45, 50)?.toString()).toBe("0.9");
  });

  it("rounds only by the configured rule (scoring.md acceptance 13)", () => {
    expect(roundTo("86.5", { mode: "HALF_UP", decimals: 0 }).toString()).toBe("87");
    expect(roundTo("86.5", { mode: "FLOOR", decimals: 0 }).toString()).toBe("86");
    expect(roundTo("86.01", { mode: "CEIL", decimals: 0 }).toString()).toBe("87");
    expect(roundTo("85.995", { mode: "HALF_UP", decimals: 2 }).toString()).toBe("86");
  });

  it("serialises as a string", () => {
    expect(toDecimalString(D("8.5"), 2)).toBe("8.50");
  });
});
