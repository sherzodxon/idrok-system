import { describe, expect, it } from "vitest";
import { PERMISSIONS, isPermissionCode } from "../src/permissions";

describe("permission catalogue", () => {
  it("has unique, well-formed codes", () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it("recognises codes", () => {
    expect(isPermissionCode("students.view")).toBe(true);
    expect(isPermissionCode("students.fly")).toBe(false);
  });
});
