// A permission introduced by a later stage reaches the system roles of schools created before it (T-34).
import { afterAll, describe, expect, it } from "vitest";
import { ensureSystemRoles, grantNewDefaults, syncPermissions } from "../src/seed";
import { clients } from "./helpers";

const { root } = clients();
afterAll(() => root.$disconnect());

const codesOf = async (roleId: string) =>
  (await root.rolePermission.findMany({ where: { roleId }, select: { permissionCode: true } })).map(
    (p) => p.permissionCode,
  );

describe("permission sync", () => {
  it("is idempotent", async () => {
    await syncPermissions(root);
    expect(await syncPermissions(root)).toEqual([]);
  });

  it("grants a new code to existing system roles by their defaults only", async () => {
    await syncPermissions(root);
    const tenant = await root.tenant.create({ data: { slug: `r-${crypto.randomUUID()}`, name: "Demo R" } });
    const roles = await ensureSystemRoles(root, tenant.id);
    const custom = await root.role.create({ data: { tenantId: tenant.id, code: "DEMO_ROLE", name: "Demo" } });
    // As if the school had been created before lessons.mark existed.
    await root.rolePermission.deleteMany({ where: { roleId: roles.TEACHER, permissionCode: "lessons.mark" } });

    await grantNewDefaults(root, ["lessons.mark"]);

    expect(await codesOf(roles.TEACHER)).toContain("lessons.mark");
    expect(await codesOf(roles.DIRECTOR)).not.toContain("lessons.mark");
    expect(await codesOf(custom.id)).toEqual([]);
    // Running again changes nothing (no duplicates).
    await grantNewDefaults(root, ["lessons.mark"]);
    expect((await codesOf(roles.TEACHER)).filter((c) => c === "lessons.mark")).toHaveLength(1);
  });
});
