// M4 step 6: statistics (tests.md §8) — per test, per question, per topic, a student's history and the export.
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let test: { id: string };
let s7a2: { id: string };
let s7a3: { id: string };
const auths: Record<string, Record<string, string>> = {};
const topics: Record<string, string> = {};

const teacher1 = () => api(t, s.teacher1);
const as = (auth: Record<string, string>) => api(t, auth);

/** Answers "2+2?" (loops), "3+3?" (loops), "Massiv?" (arrays) right or wrong, then submits. */
async function take(studentId: string, right: [boolean, boolean, boolean]) {
  const v = await as(auths[studentId]!).post(`/tests/${test.id}/start`);
  const texts = ["2+2?", "3+3?", "Massiv?"];
  for (const [i, text] of texts.entries()) {
    const q = v.questions.find((x: { text: string }) => x.text === text);
    const option = q.options.find((o: { text: string }) => (o.text === "to'g'ri") === right[i]);
    await as(auths[studentId]!).put(`/attempts/${v.id}/answers/${q.testQuestionId}`, {
      answer: { optionIds: [option.id] },
      clientSeq: 1,
    });
  }
  return as(auths[studentId]!).post(`/attempts/${v.id}/submit`);
}

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  const slug = t.defaultTenant.tenant.slug;
  const add = (lastName: string) =>
    s.a.post("/students", {
      firstName: "Demo",
      lastName,
      enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
    });
  s7a2 = await add("Oquvchi A2");
  s7a3 = await add("Oquvchi A3");
  for (const id of [s.s7a.id, s7a2.id, s7a3.id]) auths[id] = await studentAuth(t, s, id, slug);
  for (const title of ["Sikllar", "Massivlar"])
    topics[title] = (
      await t.deps.root.topic.create({
        data: {
          tenantId: t.defaultTenant.tenant.id,
          subjectId: s.math.id,
          gradeId: s.g7.id,
          title,
          normalizedTitle: title.toLowerCase(),
        },
      })
    ).id;
  const question = (text: string, topic: string) =>
    teacher1().post("/question-bank/questions", {
      type: "SINGLE",
      text,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      topicId: topics[topic],
      options: [
        { id: "a", text: "to'g'ri", isCorrect: true },
        { id: "b", text: "xato", isCorrect: false },
      ],
    });
  const qs = [
    await question("2+2?", "Sikllar"),
    await question("3+3?", "Sikllar"),
    await question("Massiv?", "Massivlar"),
  ];
  const regular = (await teacher1().get("/test-types")).find((x: { code: string }) => x.code === "REGULAR").id;
  test = await teacher1().post("/tests", {
    title: "Statistika testi",
    subjectId: s.math.id,
    gradeId: s.g7.id,
    testTypeId: regular,
    format: "ONLINE",
    purpose: "PRACTICE",
    showResultToStudent: "AFTER_CLOSE",
    assignTo: { teachingGroupIds: [s.c7a.classTeachingGroupId] },
  });
  await teacher1().put(`/tests/${test.id}/questions`, {
    questions: qs.map((q: { id: string }) => ({ questionId: q.id })),
  });
  await teacher1().post(`/tests/${test.id}/publish`);
  await take(s.s7a.id, [true, true, true]); // 100
  await take(s7a2.id, [true, false, false]); // 33.33
  await take(s7a3.id, [false, false, true]); // 33.33
}, 240_000);
afterAll(() => t.close());

describe("statistics (§8)", () => {
  it("per test: participants, mean, median, distribution, finish reasons, groups", async () => {
    const stats = await teacher1().get(`/tests/${test.id}/stats`);
    expect(stats).toMatchObject({ assigned: 3, participants: 3, finishReasons: { SUBMITTED: 3 } });
    expect(Number(stats.summary.mean)).toBeCloseTo(55.555, 2);
    expect(Number(stats.summary.median)).toBeCloseTo(33.333, 2);
    expect(stats.summary.histogram[3]).toBe(2);
    expect(stats.summary.histogram[9]).toBe(1);
    expect(stats.groups).toHaveLength(1);
    expect(stats.students.map((x: { attempts: number }) => x.attempts)).toEqual([1, 1, 1]);
    expect((await api(t, s.teacher2).raw("get", `/tests/${test.id}/stats`)).status).toBe(404);
    expect((await as(auths[s.s7a.id]!).raw("get", `/tests/${test.id}/stats`)).status).toBe(403);
  });

  it("per question: correct share and option choices", async () => {
    const qs = await teacher1().get(`/tests/${test.id}/questions-stats`);
    const byText = (text: string) => qs.find((q: { text: string }) => q.text === text);
    expect(Number(byText("2+2?").correctPercent)).toBeCloseTo(66.67, 2);
    expect(byText("3+3?").options.map((o: { text: string; share: string }) => [o.text, Number(o.share)])).toEqual([
      ["to'g'ri", 33.33],
      ["xato", 66.67],
    ]);
  });

  it("topic mastery: a student's topics and a group's hardest topics", async () => {
    const mine = await teacher1().get(`/students/${s7a2.id}/topic-mastery?subjectId=${s.math.id}`);
    expect(mine.map((m: { topicTitle: string; percent: string }) => [m.topicTitle, m.percent])).toEqual([
      ["Massivlar", "0"],
      ["Sikllar", "50"],
    ]);
    const group = await teacher1().get(
      `/topic-mastery?teachingGroupId=${s.c7a.classTeachingGroupId}&subjectId=${s.math.id}`,
    );
    // Sikllar: 3 right of 6; Massivlar: 2 of 3.
    expect(group.map((m: { topicTitle: string; percent: string }) => [m.topicTitle, Number(m.percent)])).toEqual([
      ["Sikllar", 50],
      ["Massivlar", 66.67],
    ]);
    // A student sees their own; a guardian only their own child.
    expect((await as(auths[s.s7a.id]!).get(`/students/${s.s7a.id}/topic-mastery`))[0].percent).toBe("100");
    expect((await as(auths[s.s7a.id]!).raw("get", `/students/${s7a2.id}/topic-mastery`)).status).toBe(404);
    expect((await api(t, s.guardian).raw("get", `/students/${s.s7a.id}/topic-mastery`)).status).toBe(404);
  });

  it("history: the student sees the result only after the window (AFTER_CLOSE); the teacher always", async () => {
    const own = await as(auths[s7a2.id]!).get(`/students/${s7a2.id}/test-history`);
    expect(own[0]).toMatchObject({ testId: test.id, status: "DONE", percent: null });
    expect(Number((await teacher1().get(`/students/${s7a2.id}/test-history`))[0].percent)).toBeCloseTo(33.33, 2);
    await teacher1().post(`/tests/${test.id}/close`);
    expect(Number((await as(auths[s7a2.id]!).get(`/students/${s7a2.id}/test-history`))[0].percent)).toBeCloseTo(
      33.33,
      2,
    );
  });

  it("export: results and questions sheets", async () => {
    const res = await request(t.app)
      .get(`/api/v1/tests/${test.id}/results/export?locale=ru`)
      .set(s.teacher1)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Результаты", "Вопросы"]);
    expect(wb.worksheets[0]!.rowCount).toBe(4);
    expect(wb.worksheets[0]!.getRow(2).getCell(6).value).toBe("Сдал");
    expect((await as(auths[s.s7a.id]!).raw("get", `/tests/${test.id}/results/export`)).status).toBe(403);
  });
});
