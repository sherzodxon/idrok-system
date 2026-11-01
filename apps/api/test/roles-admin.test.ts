import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, bearerFor } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: ReturnType<typeof api>;
let adminId: string;
beforeAll(async () => {
  t = await createTestApp();
  const a = await t.defaultTenant.createUser("SCHOOL_ADMIN");
  adminId = a.id;
  admin = api(t, await bearerFor(t, a.username));
});
afterAll(() => t.close());

describe("role management", () => {
  it("creates a custom role, and a permission change applies to holders on their next request", async () => {
    const role = await admin.post("/roles", { code: "KUTUBXONACHI", name: "Kutubxonachi", permissions: ["students.view"] });
    expect(role).toMatchObject({ code: "KUTUBXONACHI", isSystem: false, permissions: ["students.view"] });

    const holder = await t.defaultTenant.createUser(null);
    await admin.put(`/users/${holder.id}/roles`, { roleIds: [role.id] });
    const holderAuth = await bearerFor(t, holder.username);
    expect((await request(t.app).get("/api/v1/employees").set(holderAuth)).status).toBe(403);

    await admin.put(`/roles/${role.id}/permissions`, { permissions: ["students.view", "employees.view"] });
    expect((await request(t.app).get("/api/v1/employees").set(holderAuth)).status).toBe(200);

    await admin.post(`/roles/${role.id}/archive`);
    expect((await request(t.app).get("/api/v1/students").set(holderAuth)).status).toBe(403);
  });

  it("rejects reserved codes and unknown permissions", async () => {
    expect((await admin.raw("post", "/roles", { code: "TEACHER", name: "x" })).status).toBe(409);
    expect((await admin.raw("post", "/roles", { code: "YANGI", name: "x", permissions: ["students.fly"] })).status).toBe(400);
  });

  it("an admin cannot lock themselves out of role management", async () => {
    const roles = await admin.get("/roles");
    const schoolAdmin = roles.find((r: { code: string }) => r.code === "SCHOOL_ADMIN");
    const res = await admin.raw("put", `/roles/${schoolAdmin.id}/permissions`, { permissions: ["students.view"] });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe("SELF_LOCKOUT");
  });

  it("system roles cannot be archived and SUPER_ADMIN is not editable by a school admin", async () => {
    const roles = await admin.get("/roles");
    const teacher = roles.find((r: { code: string }) => r.code === "TEACHER");
    const superAdmin = roles.find((r: { code: string }) => r.code === "SUPER_ADMIN");
    expect((await admin.raw("post", `/roles/${teacher.id}/archive`)).status).toBe(409);
    expect((await admin.raw("put", `/roles/${superAdmin.id}/permissions`, { permissions: [] })).status).toBe(403);
  });
});

describe("audit log", () => {
  it("lists entries newest first with the actor and filters by entity", async () => {
    const page = await admin.get("/audit-logs?entityType=Role&pageSize=50");
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((e: { entityType: string }) => e.entityType === "Role")).toBe(true);
    const first = page.items[0];
    expect(first.actor).toMatchObject({ id: adminId });
    const times = page.items.map((e: { createdAt: string }) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("needs audit_logs.view", async () => {
    const teacher = await t.defaultTenant.createUser("TEACHER");
    expect((await request(t.app).get("/api/v1/audit-logs").set(await bearerFor(t, teacher.username))).status).toBe(403);
  });
});
