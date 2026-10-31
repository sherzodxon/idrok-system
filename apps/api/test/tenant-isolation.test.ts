// Every tenant-scoped endpoint, called by an admin of another school with this school's ids, must answer 404
// (or an empty list) — never data and never a change.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let a: Awaited<ReturnType<typeof buildSchool>>;
let b: Awaited<ReturnType<typeof buildSchool>>;
beforeAll(async () => {
  t = await createTestApp();
  a = await buildSchool(t, t.defaultTenant);
  b = await buildSchool(t, await t.createTenant());
});
afterAll(() => t.close());

describe("tenant isolation", () => {
  const foreign = () => ({
    get: [
      `/students/${a.s7a.id}`,
      `/guardians/${a.guardianId}`,
      `/employees/${a.emp1.id}`,
      `/class-groups/${a.c7a.id}`,
    ],
    write: [
      ["patch", `/students/${a.s7a.id}`, { notes: "hijack" }],
      ["post", `/students/${a.s7a.id}/enrollments`, { classGroupId: b.c7a.id, validFrom: "2026-09-02" }],
      ["post", `/students/${a.s7a.id}/archive`, { status: "LEFT", date: "2026-10-01" }],
      ["post", `/students/${a.s7a.id}/guardians`, { guardianId: b.guardianId, relation: "OTHER" }],
      ["post", `/students/${a.s7a.id}/account`, {}],
      ["patch", `/guardians/${a.guardianId}`, { notes: "hijack" }],
      ["patch", `/employees/${a.emp1.id}`, { positionTitle: "hijack" }],
      ["patch", `/class-groups/${a.c7a.id}`, { capacity: 1 }],
      ["patch", `/subjects/${a.math.id}`, { name: "hijack" }],
      ["patch", `/academic-years/${a.year.id}`, { endDate: "2027-06-29" }],
      ["post", `/academic-years/${a.year.id}/activate`, {}],
      ["put", `/teaching-groups/${a.c7a.classTeachingGroupId}/members`, { add: [] }],
      [
        "post",
        "/teacher-assignments",
        {
          teacherId: a.emp1.id,
          teachingGroupId: b.c7a.classTeachingGroupId,
          subjectId: b.math.id,
          validFrom: "2026-09-01",
        },
      ],
      ["post", "/class-groups", { academicYearId: a.year.id, gradeId: a.g7.id, section: "Z" }],
      ["post", `/users/${a.emp1.id}/reset-password`, {}],
    ] as const,
  });

  it("reads of another school's ids are 404", async () => {
    for (const path of foreign().get) {
      const res = await request(t.app).get(`/api/v1${path}`).set(b.adminAuthHeaders);
      expect(res.status, path).toBe(404);
    }
  });

  it("writes to another school's ids are 404 and change nothing", async () => {
    const before = await t.deps.root.student.findUniqueOrThrow({ where: { id: a.s7a.id } });
    for (const [method, path, body] of foreign().write) {
      const res = await request(t.app)[method](`/api/v1${path}`).set(b.adminAuthHeaders).send(body);
      expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBe(404);
    }
    const after = await t.deps.root.student.findUniqueOrThrow({ where: { id: a.s7a.id } });
    expect(after).toEqual(before);
    expect(await t.deps.root.subject.findUniqueOrThrow({ where: { id: a.math.id } })).toMatchObject({
      name: "Demo matematika",
    });
  });

  it("lists never include another school's rows", async () => {
    const lists = ["/students", "/guardians", "/employees", "/class-groups", "/teacher-assignments", "/users"];
    const aIds = new Set([a.s7a.id, a.s7b.id, a.guardianId, a.emp1.id, a.emp2.id, a.c7a.id]);
    for (const path of lists) {
      const res = await request(t.app).get(`/api/v1${path}?pageSize=100`).set(b.adminAuthHeaders);
      expect(res.status, path).toBe(200);
      for (const item of res.body.items as { id: string }[]) expect(aIds.has(item.id), path).toBe(false);
    }
    for (const path of ["/subjects", "/grades", "/academic-years", "/teaching-groups"]) {
      const res = await request(t.app).get(`/api/v1${path}`).set(b.adminAuthHeaders);
      const theirs = new Set([a.math.id, a.english.id, a.g4.id, a.g7.id, a.year.id, a.c7a.classTeachingGroupId]);
      for (const item of res.body as { id: string }[]) expect(theirs.has(item.id), path).toBe(false);
    }
  });
});
