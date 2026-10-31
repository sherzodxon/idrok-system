import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_CODES } from "../src/permissions";
import { renderRbacMatrix } from "../src/rbac-matrix";
import { ROLE_DEFAULT_PERMISSIONS } from "../src/role-defaults";

describe("RBAC defaults", () => {
  it("only use known permission codes", () => {
    for (const codes of Object.values(ROLE_DEFAULT_PERMISSIONS)) {
      for (const c of codes) expect(PERMISSION_CODES).toContain(c);
    }
  });

  it("portal permissions belong to students and guardians only", () => {
    for (const [role, codes] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      const portal = codes.filter((c) => c.startsWith("portal."));
      if (role === "STUDENT") expect(portal).toEqual(["portal.student"]);
      else if (role === "GUARDIAN") expect(portal).toEqual(["portal.guardian"]);
      else expect(portal).toEqual([]);
    }
  });

  it("docs/architecture/rbac-matrix.md matches the code", () => {
    const file = readFileSync(path.join(import.meta.dirname, "../../../docs/architecture/rbac-matrix.md"), "utf8");
    expect(file).toBe(renderRbacMatrix());
  });
});
