// One login account: detail with card and activity, a new login name (sessions closed, guardians excluded), an
// employee card for a system account, logout everywhere — and who may do it.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, PASSWORD } from "./support/app";
import { api, bearerFor, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
const slug = () => t.defaultTenant.tenant.slug;
const userOf = async (headers: Record<string, string>) =>
  (await request(t.app).get("/api/v1/me").set(headers)).body as { id: string; username: string };

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
});
afterAll(() => t.close());

describe("user detail", () => {
  it("a teacher's account: card, roles, sessions and activity", async () => {
    const me = await userOf(s.teacher1);
    const d = await s.a.get(`/users/${me.id}`);
    expect(d).toMatchObject({
      username: me.username,
      displayName: "Demo Ustoz Bir",
      person: { kind: "EMPLOYEE", id: s.emp1.id },
      stats: { employee: { teachingGroups: 1, testsTotal: 0 }, student: null, guardian: null },
    });
    expect(d.roles.map((r: { code: string }) => r.code)).toEqual(["TEACHER"]);
    expect(d.sessions.length).toBeGreaterThan(0);
  });

  it("a student's and a guardian's account", async () => {
    const student = await userOf(await studentAuth(t, s, s.s7a.id, slug()));
    expect((await s.a.get(`/users/${student.id}`)).stats.student).toEqual({
      testsFinished: 0,
      averagePercent: null,
      coinBalance: 0,
      attendance: {},
    });
    const guardian = await userOf(s.guardian);
    expect((await s.a.get(`/users/${guardian.id}`)).stats.guardian.children).toEqual([
      { id: s.s7b.id, name: "Oquvchi B Demo" },
    ]);
  });

  it("the list shows card names and finds accounts by name", async () => {
    const found = await s.a.get("/users?q=ustoz");
    expect(found.items.map((u: { name: string }) => u.name).sort()).toEqual(["Ustoz Bir Demo", "Ustoz Ikki Demo"]);
  });

  it("teachers cannot see or change accounts", async () => {
    const me = await userOf(s.teacher1);
    expect((await api(t, s.teacher2).raw("get", `/users/${me.id}`)).status).toBe(403);
    expect((await api(t, s.teacher2).raw("put", `/users/${me.id}/username`, { username: "x.y.z" })).status).toBe(403);
  });
});

describe("login name", () => {
  it("validates, refuses a taken name and guardians", async () => {
    const me = await userOf(s.teacher2);
    expect(
      (await s.a.raw("put", `/users/${me.id}/username`, { username: "a" })).body.error.details.fields[0].code,
    ).toBe("invalid_username");
    expect((await s.a.raw("put", `/users/${me.id}/username`, { username: "ism familiya" })).status).toBe(400);
    const other = await userOf(s.teacher1);
    expect(
      (await s.a.raw("put", `/users/${me.id}/username`, { username: other.username })).body.error.details.reason,
    ).toBe("USERNAME_TAKEN");
    const guardian = await userOf(s.guardian);
    expect(
      (await s.a.raw("put", `/users/${guardian.id}/username`, { username: "vasiy.demo" })).body.error.details.reason,
    ).toBe("GUARDIAN_LOGIN_IS_PHONE");
  });

  it("a new name logs the user out; they sign in with it (any case)", async () => {
    const before = await userOf(s.teacher2);
    const res = await s.a.put(`/users/${before.id}/username`, { username: "  Ustoz.Ikki  " });
    expect(res).toEqual({ id: before.id, username: "ustoz.ikki" });
    expect((await request(t.app).get("/api/v1/me").set(s.teacher2)).status).toBe(401);
    await bearerFor(t, "USTOZ.IKKI", "Yangi-demo-77", slug());
    const old = await request(t.app)
      .post("/api/v1/auth/login")
      .send({ username: before.username, password: "Yangi-demo-77", clientType: "MOBILE", tenant: slug() });
    expect(old.status).toBe(401);
    const audit = await t.deps.root.auditLog.findFirstOrThrow({
      where: { tenantId: t.defaultTenant.tenant.id, action: "user.username_change", entityId: before.id },
    });
    expect(audit.after).toEqual({ username: "ustoz.ikki" });
  });
});

describe("system accounts", () => {
  it("the seed admin gets an employee card, and its name", async () => {
    const admin = await t.defaultTenant.createUser("SCHOOL_ADMIN", { username: "boshliq" });
    const plain = await s.a.get(`/users/${admin.id}`);
    expect(plain).toMatchObject({ displayName: "boshliq", person: null });
    expect((await s.a.raw("post", `/users/${admin.id}/link-employee`, {})).status).toBe(400);
    const linked = await s.a.post(`/users/${admin.id}/link-employee`, {
      newEmployee: { firstName: "Dilshod", lastName: "Karimov" },
    });
    expect(linked).toMatchObject({ displayName: "Dilshod Karimov", person: { kind: "EMPLOYEE" } });
    const auth = await bearerFor(t, "boshliq", PASSWORD, slug());
    expect((await request(t.app).get("/api/v1/me").set(auth)).body.displayName).toBe("Dilshod Karimov");
    expect(
      (await s.a.raw("post", `/users/${admin.id}/link-employee`, { employeeId: s.emp1.id })).body.error.details.reason,
    ).toBe("ACCOUNT_HAS_PERSON");
  });

  it("an existing card without a login can be linked; one with a login cannot", async () => {
    const sys = await t.defaultTenant.createUser("DIRECTOR");
    const emp = await s.a.post("/employees", { firstName: "Demo", lastName: "Direktor" });
    const ids = async (account: string) =>
      (await s.a.get(`/employees?account=${account}&pageSize=100`)).items.map((e: { id: string }) => e.id);
    expect(await ids("without")).toContain(emp.id);
    expect(await ids("without")).not.toContain(s.emp1.id);
    expect(await ids("with")).toContain(s.emp1.id);
    expect(
      (await s.a.raw("post", `/users/${sys.id}/link-employee`, { employeeId: s.emp2.id })).body.error.details.reason,
    ).toBe("ACCOUNT_EXISTS");
    expect((await s.a.post(`/users/${sys.id}/link-employee`, { employeeId: emp.id })).person.id).toBe(emp.id);
  });
});

describe("sessions", () => {
  it("logout everywhere closes every session of the user", async () => {
    const auth = await bearerFor(t, (await userOf(s.teacher1)).username, "Yangi-demo-77", slug());
    const me = await userOf(auth);
    expect((await s.a.post(`/users/${me.id}/sessions/revoke`)).revoked).toBeGreaterThanOrEqual(2);
    expect((await request(t.app).get("/api/v1/me").set(auth)).status).toBe(401);
    expect((await request(t.app).get("/api/v1/me").set(s.teacher1)).status).toBe(401);
    expect((await s.a.get(`/users/${me.id}`)).sessions).toEqual([]);
  });
});
