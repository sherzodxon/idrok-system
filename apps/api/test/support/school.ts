// Builds a small demo school through the API itself (so the endpoints are exercised while setting up).
import request from "supertest";
import { expect } from "vitest";
import { PASSWORD, type createTestApp } from "./app";

type T = Awaited<ReturnType<typeof createTestApp>>;
type Tenant = Awaited<ReturnType<T["createTenant"]>>;

export async function bearerFor(t: T, username: string, password = PASSWORD, tenant?: string) {
  const res = await request(t.app)
    .post("/api/v1/auth/login")
    .send({ username, password, clientType: "MOBILE", ...(tenant ? { tenant } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { Authorization: `Bearer ${res.body.tokens.accessToken}` };
}

export function api(t: T, auth: Record<string, string>) {
  const call = async (
    method: "get" | "post" | "put" | "patch" | "delete",
    path: string,
    body?: unknown,
    expected = [200, 201, 204],
  ) => {
    const req = request(t.app)[method](`/api/v1${path}`).set(auth);
    const res = body === undefined ? await req : await req.send(body as object);
    expect(expected, `${method.toUpperCase()} ${path} → ${res.status} ${JSON.stringify(res.body)}`).toContain(
      res.status,
    );
    return res;
  };
  return {
    get: (p: string) => call("get", p).then((r) => r.body),
    post: (p: string, b: unknown = {}) => call("post", p, b).then((r) => r.body),
    put: (p: string, b: unknown) => call("put", p, b).then((r) => r.body),
    patch: (p: string, b: unknown) => call("patch", p, b).then((r) => r.body),
    raw: (method: "get" | "post" | "put" | "patch" | "delete", p: string, b?: unknown) =>
      call(method, p, b, [200, 201, 204, 400, 401, 403, 404, 409, 422]),
  };
}

/** Year 2026-2027, grades 4 and 7, classes 4-A, 7-A, 7-B, two teachers, students and a guardian. */
export async function buildSchool(t: T, tenant: Tenant) {
  await t.deps.root.schoolSettings.create({ data: { tenantId: tenant.tenant.id } });
  const admin = await tenant.createUser("SCHOOL_ADMIN");
  const a = api(t, await bearerFor(t, admin.username, PASSWORD, tenant.tenant.slug));

  const year = await a.post("/academic-years", { name: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" });
  await a.post(`/academic-years/${year.id}/activate`);
  const g4 = await a.post("/grades", { level: 4, name: "4-sinf" });
  const g7 = await a.post("/grades", { level: 7, name: "7-sinf" });
  const c4a = await a.post("/class-groups", { academicYearId: year.id, gradeId: g4.id, section: "A" });
  const c7a = await a.post("/class-groups", { academicYearId: year.id, gradeId: g7.id, section: "A" });
  const c7b = await a.post("/class-groups", { academicYearId: year.id, gradeId: g7.id, section: "B" });
  const math = await a.post("/subjects", { name: "Demo matematika" });
  const english = await a.post("/subjects", { name: "Demo ingliz tili" });

  const emp1 = await a.post("/employees", { firstName: "Demo", lastName: "Ustoz Bir" });
  const emp2 = await a.post("/employees", { firstName: "Demo", lastName: "Ustoz Ikki" });
  const acc1 = await a.post(`/employees/${emp1.id}/account`, {});
  const acc2 = await a.post(`/employees/${emp2.id}/account`, {});

  // Teacher 1: maths in 7-A. Teacher 2: maths in 7-B and homeroom of 7-B (class teacher role).
  await a.post("/teacher-assignments", {
    teacherId: emp1.id,
    teachingGroupId: c7a.classTeachingGroupId,
    subjectId: math.id,
    validFrom: "2026-09-01",
  });
  await a.post("/teacher-assignments", {
    teacherId: emp2.id,
    teachingGroupId: c7b.classTeachingGroupId,
    subjectId: math.id,
    validFrom: "2026-09-01",
  });
  await a.patch(`/class-groups/${c7b.id}`, { homeroomTeacherId: emp2.id });
  await a.put(`/users/${acc2.userId}/roles`, { roleIds: [tenant.roles.TEACHER, tenant.roles.CLASS_TEACHER] });

  const s7a = await a.post("/students", {
    firstName: "Demo",
    lastName: "Oquvchi A",
    enrollment: { classGroupId: c7a.id, validFrom: "2026-09-01" },
  });
  const s7b = await a.post("/students", {
    firstName: "Demo",
    lastName: "Oquvchi B",
    enrollment: { classGroupId: c7b.id, validFrom: "2026-09-01" },
  });
  const s4a = await a.post("/students", {
    firstName: "Demo",
    lastName: "Oquvchi Kichik",
    enrollment: { classGroupId: c4a.id, validFrom: "2026-09-01" },
  });
  const linked = await a.post(`/students/${s7b.id}/guardians`, {
    newGuardian: { firstName: "Demo", lastName: "Vasiy", phone: "+998 90 555 11 22" },
    relation: "MOTHER",
    isPrimary: true,
  });
  const guardianId = linked.guardians[0].guardianId as string;
  const gAcc = await a.post(`/guardians/${guardianId}/account`);

  // Temporary passwords must be changed before the accounts can do anything else.
  const firstLogin = async (username: string, temporaryPassword: string) => {
    const auth = await bearerFor(t, username, temporaryPassword, tenant.tenant.slug);
    await request(t.app)
      .post("/api/v1/auth/change-password")
      .set(auth)
      .send({ currentPassword: temporaryPassword, newPassword: "Yangi-demo-77" })
      .expect(204);
    return auth;
  };

  return {
    a,
    adminAuthHeaders: await bearerFor(t, admin.username, PASSWORD, tenant.tenant.slug),
    year,
    g4,
    g7,
    c4a,
    c7a,
    c7b,
    math,
    english,
    emp1,
    emp2,
    s7a,
    s7b,
    s4a,
    guardianId,
    teacher1: await firstLogin(acc1.username, acc1.temporaryPassword),
    teacher2: await firstLogin(acc2.username, acc2.temporaryPassword),
    guardian: await firstLogin(gAcc.username, gAcc.temporaryPassword),
    guardianUsername: gAcc.username as string,
  };
}

/** A student login (from grade 5), past its first-login password change. */
export async function studentAuth(t: T, s: { a: ReturnType<typeof api> }, studentId: string, tenantSlug: string) {
  const acc = await s.a.post(`/students/${studentId}/account`, {});
  const auth = await bearerFor(t, acc.username, acc.temporaryPassword, tenantSlug);
  await request(t.app)
    .post("/api/v1/auth/change-password")
    .set(auth)
    .send({ currentPassword: acc.temporaryPassword, newPassword: "Yangi-demo-77" })
    .expect(204);
  return auth;
}
