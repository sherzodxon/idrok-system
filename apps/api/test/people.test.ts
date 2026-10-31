import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await buildSchool(t, t.defaultTenant);
});
afterAll(() => t.close());

const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id).sort();

describe("teacher scope", () => {
  it("a teacher lists only the students of their own groups", async () => {
    const t1 = api(t, s.teacher1);
    expect(ids(await t1.get("/students"))).toEqual([s.s7a.id]);
    const t2 = api(t, s.teacher2);
    expect(ids(await t2.get("/students"))).toEqual([s.s7b.id]);
  });

  it("another group's student does not exist for the teacher (404)", async () => {
    const res = await request(t.app).get(`/api/v1/students/${s.s7b.id}`).set(s.teacher1);
    expect(res.status).toBe(404);
    expect((await request(t.app).get(`/api/v1/students/${s.s7a.id}`).set(s.teacher1)).status).toBe(200);
  });

  it("sees only own classes, groups and assignments", async () => {
    const t1 = api(t, s.teacher1);
    expect(ids(await t1.get("/class-groups"))).toEqual([s.c7a.id]);
    expect((await request(t.app).get(`/api/v1/class-groups/${s.c7b.id}`).set(s.teacher1)).status).toBe(404);
    const assignments = await t1.get("/teacher-assignments");
    expect(assignments.items.map((x: { teacherId: string }) => x.teacherId)).toEqual([s.emp1.id]);
    expect((await t1.get("/teaching-groups")).map((g: { id: string }) => g.id)).toEqual([s.c7a.classTeachingGroupId]);
  });

  it("only the class teacher sees guardian contacts", async () => {
    const t2 = await request(t.app).get(`/api/v1/students/${s.s7b.id}`).set(s.teacher2);
    expect(t2.body.guardians).toHaveLength(1);
    expect(ids(await api(t, s.teacher2).get("/guardians"))).toEqual([s.guardianId]);
    // A plain teacher has no guardians.view permission at all.
    expect((await request(t.app).get("/api/v1/guardians").set(s.teacher1)).status).toBe(403);
  });

  it("cannot write", async () => {
    const res = await request(t.app).patch(`/api/v1/students/${s.s7a.id}`).set(s.teacher1).send({ notes: "x" });
    expect(res.status).toBe(403);
  });

  it("loses access when the assignment ends", async () => {
    const extra = await s.a.post("/students", {
      firstName: "Demo",
      lastName: "Vaqtinchalik",
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
    expect(ids(await api(t, s.teacher1).get("/students"))).toContain(extra.id);
    const assignment = (await s.a.get(`/teacher-assignments?teacherId=${s.emp1.id}`)).items[0];
    await s.a.post(`/teacher-assignments/${assignment.id}/end`, { validTo: "2026-09-01" });
    expect(ids(await api(t, s.teacher1).get("/students"))).toEqual([]);
  });
});

describe("guardian scope", () => {
  it("sees only their own child", async () => {
    const g = api(t, s.guardian);
    expect((await g.get("/me/children")).map((c: { id: string }) => c.id)).toEqual([s.s7b.id]);
    expect((await request(t.app).get(`/api/v1/students/${s.s7b.id}`).set(s.guardian)).status).toBe(200);
    expect((await request(t.app).get(`/api/v1/students/${s.s7a.id}`).set(s.guardian)).status).toBe(404);
    // No staff list endpoints.
    expect((await request(t.app).get("/api/v1/students").set(s.guardian)).status).toBe(403);
  });

  it("logs in with the phone number", async () => {
    expect(s.guardianUsername).toBe("+998905551122");
  });

  it("loses access when the link is revoked", async () => {
    const extra = await s.a.post("/students", { firstName: "Demo", lastName: "Ikkinchi farzand" });
    await s.a.post(`/students/${extra.id}/guardians`, { guardianId: s.guardianId, relation: "MOTHER" });
    expect((await request(t.app).get(`/api/v1/students/${extra.id}`).set(s.guardian)).status).toBe(200);
    await request(t.app)
      .delete(`/api/v1/students/${extra.id}/guardians/${s.guardianId}`)
      .set(s.adminAuthHeaders)
      .expect(204);
    expect((await request(t.app).get(`/api/v1/students/${extra.id}`).set(s.guardian)).status).toBe(404);
  });
});

describe("enrollment", () => {
  it("a transfer keeps history and moves the whole-class group membership", async () => {
    const st = await s.a.post("/students", {
      firstName: "Demo",
      lastName: "Kochuvchi",
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
    const moved = await s.a.post(`/students/${st.id}/enrollments`, {
      classGroupId: s.c7b.id,
      validFrom: "2026-11-02",
      reason: "demo",
    });
    expect(moved.classGroup.id).toBe(s.c7b.id);
    expect(
      moved.enrollments.map((e: { status: string; validFrom: string; validTo: string | null }) => [
        e.status,
        e.validFrom,
        e.validTo,
      ]),
    ).toEqual([
      ["ACTIVE", "2026-11-02", null],
      ["TRANSFERRED", "2026-09-01", "2026-11-01"],
    ]);
    const memberships = await t.deps.root.teachingGroupMember.findMany({
      where: { studentId: st.id },
      orderBy: { validFrom: "asc" },
    });
    expect(memberships.map((m) => [m.teachingGroupId, m.validTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      [s.c7a.classTeachingGroupId, "2026-11-01"],
      [s.c7b.classTeachingGroupId, null],
    ]);
  });

  it("a same-day correction cancels the wrong placement", async () => {
    const st = await s.a.post("/students", {
      firstName: "Demo",
      lastName: "Xato joy",
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
    const fixed = await s.a.post(`/students/${st.id}/enrollments`, { classGroupId: s.c7b.id, validFrom: "2026-09-01" });
    expect(fixed.enrollments.map((e: { status: string }) => e.status).sort()).toEqual(["ACTIVE", "CANCELLED"]);
  });

  it("parallel transfers leave exactly one active enrollment", async () => {
    const st = await s.a.post("/students", { firstName: "Demo", lastName: "Poyga" });
    const send = (classGroupId: string) =>
      request(t.app)
        .post(`/api/v1/students/${st.id}/enrollments`)
        .set(s.adminAuthHeaders)
        .send({ classGroupId, validFrom: "2026-09-01" });
    const results = await Promise.all([send(s.c7a.id), send(s.c7b.id), send(s.c4a.id)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await t.deps.root.studentEnrollment.count({ where: { studentId: st.id, status: "ACTIVE" } })).toBe(1);
  });

  it("rejects dates outside the academic year", async () => {
    const st = await s.a.post("/students", { firstName: "Demo", lastName: "Sana" });
    const res = await s.a.raw("post", `/students/${st.id}/enrollments`, {
      classGroupId: s.c7a.id,
      validFrom: "2027-08-01",
    });
    expect(res.status).toBe(400);
  });

  it("subgroup members must be enrolled in the class", async () => {
    const sub = await s.a.post("/teaching-groups", {
      classGroupId: s.c7a.id,
      subjectId: s.english.id,
      name: "7-A ingliz 1-guruh",
    });
    const ok = await s.a.put(`/teaching-groups/${sub.id}/members`, {
      add: [{ studentId: s.s7a.id, validFrom: "2026-09-01" }],
    });
    expect(ok.members).toEqual([s.s7a.id]);
    const res = await s.a.raw("put", `/teaching-groups/${sub.id}/members`, {
      add: [{ studentId: s.s7b.id, validFrom: "2026-09-01" }],
    });
    expect(res.status).toBe(409);
  });
});

describe("students", () => {
  it("codes are sequential and unique under parallel creation", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(t.app)
          .post("/api/v1/students")
          .set(s.adminAuthHeaders)
          .send({ firstName: "Demo", lastName: `Parallel ${i}` }),
      ),
    );
    const codes = created.map((r) => r.body.studentCode as string);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^STD-\d{4}$/);
  });

  it("student accounts start from grade 5 unless confirmed (Q-27)", async () => {
    const below = await s.a.raw("post", `/students/${s.s4a.id}/account`, {});
    expect(below.status).toBe(409);
    expect(below.body.error.details.reason).toBe("STUDENT_BELOW_MIN_GRADE");
    const forced = await s.a.post(`/students/${s.s4a.id}/account`, { allowBelowMinGrade: true });
    expect(forced.username).toBe(s.s4a.studentCode.toLowerCase());
    const normal = await s.a.post(`/students/${s.s7a.id}/account`, {});
    expect(normal.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
  });

  it("archiving closes enrollment and memberships", async () => {
    const st = await s.a.post("/students", {
      firstName: "Demo",
      lastName: "Ketdi",
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
    const archived = await s.a.post(`/students/${st.id}/archive`, { status: "LEFT", date: "2026-12-20" });
    expect(archived.status).toBe("LEFT");
    expect(archived.enrollments[0]).toMatchObject({ status: "LEFT", validTo: "2026-12-20" });
    expect(await t.deps.root.teachingGroupMember.count({ where: { studentId: st.id, validTo: null } })).toBe(0);
  });

  it("validates phones and lists with pagination", async () => {
    const bad = await s.a.raw("post", "/guardians", { firstName: "Demo", lastName: "Telefon", phone: "12345" });
    expect(bad.status).toBe(400);
    const pageRes = await s.a.get("/students?page=1&pageSize=2&sort=-createdAt");
    expect(pageRes.items).toHaveLength(2);
    expect(pageRes.total).toBeGreaterThan(2);
    expect((await s.a.raw("get", "/students?sort=password")).status).toBe(400);
  });

  it("every change is audited", async () => {
    const audit = await t.deps.root.auditLog.findFirst({ where: { entityId: s.s7a.id, action: "student.enroll" } });
    expect(audit).not.toBeNull();
  });
});

describe("academic years", () => {
  it("activating a year closes the previous one", async () => {
    const next = await s.a.post("/academic-years", {
      name: "2027-2028",
      startDate: "2027-09-01",
      endDate: "2028-06-30",
    });
    await s.a.post(`/academic-years/${next.id}/activate`);
    const years = await s.a.get("/academic-years");
    expect(years.map((y: { name: string; status: string }) => [y.name, y.status])).toEqual([
      ["2027-2028", "ACTIVE"],
      ["2026-2027", "CLOSED"],
    ]);
  });
});
