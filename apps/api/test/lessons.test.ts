// M2 step 3: lesson generation end to end (acceptance 1–5 against the database) and lesson lists.
import { addSchoolDays, isoWeekday, schoolDateToDb, schoolToday } from "@idrok/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
const today = schoolToday("Asia/Tashkent");
/** The first date after today that falls on `weekday` (1 = Monday). */
const nextWeekday = (weekday: number, after = today) => {
  let d = addSchoolDays(after, 1);
  while (isoWeekday(d) !== weekday) d = addSchoolDays(d, 1);
  return d;
};

const yearPath = () => `/academic-years/${s.year.id}`;
const lesson = (cls: { classTeachingGroupId: string }, teacherId: string, weekday: number, lessonNumber: number) => ({
  teachingGroupId: cls.classTeachingGroupId,
  subjectId: s.math.id,
  teacherId,
  weekday,
  lessonNumber,
});

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  // Whole year as one period plus Monday–Friday, bells for lessons 1–2.
  await s.a.post(`${yearPath()}/periods`, {
    type: "YEAR",
    name: "Yil",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
  });
  await s.a.put(`${yearPath()}/school-week`, { workingWeekdays: [1, 2, 3, 4, 5] });
  await s.a.post(`${yearPath()}/bell-schedules`, {
    name: "Asosiy",
    validFrom: "2026-09-01",
    slots: [
      { lessonNumber: 1, startTime: "08:00", endTime: "08:45" },
      { lessonNumber: 2, startTime: "08:55", endTime: "09:40" },
    ],
  });
  const v1 = await s.a.post(`${yearPath()}/timetables`, {});
  await s.a.put(`/timetables/${v1.id}/entries`, {
    entries: [lesson(s.c7a, s.emp1.id, 1, 1), lesson(s.c7a, s.emp1.id, 4, 2), lesson(s.c7b, s.emp2.id, 2, 1)],
  });
  await s.a.post(`/timetables/${v1.id}/publish`, { validFrom: "2026-09-01" });
}, 120_000);
afterAll(() => t.close());

const preview = (includePast = false) => s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast });
const apply = async (includePast = false) => {
  const p = await preview(includePast);
  return s.a.post(`${yearPath()}/lesson-generation/apply`, { includePast, previewHash: p.previewHash });
};
const countLessons = (where: object = {}) =>
  t.deps.root.lessonSession.count({ where: { tenantId: t.defaultTenant.tenant.id, ...where } });

describe("generation", () => {
  it("first generation fills the whole year, past included", async () => {
    const p = await preview(true);
    expect(p).toMatchObject({ from: "2026-09-01", update: 0, cancel: 0, blocked: [] });
    expect(p.add).toBeGreaterThan(100);
    const result = await apply(true);
    expect(result).toEqual({ added: p.add, updated: 0, cancelled: 0 });
    expect(await countLessons()).toBe(p.add);
    // sequenceNo runs 1, 2, 3 … per group and subject.
    const first = await t.deps.root.lessonSession.findMany({
      where: { teachingGroupId: s.c7a.classTeachingGroupId },
      orderBy: [{ date: "asc" }, { lessonNumber: "asc" }],
      take: 3,
      select: { sequenceNo: true, date: true },
    });
    expect(first.map((l) => l.sequenceNo)).toEqual([1, 2, 3]);
  });

  it("acceptance 5: generating again changes nothing; past cannot be refilled", async () => {
    const before = await countLessons();
    const p = await preview();
    expect(p).toMatchObject({ add: 0, update: 0, cancel: 0 });
    await apply();
    expect(await countLessons()).toBe(before);
    const again = await s.a.raw("post", `${yearPath()}/lesson-generation/preview`, { includePast: true });
    expect(again.body.error.details.reason).toBe("PAST_ALREADY_GENERATED");
  });

  it("acceptance 1 (database): a holiday on a lesson day removes that lesson after review", async () => {
    const monday = nextWeekday(1);
    await s.a.post(`${yearPath()}/calendar-days`, { date: monday, kind: "HOLIDAY", title: "Demo bayram" });
    const p = await preview();
    expect(p).toMatchObject({ add: 0, cancel: 1 });
    expect(p.cancelSample[0]).toMatchObject({ date: monday, teachingGroupName: "7-A", subjectName: "Demo matematika" });
    await apply();
    const l = await t.deps.root.lessonSession.findFirst({
      where: { teachingGroupId: s.c7a.classTeachingGroupId, date: schoolDateToDb(monday) },
    });
    expect(l).toMatchObject({ status: "CANCELLED", cancelReason: null });
  });

  it("a stale preview is refused", async () => {
    const p = await preview();
    await s.a.post(`${yearPath()}/calendar-days`, { date: nextWeekday(4), kind: "HOLIDAY", title: "Demo" });
    const res = await s.a.raw("post", `${yearPath()}/lesson-generation/apply`, {
      includePast: false,
      previewHash: p.previewHash,
    });
    expect(res.body.error.details.reason).toBe("PREVIEW_STALE");
    await apply();
  });

  it("acceptance 3 + 4: a new version changes only lessons from its start; held lessons stay", async () => {
    const tuesday = nextWeekday(2);
    const cutover = nextWeekday(1, addSchoolDays(today, 14)); // a Monday ≥ two weeks ahead
    // A future Thursday lesson of 7-A before the cutover is held (e.g. marked early in a test of the rule).
    const held = await t.deps.root.lessonSession.findFirst({
      where: {
        teachingGroupId: s.c7a.classTeachingGroupId,
        date: { gt: schoolDateToDb(cutover) },
        status: "SCHEDULED",
      },
      orderBy: { date: "asc" },
    });
    await t.deps.root.lessonSession.update({
      where: { id: held!.id },
      data: { status: "HELD", heldMarkedAt: new Date() },
    });
    const beforeCutover = await t.deps.root.lessonSession.findMany({
      where: { academicYearId: s.year.id, date: { lt: schoolDateToDb(cutover) } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, teacherId: true, updatedAt: true },
    });

    const versions = await s.a.get(`${yearPath()}/timetables`);
    const v2 = await s.a.post(`${yearPath()}/timetables`, { copyFromId: versions[0].id });
    // 7-A maths moves from Monday to Tuesday; 7-B unchanged.
    await s.a.put(`/timetables/${v2.id}/entries`, {
      entries: [lesson(s.c7a, s.emp1.id, 2, 1), lesson(s.c7a, s.emp1.id, 4, 2), lesson(s.c7b, s.emp2.id, 2, 1)],
    });
    await s.a.post(`/timetables/${v2.id}/publish`, { validFrom: cutover });
    const p = await preview();
    expect(p.cancel).toBeGreaterThan(0);
    expect(p.add).toBe(p.cancel);
    expect(p.cancelSample.every((l: { date: string }) => l.date >= cutover)).toBe(true);
    await apply();

    const after = await t.deps.root.lessonSession.findMany({
      where: { id: { in: beforeCutover.map((l) => l.id) } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, teacherId: true, updatedAt: true },
    });
    expect(after).toEqual(beforeCutover);
    expect((await t.deps.root.lessonSession.findUnique({ where: { id: held!.id } }))!.status).toBe("HELD");
    expect(
      await countLessons({
        teachingGroupId: s.c7a.classTeachingGroupId,
        date: { gte: schoolDateToDb(cutover) },
        status: "SCHEDULED",
      }),
    ).toBeGreaterThan(0);
    // The tuesday before the cutover keeps the old timetable (no 7-A maths on it).
    expect(await countLessons({ teachingGroupId: s.c7a.classTeachingGroupId, date: schoolDateToDb(tuesday) })).toBe(
      tuesday < cutover ? 0 : 1,
    );
  });

  it("sequence numbers stay continuous after changes", async () => {
    const rows = await t.deps.root.lessonSession.findMany({
      where: { teachingGroupId: s.c7a.classTeachingGroupId, subjectId: s.math.id, status: { not: "CANCELLED" } },
      orderBy: [{ date: "asc" }, { lessonNumber: "asc" }],
      select: { sequenceNo: true },
    });
    expect(rows.map((r) => r.sequenceNo)).toEqual(rows.map((_, i) => i + 1));
  });
});

describe("lesson lists and substitutes", () => {
  // A week no earlier step touches (they put holidays on the next Monday and Thursday): three weeks ahead.
  const week = () => {
    const from = nextWeekday(1, addSchoolDays(today, 21));
    return { from, to: addSchoolDays(from, 6) };
  };

  it("teachers see only their own lessons; admins see all", async () => {
    const { from, to } = week();
    const all = await s.a.get(`/lesson-sessions?from=${from}&to=${to}`);
    const mine = await api(t, s.teacher1).get(`/lesson-sessions?from=${from}&to=${to}`);
    expect(all.length).toBeGreaterThan(mine.length);
    expect(mine.every((l: { teacherId: string }) => l.teacherId === s.emp1.id)).toBe(true);
    expect((await api(t, s.guardian).raw("get", `/lesson-sessions?from=${from}&to=${to}`)).status).toBe(403);
    const tooLong = await s.a.raw("get", `/lesson-sessions?from=2026-09-01&to=2027-06-30`);
    expect(tooLong.status).toBe(400);
  });

  it("a substitute sees the lesson they cover (Q-40)", async () => {
    const { from, to } = week();
    const [lesson7a] = await api(t, s.teacher1).get(`/lesson-sessions?from=${from}&to=${to}`);
    const updated = await s.a.put(`/lesson-sessions/${lesson7a.id}/substitute`, { substituteTeacherId: s.emp2.id });
    expect(updated.substituteTeacherName).toContain("Ustoz Ikki");
    const forTwo = await api(t, s.teacher2).get(`/lesson-sessions?from=${from}&to=${to}`);
    expect(forTwo.map((l: { id: string }) => l.id)).toContain(lesson7a.id);
    expect(
      (await api(t, s.teacher1).raw("put", `/lesson-sessions/${lesson7a.id}/substitute`, { substituteTeacherId: null }))
        .status,
    ).toBe(403);
  });
});
