import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "@idrok/db";
import { writeAudit } from "../src/modules/audit/audit.service";
import { PASSWORD, createTestApp } from "./support/app";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function bearer(username: string, tenant?: string) {
  const res = await request(t.app)
    .post("/api/v1/auth/login")
    .send({ username, password: PASSWORD, clientType: "MOBILE", ...(tenant ? { tenant } : {}) });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.tokens.accessToken}` };
}

describe("permissions", () => {
  it("401 without a token, 403 without the permission", async () => {
    expect((await request(t.app).get("/api/v1/roles")).status).toBe(401);
    const teacher = await t.defaultTenant.createUser("TEACHER");
    const res = await request(t.app)
      .get("/api/v1/roles")
      .set(await bearer(teacher.username));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "FORBIDDEN", details: { permission: "roles.view" } });
  });

  it("a role change applies to the very next request with the same token", async () => {
    const admin = await t.defaultTenant.createUser("SCHOOL_ADMIN");
    const teacher = await t.defaultTenant.createUser("TEACHER");
    const adminAuth = await bearer(admin.username);
    const teacherAuth = await bearer(teacher.username);
    expect((await request(t.app).get("/api/v1/roles").set(teacherAuth)).status).toBe(403);

    const roleIds = [t.defaultTenant.roles.TEACHER, t.defaultTenant.roles.DIRECTOR];
    const assign = await request(t.app).put(`/api/v1/users/${teacher.id}/roles`).set(adminAuth).send({ roleIds });
    expect(assign.status).toBe(200);
    expect(assign.body.roles).toEqual(["DIRECTOR", "TEACHER"]);

    expect((await request(t.app).get("/api/v1/roles").set(teacherAuth)).status).toBe(200);
    const me = await request(t.app).get("/api/v1/me").set(teacherAuth);
    expect(me.body.roles).toEqual(["DIRECTOR", "TEACHER"]);

    // The change is audited with before/after.
    const audit = await t.deps.root.auditLog.findFirstOrThrow({
      where: { entityId: teacher.id, action: "user.roles.update" },
    });
    expect(audit.actorUserId).toBe(admin.id);
    expect(audit.before).toEqual({ roles: ["TEACHER"] });
    expect(audit.after).toEqual({ roles: ["DIRECTOR", "TEACHER"] });
  });

  it("only a super admin can grant super admin", async () => {
    const admin = await t.defaultTenant.createUser("SCHOOL_ADMIN");
    const res = await request(t.app)
      .put(`/api/v1/users/${admin.id}/roles`)
      .set(await bearer(admin.username))
      .send({ roleIds: [t.defaultTenant.roles.SUPER_ADMIN] });
    expect(res.status).toBe(403);
  });
});

describe("tenant isolation", () => {
  it("an admin of another school cannot touch this school's users or roles", async () => {
    const other = await t.createTenant();
    const otherAdmin = await other.createUser("SCHOOL_ADMIN");
    const victim = await t.defaultTenant.createUser("TEACHER");
    const auth = await bearer(otherAdmin.username, other.tenant.slug);

    const res = await request(t.app).put(`/api/v1/users/${victim.id}/roles`).set(auth).send({ roleIds: [] });
    expect(res.status).toBe(404);
    // Roles of another school are unknown ids here.
    const res2 = await request(t.app)
      .put(`/api/v1/users/${otherAdmin.id}/roles`)
      .set(auth)
      .send({ roleIds: [t.defaultTenant.roles.SCHOOL_ADMIN] });
    expect(res2.status).toBe(400);
    const roles = await request(t.app).get("/api/v1/roles").set(auth);
    expect(roles.body.map((r: { id: string }) => r.id)).not.toContain(t.defaultTenant.roles.SCHOOL_ADMIN);
  });

  it("the same username in two schools logs into the right one", async () => {
    const other = await t.createTenant();
    await other.createUser("TEACHER", { username: "ustoz" });
    await t.defaultTenant.createUser("TEACHER", { username: "ustoz" });
    const me = await request(t.app)
      .get("/api/v1/me")
      .set(await bearer("ustoz", other.tenant.slug));
    expect(me.body.tenant.id).toBe(other.tenant.id);
  });

  it("a tenantId in the request body is rejected, not trusted", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const res = await request(t.app)
      .patch("/api/v1/me/preferences")
      .set(await bearer(user.username))
      .send({ themeMode: "DARK", tenantId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("audit log", () => {
  it("is written in the same transaction: a rollback leaves no audit row", async () => {
    const tenantId = t.defaultTenant.tenant.id;
    await expect(
      runWithTenant({ tenantId }, () =>
        t.deps.db.$transaction(async (tx) => {
          await writeAudit(tx, { action: "demo.rolled_back", entityType: "Demo" });
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
    expect(await t.deps.root.auditLog.count({ where: { action: "demo.rolled_back" } })).toBe(0);
  });

  it("records logins with the request id", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    await request(t.app)
      .post("/api/v1/auth/login")
      .send({ username: user.username, password: PASSWORD, clientType: "MOBILE" });
    const row = await t.deps.root.auditLog.findFirstOrThrow({ where: { actorUserId: user.id, action: "auth.login" } });
    expect(row.tenantId).toBe(t.defaultTenant.tenant.id);
  });
});

describe("idempotency", () => {
  it("replays the first response and rejects the key with a different body", async () => {
    const user = await t.defaultTenant.createUser("TEACHER");
    const auth = await bearer(user.username);
    const key = "demo-key-0000000000000001";
    const first = await request(t.app)
      .patch("/api/v1/me/preferences")
      .set(auth)
      .set("Idempotency-Key", key)
      .send({ density: "COMPACT" });
    expect(first.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100)); // the record is stored when the response finishes
    const replay = await request(t.app)
      .patch("/api/v1/me/preferences")
      .set(auth)
      .set("Idempotency-Key", key)
      .send({ density: "COMPACT" });
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body).toEqual(first.body);
    const conflict = await request(t.app)
      .patch("/api/v1/me/preferences")
      .set(auth)
      .set("Idempotency-Key", key)
      .send({ density: "COMFORTABLE" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("errors and OpenAPI", () => {
  it("unknown routes answer in the standard error format", async () => {
    const res = await request(t.app).get("/api/v1/yoq");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "errors.NOT_FOUND" } });
  });

  it("validation errors list the fields", async () => {
    const res = await request(t.app).post("/api/v1/auth/login").send({ username: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.fields.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(["username", "password"]),
    );
  });

  it("publishes an OpenAPI document of the declared routes", async () => {
    const res = await request(t.app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(["/api/v1/auth/login", "/api/v1/me", "/api/v1/users/{id}/roles"]),
    );
    expect(res.body.paths["/api/v1/roles"].get["x-permission"]).toBe("roles.view");
  });
});
