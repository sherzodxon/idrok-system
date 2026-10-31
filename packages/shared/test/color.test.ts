import { describe, expect, it } from "vitest";
import { contrastRatio, deriveBrandShades, isHexColor, shade } from "../src/color";

describe("brand colours", () => {
  it("validates #RRGGBB only", () => {
    expect(isHexColor("#4E92CF")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("red; background:url(x)")).toBe(false);
  });

  it("shades towards white and black", () => {
    expect(shade("#000000", 1)).toBe("#FFFFFF");
    expect(shade("#FFFFFF", -1)).toBe("#000000");
    expect(shade("#4E92CF", 0)).toBe("#4E92CF");
  });

  it("derives darker hover/strong and a light soft shade", () => {
    const s = deriveBrandShades("#4E92CF");
    expect(contrastRatio(s.primaryStrongColor, "#FFFFFF")).toBeGreaterThan(contrastRatio("#4E92CF", "#FFFFFF"));
    expect(contrastRatio(s.primarySoftColor, "#FFFFFF")).toBeLessThan(1.2);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
  });
});
