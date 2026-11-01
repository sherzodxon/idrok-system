// M2 step 2: timetable versions, entries, conflicts and publishing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
}, 120_000);
afterAll(() => t.close());

const yearPath = () => `/academic-years/${s.year.id}`;
const mathIn = (cls: { classTeachingGroupId: string }, teacherId: string, weekday: number, lessonNumber: number) => ({
  teachingGroupId: cls.classTeachingGroupId,
  subjectId: s.math.id,
  teacherId,
  weekday,
  lessonNumber,
});

describe("drafts", () => {
  let v1: { id: string; version: number };

  it("creates numbered versions and replaces entries", async () => {
    v1 = await s.a.post(`${yearPath()}/timetables`, {});
    expect(v1).toMatchObject({ version: 1, status: "DRAFT", validFrom: null, entryCount: 0 });
    const detail = await s.a.put(`/timetables/${v1.id}/entries`, {
      entries: [mathIn(s.c7a, s.emp1.id, 1, 1), mathIn(s.c7a, s.emp1.id, 3, 2), mathIn(s.c7b, s.emp2.id, 1, 1)],
    });
    expect(detail.entries).toHaveLength(3);
    expect(detail.conflicts).toEqual([]);
    expect(detail.warnings).toEqual([]);
    expect(detail.entries[0]).toMatchObject({ teachingGroupName: "7-A", subjectName: "Demo matematika" });
  });

  it("reports conflicts and unassigned teachers; a view filters by class or teacher", async () => {
    const detail = await s.a.put(`/timetables/${v1.id}/entries`, {
      entries: [
        mathIn(s.c7a, s.emp1.id, 1, 1),
        mathIn(s.c7b, s.emp1.id, 1, 1), // teacher 1 twice, and not assigned to 7-B
        mathIn(s.c7b, s.emp2.id, 2, 1),
      ],
    });
    expect(detail.conflicts.map((c: { kind: string }) => c.kind)).toEqual(["TEACHER_BUSY"]);
    expect(detail.warnings).toHaveLength(1);
    const byClass = await s.a.get(`/timetables/${v1.id}?view=class&id=${s.c7b.id}`);
    expect(byClass.entries).toHaveLength(2);
    const byTeacher = await s.a.get(`/timetables/${v1.id}?view=teacher&id=${s.emp2.id}`);
    expect(byTeacher.entries).toHaveLength(1);
    expect(byTeacher.conflicts).toEqual([]);
  });

  it("rejects references from outside the year and a timetable with conflicts", async () => {
    const other = await s.a.post("/academic-years", {
      name: "2027-2028",
      startDate: "2027-09-01",
      endDate: "2028-06-30",
    });
    const g7 = await s.a.post("/class-groups", { academicYearId: other.id, gradeId: s.g7.id, section: "A" });
    const bad = await s.a.raw("put", `/timetables/${v1.id}/entries`, {
      entries: [mathIn(g7, s.emp1.id, 1, 1)],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields[0].path).toBe("entries.0.teachingGroupId");
    const blocked = await s.a.raw("post", `/timetables/${v1.id}/publish`, { validFrom: "2026-09-01" });
    expect(blocked.body.error.details.reason).toBe("TIMETABLE_HAS_CONFLICTS");
  });
});

describe("publishing", () => {
  it("publishes, freezes and hands over to the next version the day before", async () => {
    const v = await s.a.post(`${yearPath()}/timetables`, {});
    await s.a.put(`/timetables/${v.id}/entries`, {
      entries: [mathIn(s.c7a, s.emp1.id, 1, 1), mathIn(s.c7b, s.emp2.id, 1, 1)],
    });
    const published = await s.a.post(`/timetables/${v.id}/publish`, { validFrom: "2026-09-01" });
    expect(published).toMatchObject({ status: "PUBLISHED", validFrom: "2026-09-01", validTo: null });
    const frozen = await s.a.raw("put", `/timetables/${v.id}/entries`, { entries: [] });
    expect(frozen.body.error.details.reason).toBe("TIMETABLE_NOT_DRAFT");
    expect((await s.a.raw("delete", `/timetables/${v.id}`)).status).toBe(409);

    // The next version starts later: a copy with one change.
    const next = await s.a.post(`${yearPath()}/timetables`, { copyFromId: v.id });
    expect(next.entryCount).toBe(2);
    await s.a.put(`/timetables/${next.id}/entries`, {
      entries: [mathIn(s.c7a, s.emp1.id, 2, 1), mathIn(s.c7b, s.emp2.id, 1, 1)],
    });
    const early = await s.a.raw("post", `/timetables/${next.id}/publish`, { validFrom: "2026-09-01" });
    expect(early.body.error.details.fields[0].code).toBe("not_after_previous");
    await s.a.post(`/timetables/${next.id}/publish`, { validFrom: "2026-11-09" });
    const versions = await s.a.get(`${yearPath()}/timetables`);
    const old = versions.find((x: { id: string }) => x.id === v.id);
    expect(old).toMatchObject({ validFrom: "2026-09-01", validTo: "2026-11-08", status: "PUBLISHED" });
  });

  it("an empty draft cannot be published; a draft can be deleted", async () => {
    const v = await s.a.post(`${yearPath()}/timetables`, {});
    const empty = await s.a.raw("post", `/timetables/${v.id}/publish`, { validFrom: "2027-01-10" });
    expect(empty.body.error.details.reason).toBe("TIMETABLE_EMPTY");
    expect((await s.a.raw("delete", `/timetables/${v.id}`)).status).toBe(204);
  });
});

describe("access", () => {
  it("teachers view the timetable but cannot edit or publish it", async () => {
    const teacher = api(t, s.teacher1);
    const versions = await teacher.get(`${yearPath()}/timetables`);
    expect(versions.length).toBeGreaterThan(0);
    expect((await teacher.raw("post", `${yearPath()}/timetables`, {})).status).toBe(403);
    expect(
      (await teacher.raw("post", `/timetables/${versions[0].id}/publish`, { validFrom: "2027-02-01" })).status,
    ).toBe(403);
  });

  it("guardians cannot read the school timetable", async () => {
    expect((await api(t, s.guardian).raw("get", `${yearPath()}/timetables`)).status).toBe(403);
  });
});
