// M2 step 6: cancel → reflow (acceptance 7), marking held, today's lessons, the portal week and the lesson-count report.
import { addSchoolDays, isoWeekday, schoolDateFromDb, schoolDateToDb, schoolToday } from "@idrok/shared/time";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let plan: { id: string; items: { id: string; topicTitle: string }[] };
let assignmentId: string;
const today = schoolToday("Asia/Tashkent");
const yearPath = () => `/academic-years/${s.year.id}`;
const maths = (cls: { classTeachingGroupId: string }, teacherId: string, weekday: number) => ({
  teachingGroupId: cls.classTeachingGroupId,
  subjectId: s.math.id,
  teacherId,
  weekday,
  lessonNumber: 1,
});

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  await s.a.post(`${yearPath()}/periods`, {
    type: "YEAR",
    name: "Yil",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2027-06-30",
  });
  await s.a.post(`${yearPath()}/bell-schedules`, {
    name: "Asosiy",
    validFrom: "2026-09-01",
    slots: [{ lessonNumber: 1, startTime: "08:00", endTime: "08:45" }],
  });
  // 7-A maths every working day (so today has a lesson whatever the weekday), 7-B maths on Tuesdays.
  const tt = await s.a.post(`${yearPath()}/timetables`, {});
  await s.a.put(`/timetables/${tt.id}/entries`, {
    entries: [...[1, 2, 3, 4, 5, 6].map((d) => maths(s.c7a, s.emp1.id, d)), maths(s.c7b, s.emp2.id, 2)],
  });
  await s.a.post(`/timetables/${tt.id}/publish`, { validFrom: "2026-09-01" });
  const p = await s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast: true });
  await s.a.post(`${yearPath()}/lesson-generation/apply`, { includePast: true, previewHash: p.previewHash });

  const draft = await s.a.post("/curriculum-plans", {
    academicYearId: s.year.id,
    subjectId: s.math.id,
    gradeId: s.g7.id,
    title: "Matematika 7",
    items: Array.from({ length: 300 }, (_, i) => ({ topicTitle: `Mavzu ${i + 1}`, hours: 1, homework: `Uy ${i + 1}` })),
  });
  await s.a.post(`/curriculum-plans/${draft.id}/submit`);
  plan = await s.a.post(`/curriculum-plans/${draft.id}/approve`);
  const assigned = await s.a.post(`/curriculum-plans/${plan.id}/assignments`, {
    teachingGroupIds: [s.c7a.classTeachingGroupId, s.c7b.classTeachingGroupId],
  });
  assignmentId = assigned[0].id;
}, 180_000);
afterAll(() => t.close());

const lessonsOf7a = () =>
  t.deps.root.lessonSession.findMany({
    where: { teachingGroupId: s.c7a.classTeachingGroupId, status: { not: "CANCELLED" } },
    orderBy: { sequenceNo: "asc" },
    select: { id: true, date: true, planItemId: true, status: true },
  });

describe("acceptance 7: a cancelled lesson moves the coming topics by one", () => {
  it("cancel → reflow preview → apply; past lessons keep their topics", async () => {
    const before = await lessonsOf7a();
    const future = before.filter((l) => schoolDateFromDb(l.date) > today);
    const target = future[2]!;
    const shifted = future.slice(2, 6).map((l) => l.planItemId);

    const res = await s.a.post(`/lesson-sessions/${target.id}/cancel`, { reason: "Demo tadbir" });
    expect(res.lesson).toMatchObject({ status: "CANCELLED", cancelReason: "Demo tadbir", planItemId: null });
    expect(res.planAssignmentId).toBe(assignmentId);

    const preview = await s.a.post(`/plan-assignments/${assignmentId}/reflow/preview`);
    expect(preview.changes.length).toBeGreaterThan(0);
    expect(preview.changes.every((c: { date: string }) => c.date > today)).toBe(true);
    expect(preview.changes[0]).toMatchObject({ fromTopic: expect.any(String), toTopic: expect.any(String) });

    await s.a.post(`/plan-assignments/${assignmentId}/reflow/apply`);
    const after = await lessonsOf7a();
    // Past and today's lessons unchanged.
    const fixed = (rows: typeof before) => rows.filter((l) => schoolDateFromDb(l.date) <= today);
    expect(fixed(after)).toEqual(fixed(before));
    // The lesson after the cancelled one now has its topic, and so on.
    const afterFuture = after.filter((l) => schoolDateFromDb(l.date) > today);
    expect(afterFuture.slice(2, 6).map((l) => l.planItemId)).toEqual(shifted);
    // Regeneration never brings a lesson cancelled by hand back.
    const regen = await s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast: false });
    expect(regen).toMatchObject({ add: 0, update: 0 });
    // A second reflow has nothing to do.
    expect((await s.a.post(`/plan-assignments/${assignmentId}/reflow/preview`)).changes).toEqual([]);
  });

  it("teachers reflow only their own group", async () => {
    const assignments = await s.a.get(`/curriculum-plans/${plan.id}/assignments`);
    const of7b = assignments.find((a: { teachingGroupName: string }) => a.teachingGroupName === "7-B");
    expect((await api(t, s.teacher1).raw("post", `/plan-assignments/${of7b.id}/reflow/preview`)).status).toBe(403);
    expect((await api(t, s.teacher1).raw("post", `/plan-assignments/${assignmentId}/reflow/preview`)).status).toBe(200);
  });
});

describe("marking lessons held (§4.7)", () => {
  it("the teacher marks a past lesson held, with another topic of the plan or a note", async () => {
    const past = (await lessonsOf7a()).filter((l) => schoolDateFromDb(l.date) < today);
    const teacher = api(t, s.teacher1);
    const held = await teacher.post(`/lesson-sessions/${past[0]!.id}/held`, {});
    expect(held).toMatchObject({ status: "HELD", topicTitle: "Mavzu 1", homework: "Uy 1" });
    expect(held.heldMarkedAt).toBeTruthy();
    const other = await teacher.post(`/lesson-sessions/${past[1]!.id}/held`, {
      planItemId: plan.items[9]!.id,
      actualTopicNote: "Takrorlash ham qilindi",
    });
    expect(other).toMatchObject({ topicTitle: "Mavzu 10", actualTopicNote: "Takrorlash ham qilindi" });
  });

  it("not a future lesson, not someone else's, not a topic of another plan", async () => {
    const lessons = await lessonsOf7a();
    const future = lessons.find((l) => schoolDateFromDb(l.date) > today)!;
    const past = lessons.find((l) => schoolDateFromDb(l.date) < today && l.status === "SCHEDULED")!;
    const teacher = api(t, s.teacher1);
    expect((await teacher.raw("post", `/lesson-sessions/${future.id}/held`, {})).body.error.details.reason).toBe(
      "LESSON_IN_FUTURE",
    );
    expect((await api(t, s.teacher2).raw("post", `/lesson-sessions/${past.id}/held`, {})).status).toBe(404);
    const otherPlan = await s.a.post("/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "Boshqa",
      items: [{ topicTitle: "Begona", hours: 1 }],
    });
    const wrong = await teacher.raw("post", `/lesson-sessions/${past.id}/held`, { planItemId: otherPlan.items[0].id });
    expect(wrong.status).toBe(400);
    expect((await api(t, s.guardian).raw("post", `/lesson-sessions/${past.id}/held`, {})).status).toBe(403);
  });

  it("a substitute marks the lesson they cover; the regular teacher does not", async () => {
    const past = (await lessonsOf7a()).filter((l) => schoolDateFromDb(l.date) < today && l.status === "SCHEDULED");
    await s.a.put(`/lesson-sessions/${past[0]!.id}/substitute`, { substituteTeacherId: s.emp2.id });
    expect((await api(t, s.teacher1).raw("post", `/lesson-sessions/${past[0]!.id}/held`, {})).status).toBe(403);
    expect((await api(t, s.teacher2).post(`/lesson-sessions/${past[0]!.id}/held`, {})).status).toBe("HELD");
  });
});

describe("today, the portal week and the report", () => {
  it("today's lessons with topics", async () => {
    const mine = await api(t, s.teacher1).get("/me/lessons/today");
    const expected = await t.deps.root.lessonSession.count({
      where: {
        teacherId: s.emp1.id,
        substituteTeacherId: null,
        date: schoolDateToDb(today),
        status: { not: "CANCELLED" },
      },
    });
    expect(mine).toHaveLength(expected);
    if (mine.length) expect(mine[0].topicTitle).toMatch(/^Mavzu /);
    expect(await api(t, s.teacher2).get("/me/lessons/today")).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ teacherId: s.emp1.id, substituteTeacherId: null })]),
    );
  });

  it("a guardian sees their child's week with topics and homework, and nobody else's", async () => {
    // The guardian of the fixture is linked to a 7-B student; 7-B has maths on Tuesdays.
    let tuesday = addSchoolDays(today, 1);
    while (isoWeekday(tuesday) !== 2) tuesday = addSchoolDays(tuesday, 1);
    const guardian = api(t, s.guardian);
    const week = await guardian.get(`/me/timetable?studentId=${s.s7b.id}&date=${tuesday}`);
    expect(week.studentId).toBe(s.s7b.id);
    expect(week.today).toBe(today);
    expect(week.lessons).toEqual([
      expect.objectContaining({
        date: tuesday,
        subjectName: "Demo matematika",
        topicTitle: expect.stringMatching(/^Mavzu /),
        homework: expect.stringMatching(/^Uy /),
      }),
    ]);
    expect((await guardian.raw("get", `/me/timetable?studentId=${s.s7a.id}`)).status).toBe(404);
    expect((await guardian.raw("get", "/me/timetable")).status).toBe(400);
    expect((await api(t, s.teacher1).raw("get", "/me/timetable")).status).toBe(403);
    expect((await request(t.app).get("/api/v1/me/timetable")).status).toBe(401);
  });

  it("the lesson-count report compares planned hours and lessons", async () => {
    const rows = await s.a.get(`/reports/lesson-counts?academicYearId=${s.year.id}`);
    const row7a = rows.find((r: { teachingGroupName: string }) => r.teachingGroupName === "7-A");
    const lessons = await t.deps.root.lessonSession.count({
      where: { teachingGroupId: s.c7a.classTeachingGroupId, status: { not: "CANCELLED" } },
    });
    expect(row7a).toMatchObject({ subjectName: "Demo matematika", lessons, plannedHours: 300 });
    expect(row7a.held).toBeGreaterThanOrEqual(2);
    expect((await api(t, s.guardian).raw("get", `/reports/lesson-counts?academicYearId=${s.year.id}`)).status).toBe(
      403,
    );
  });
});
