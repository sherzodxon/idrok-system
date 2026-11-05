import { describe, expect, it } from "vitest";
import { areaPath, linePath, linear, niceDomain, percentOf, tickValues } from "../src/lib/chart-scale";

describe("chart scale", () => {
  it("maps the domain onto the pixel range (inverted y works too)", () => {
    const y = linear({ min: 0, max: 100 }, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(25)).toBe(150);
    expect(linear({ min: 5, max: 5 }, 0, 10)(5)).toBe(5);
  });

  it("rounds the domain outwards to a readable step, or keeps a fixed floor and ceiling", () => {
    const d = niceDomain([91.9, 95.3], 4);
    expect(d.min).toBeLessThanOrEqual(91.9);
    expect(d.max).toBeGreaterThanOrEqual(95.3);
    expect([0.5, 1, 2, 2.5]).toContain(d.step);
    expect(tickValues(niceDomain([], 4, 0, 100))).toEqual([0, 20, 40, 60, 80, 100]);
    expect(tickValues(niceDomain([], 4, 88, 98))).toEqual([88, 90, 92, 94, 96, 98]);
    expect(niceDomain([7, 7]).min).toBeLessThan(7);
  });

  it("breaks the line and the area on missing values", () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: null },
      { x: 30, y: 5 },
      { x: 40, y: 15 },
    ];
    expect(linePath(pts)).toBe("M0.0 10.0L10.0 20.0M30.0 5.0L40.0 15.0");
    expect(areaPath(pts, 50).match(/Z/g)).toHaveLength(2);
    expect(areaPath([{ x: 0, y: 1 }], 50)).toBe("");
  });

  it("clamps shares to 0–100", () => {
    expect(percentOf(8, 10)).toBe(80);
    expect(percentOf(12, 10)).toBe(100);
    expect(percentOf(3, 0)).toBe(0);
  });
});
