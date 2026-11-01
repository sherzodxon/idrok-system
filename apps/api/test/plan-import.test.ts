// M2 step 5: plan templates and imports (acceptance 8, 9), applying plans to groups (6, 10, 11, 12) — end to end.
import { rmSync } from "node:fs";
import ExcelJS from "exceljs";
import { schoolDateToDb, schoolToday } from "@idrok/shared/time";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";
import { startTestWorker, waitForImport } from "./support/worker";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let worker: Awaited<ReturnType<typeof startTestWorker>> | null = null;
const today = schoolToday("Asia/Tashkent");

const yearPath = () => `/academic-years/${s.year.id}`;
const maths = (cls: { classTeachingGroupId: string }, teacherId: string, weekday: number, lessonNumber: number) => ({
  teachingGroupId: cls.classTeachingGroupId,
  subjectId: s.math.id,
  teacherId,
  weekday,
  lessonNumber,
});

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024", STORAGE_LOCAL_DIR: `.data/test-storage-${process.pid}-plans` });
  s = await buildSchool(t, t.defaultTenant);
  for (const [order, name, startDate, endDate] of [
    [1, "1-chorak", "2026-09-01", "2026-10-31"],
    [2, "2-chorak", "2026-11-01", "2026-12-31"],
    [3, "3-chorak", "2027-01-01", "2027-03-20"],
    [4, "4-chorak", "2027-03-21", "2027-06-30"],
  ] as const)
    await s.a.post(`${yearPath()}/periods`, { type: "QUARTER", name, order, startDate, endDate });
  await s.a.put(`${yearPath()}/school-week`, { workingWeekdays: [1, 2, 3, 4, 5] });
  await s.a.post(`${yearPath()}/bell-schedules`, {
    name: "Asosiy",
    validFrom: "2026-09-01",
    slots: [
      { lessonNumber: 1, startTime: "08:00", endTime: "08:45" },
      { lessonNumber: 2, startTime: "08:55", endTime: "09:40" },
    ],
  });
  const tt = await s.a.post(`${yearPath()}/timetables`, {});
  await s.a.put(`/timetables/${tt.id}/entries`, {
    entries: [maths(s.c7a, s.emp1.id, 1, 1), maths(s.c7a, s.emp1.id, 4, 1), maths(s.c7b, s.emp2.id, 2, 2)],
  });
  await s.a.post(`/timetables/${tt.id}/publish`, { validFrom: "2026-09-01" });
  const p = await s.a.post(`${yearPath()}/lesson-generation/preview`, { includePast: true });
  await s.a.post(`${yearPath()}/lesson-generation/apply`, { includePast: true, previewHash: p.previewHash });
  worker = await startTestWorker(t);
}, 180_000);
afterAll(async () => {
  await worker?.stop();
  await t.close();
  rmSync(t.env.STORAGE_LOCAL_DIR, { recursive: true, force: true });
});

const teacher1 = () => api(t, s.teacher1);
const binary = (req: request.Test) =>
  req.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });

async function template(mode: "ROWS" | "TOPICS", group = s.c7a) {
  const q = new URLSearchParams({
    academicYearId: s.year.id,
    subjectId: s.math.id,
    gradeId: s.g7.id,
    mode,
    ...(mode === "ROWS" ? { teachingGroupId: group.classTeachingGroupId } : {}),
  });
  const res = await binary(request(t.app).get(`/api/v1/curriculum-plans/template?${q}`).set(s.teacher1));
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  return wb;
}

/** Writes `values` (by column key) into data rows 3, 4, … of the first sheet. */
function fill(wb: ExcelJS.Workbook, rows: Record<string, string>[]) {
  const sheet = wb.worksheets[0]!;
  const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  rows.forEach((values, i) => {
    const row = sheet.getRow(3 + i);
    for (const [key, value] of Object.entries(values)) row.getCell(keys.indexOf(key) + 1).value = value;
  });
}

async function importPlan(wb: ExcelJS.Workbook, options: object, auth = s.teacher1) {
  const res = await request(t.app)
    .post("/api/v1/curriculum-plans/import")
    .set(auth)
    .field("options", JSON.stringify({ academicYearId: s.year.id, subjectId: s.math.id, gradeId: s.g7.id, ...options }))
    .attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "reja.xlsx");
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return waitForImport(t, auth, res.body.id, ["PREVIEW_READY", "FAILED"]);
}

async function commitAndGetPlan(jobId: string) {
  await teacher1().post(`/imports/${jobId}/commit`, { skipErrors: false });
  await waitForImport(t, s.teacher1, jobId, ["COMMITTED"]);
  const list = await teacher1().get(`/curriculum-plans?sourceImportId=${jobId}`);
  return teacher1().get(`/curriculum-plans/${list.items[0].id}`);
}

const itemsOf = (plan: {
  items: { topicTitle: string; hours: number; lessonType: string; periodId: string | null }[];
}) => plan.items.map((i) => [i.topicTitle, i.hours, i.lessonType, i.periodId]);

describe("templates and imports", () => {
  it("the ROWS template has one row per lesson of the group, with its date and period", async () => {
    const wb = await template("ROWS");
    const sheet = wb.worksheets[0]!;
    const lessons = await t.deps.root.lessonSession.count({
      where: { teachingGroupId: s.c7a.classTeachingGroupId, status: { not: "CANCELLED" } },
    });
    const keys = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    expect(sheet.getRow(1).hidden).toBe(true);
    expect(sheet.getRow(3).getCell(keys.indexOf("lessonDate") + 1).value).toBe("2026-09-03");
    expect(sheet.getRow(3).getCell(keys.indexOf("periodName") + 1).value).toBe("1-chorak");
    expect(sheet.getRow(2 + lessons).getCell(keys.indexOf("lessonNo") + 1).value).toBe(String(lessons));
    expect(wb.worksheets[1]!.getCell(1, 1).value).toContain("Ma'lumotlar");
  });

  it("acceptance 8: ROWS and TOPICS imports create the same plan items", async () => {
    const rowsWb = await template("ROWS");
    fill(rowsWb, [{ topic: "Kasrlar" }, { topic: "kasrlar" }, { topic: "Nazorat ishi", lessonType: "Nazorat ishi" }]);
    const rowsJob = await importPlan(rowsWb, { mode: "ROWS", teachingGroupId: s.c7a.classTeachingGroupId });
    expect(rowsJob.status).toBe("PREVIEW_READY");
    expect(rowsJob.summary).toMatchObject({ errors: 0, hours: 3 });
    expect(rowsJob.summary.lessons).toBeGreaterThan(50);
    const fromRows = await commitAndGetPlan(rowsJob.id);

    const topicsWb = await template("TOPICS");
    fill(topicsWb, [
      { periodName: "1-chorak", topic: "Kasrlar", hours: "2" },
      { periodName: "1-chorak", topic: "Nazorat ishi", hours: "1", lessonType: "CONTROL_WORK" },
    ]);
    const topicsJob = await importPlan(topicsWb, { mode: "TOPICS" });
    const fromTopics = await commitAndGetPlan(topicsJob.id);

    expect(itemsOf(fromRows)).toEqual(itemsOf(fromTopics));
    expect(fromRows.items.map((i: { topicId: string }) => i.topicId)).toEqual(
      fromTopics.items.map((i: { topicId: string }) => i.topicId),
    );
    expect(fromRows).toMatchObject({ status: "DRAFT", version: 1 });
  });

  it("acceptance 9: an empty topic is an error; the preview shows the rest; nothing is saved", async () => {
    const wb = await template("TOPICS");
    fill(wb, [
      { topic: "Kirish", hours: "1" },
      { topic: "", hours: "1", homework: "1-mashq" },
      { topic: "Yakun", hours: "1" },
    ]);
    const job = await importPlan(wb, { mode: "TOPICS" });
    expect(job.summary).toMatchObject({ total: 3, ok: 2, errors: 1 });
    const rows = await teacher1().get(`/imports/${job.id}/rows?pageSize=10`);
    expect(rows.items.map((r: { status: string }) => r.status)).toEqual(["OK", "ERROR", "OK"]);
    const commit = await teacher1().raw("post", `/imports/${job.id}/commit`, { skipErrors: true });
    expect(commit.body.error.details.reason).toBe("IMPORT_HAS_ERRORS");
    expect((await teacher1().get(`/curriculum-plans?sourceImportId=${job.id}`)).total).toBe(0);
  });

  it("teachers reach only their own plan imports; not other subjects", async () => {
    const wb = await template("TOPICS");
    fill(wb, [{ topic: "A", hours: "1" }]);
    const job = await importPlan(wb, { mode: "TOPICS" });
    expect((await api(t, s.teacher2).raw("get", `/imports/${job.id}`)).status).toBe(404);
    expect((await api(t, s.teacher2).raw("get", "/imports")).status).toBe(403);
    const english = await request(t.app)
      .post("/api/v1/curriculum-plans/import")
      .set(s.teacher1)
      .field(
        "options",
        JSON.stringify({ academicYearId: s.year.id, subjectId: s.english.id, gradeId: s.g7.id, mode: "TOPICS" }),
      )
      .attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "reja.xlsx");
    expect(english.status).toBe(403);
  });
});

describe("applying plans to groups", () => {
  let plan: { id: string; lineageId: string; items: { id: string; topicId: string }[] };

  it("acceptance 10 + 11: one template on 7-A and 7-B — own dates, same topics; only own groups for a teacher", async () => {
    const draft = await teacher1().post("/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "Matematika 7",
      items: Array.from({ length: 20 }, (_, i) => ({ topicTitle: `Mavzu ${i + 1}`, hours: i === 0 ? 2 : 1 })),
    });
    await teacher1().post(`/curriculum-plans/${draft.id}/submit`);
    plan = await s.a.post(`/curriculum-plans/${draft.id}/approve`);

    const [own] = await teacher1().post(`/curriculum-plans/${plan.id}/assignments`, {
      teachingGroupIds: [s.c7a.classTeachingGroupId],
    });
    expect(own).toMatchObject({ teachingGroupName: "7-A", plannedHours: 21, placed: 21, warnings: [] });
    const other = await teacher1().raw("post", `/curriculum-plans/${plan.id}/assignments`, {
      teachingGroupIds: [s.c7b.classTeachingGroupId],
    });
    expect(other.status).toBe(403);
    await s.a.post(`/curriculum-plans/${plan.id}/assignments`, { teachingGroupIds: [s.c7b.classTeachingGroupId] });

    const firstLessons = (groupId: string) =>
      t.deps.root.lessonSession.findMany({
        where: { teachingGroupId: groupId, status: { not: "CANCELLED" } },
        orderBy: { sequenceNo: "asc" },
        take: 3,
        select: { date: true, planItem: { select: { topicId: true } } },
      });
    const a = await firstLessons(s.c7a.classTeachingGroupId);
    const b = await firstLessons(s.c7b.classTeachingGroupId);
    expect(a.map((l) => l.planItem?.topicId)).toEqual(b.map((l) => l.planItem?.topicId));
    expect(a.map((l) => l.planItem?.topicId)).toEqual([
      plan.items[0]!.topicId,
      plan.items[0]!.topicId,
      plan.items[1]!.topicId,
    ]);
    expect(a.map((l) => l.date.getTime())).not.toEqual(b.map((l) => l.date.getTime()));
    // Grade 4 groups do not take a grade 7 plan.
    const wrongGrade = await s.a.raw("post", `/curriculum-plans/${plan.id}/assignments`, {
      teachingGroupIds: [s.c4a.classTeachingGroupId],
    });
    expect(wrongGrade.body.error.details.fields[0].code).toBe("group_grade_mismatch");
  });

  it("acceptance 6 (database): more hours than free lessons → a warning for what does not fit", async () => {
    // 7-B's past lessons already carry the shared plan's topics and keep them (T-38): only future lessons are free.
    const where = { teachingGroupId: s.c7b.classTeachingGroupId, status: { not: "CANCELLED" as const } };
    const lessons = await t.deps.root.lessonSession.count({ where });
    const future = await t.deps.root.lessonSession.count({ where: { ...where, date: { gt: schoolDateToDb(today) } } });
    const big = await s.a.post("/curriculum-plans", {
      academicYearId: s.year.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "Katta",
      items: Array.from({ length: lessons + 1 }, (_, i) => ({ topicTitle: `Katta ${i + 1}`, hours: 1 })),
    });
    await s.a.post(`/curriculum-plans/${big.id}/submit`);
    await s.a.post(`/curriculum-plans/${big.id}/approve`);
    const [result] = await s.a.post(`/curriculum-plans/${big.id}/assignments`, {
      teachingGroupIds: [s.c7b.classTeachingGroupId],
    });
    expect(result.freeLessons).toBe(0);
    expect(result.warnings).toHaveLength(lessons + 1 - future);
    expect(result.warnings.every((w: { kind: string }) => w.kind === "NOT_PLACED")).toBe(true);
    expect(result.warnings.at(-1).topicTitle).toBe(`Katta ${lessons + 1}`);
    // Back to the shared plan for 7-B.
    await s.a.post(`/curriculum-plans/${plan.id}/assignments`, { teachingGroupIds: [s.c7b.classTeachingGroupId] });
  });

  it("acceptance 12: lessons follow a new version only once it is approved", async () => {
    const topicOfNextLesson = async () =>
      (
        await t.deps.root.lessonSession.findFirst({
          // after today in school time: today's lesson is already fixed (T-38)
          where: {
            teachingGroupId: s.c7a.classTeachingGroupId,
            date: { gt: schoolDateToDb(today) },
            status: "SCHEDULED",
          },
          orderBy: { sequenceNo: "asc" },
          select: { planItem: { select: { planId: true, topic: { select: { title: true } } } } },
        })
      )?.planItem;
    const before = await topicOfNextLesson();
    expect(before?.planId).toBe(plan.id);

    const v2 = await teacher1().post(`/curriculum-plans/${plan.id}/new-version`);
    await teacher1().put(`/curriculum-plans/${v2.id}`, {
      items: [
        { topicTitle: "Yangi kirish", hours: 1 },
        ...v2.items.map((i: { topicTitle: string; hours: number }) => ({ topicTitle: i.topicTitle, hours: i.hours })),
      ],
    });
    await teacher1().post(`/curriculum-plans/${v2.id}/submit`);
    expect(await topicOfNextLesson()).toEqual(before);

    await s.a.post(`/curriculum-plans/${v2.id}/approve`);
    const after = await topicOfNextLesson();
    expect(after?.planId).toBe(v2.id);
    const assignments = await teacher1().get(`/curriculum-plans/${v2.id}/assignments`);
    expect(assignments.map((a: { teachingGroupName: string }) => a.teachingGroupName).sort()).toEqual(["7-A", "7-B"]);
    expect(await teacher1().get(`/curriculum-plans/${plan.id}/assignments`)).toEqual([]);
  });
});
