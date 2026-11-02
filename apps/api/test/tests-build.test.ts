// M4 step 3: building, publishing and scheduling tests (tests.md §4.1, §5, §6, §7) — acceptance 9 (a test keeps the
// version it was published with) and 14 (no weighted test on a closed period).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let regular: string;
let q1: { id: string };
let loops: { id: string };
const questions: { id: string; current: { options: unknown[] } }[] = [];

const teacher1 = () => api(t, s.teacher1);
const hour = 3_600_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const base = () => ({
  title: "Sikllar testi",
  subjectId: s.math.id,
  gradeId: s.g7.id,
  testTypeId: regular,
  format: "ONLINE",
  purpose: "PRACTICE",
  assignTo: { teachingGroupIds: [s.c7a.classTeachingGroupId] },
});

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  regular = (await teacher1().get("/test-types")).find((x: { code: string }) => x.code === "REGULAR").id;
  q1 = await s.a.post(`/academic-years/${s.year.id}/periods`, {
    type: "QUARTER",
    name: "1-chorak",
    order: 1,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  });
  await s.a.post(`/periods/${q1.id}/activate`);
  loops = await t.deps.root.topic.create({
    data: {
      tenantId: t.defaultTenant.tenant.id,
      subjectId: s.math.id,
      gradeId: s.g7.id,
      title: "Sikllar",
      normalizedTitle: "sikllar",
    },
  });
  for (const [i, difficulty] of (["EASY", "EASY", "MEDIUM", "HARD"] as const).entries())
    questions.push(
      await teacher1().post("/question-bank/questions", {
        type: "SINGLE",
        text: `Savol ${i + 1}?`,
        subjectId: s.math.id,
        gradeId: s.g7.id,
        topicId: i < 3 ? loops.id : null,
        difficulty,
        points: i + 1,
        options: [
          { id: "a", text: "1", isCorrect: true },
          { id: "b", text: "2", isCorrect: false },
        ],
      }),
    );
}, 180_000);
afterAll(() => t.close());

describe("building and publishing", () => {
  it("a DRAFT is checked; publishing freezes versions and sums the points", async () => {
    const draft = await teacher1().post("/tests", base());
    expect(draft).toMatchObject({ status: "DRAFT", questionsTotal: 0 });
    expect((await teacher1().get(`/tests/${draft.id}/problems`)).problems).toEqual(["NO_QUESTIONS"]);
    await teacher1().put(`/tests/${draft.id}/questions`, {
      questions: [{ questionId: questions[0]!.id }, { questionId: questions[1]!.id, points: 5 }],
    });
    // Edited before publishing: the test takes the new version (and its points, unless set by hand).
    await teacher1().patch(`/question-bank/questions/${questions[0]!.id}`, {
      content: { text: "Savol 1 (yangi)?", points: 3, options: questions[0]!.current.options },
    });
    const published = await teacher1().post(`/tests/${draft.id}/publish`);
    expect(published).toMatchObject({ status: "OPEN", maxScore: "8" });
    expect(
      published.questions.map((q: { version: { text: string }; points: string }) => [q.version.text, q.points]),
    ).toEqual([
      ["Savol 1 (yangi)?", "3"],
      ["Savol 2?", "5"],
    ]);

    // Acceptance 9: an edit after publishing does not reach the test.
    await teacher1().patch(`/question-bank/questions/${questions[1]!.id}`, {
      content: { text: "Savol 2 (keyin)?", points: 2, options: questions[1]!.current.options },
    });
    const after = await teacher1().get(`/tests/${draft.id}`);
    expect(after.questions[1]).toMatchObject({ version: { text: "Savol 2?" }, newerVersion: true });

    // Published: questions and most fields are locked; the title is not.
    expect((await teacher1().raw("put", `/tests/${draft.id}/questions`, { questions: [] })).status).toBe(409);
    expect((await teacher1().raw("patch", `/tests/${draft.id}`, { questionCount: 1 })).status).toBe(409);
    expect((await teacher1().patch(`/tests/${draft.id}`, { title: "Yangi nom" })).title).toBe("Yangi nom");
    expect((await teacher1().raw("delete", `/tests/${draft.id}`)).status).toBe(409);
    await teacher1().post(`/tests/${draft.id}/close`);
    expect((await teacher1().raw("delete", `/tests/${draft.id}`)).status).toBe(204);
    expect((await teacher1().get(`/tests?pageSize=100`)).items.map((x: { id: string }) => x.id)).not.toContain(
      draft.id,
    );
  });

  it("a teacher gives tests only to their own groups; others do not see the test", async () => {
    const other = await teacher1().raw("post", "/tests", {
      ...base(),
      assignTo: { teachingGroupIds: [s.c7b.classTeachingGroupId] },
    });
    expect(other.status).toBe(400);
    // 7-A is the teacher's, but not of grade 4.
    expect((await teacher1().raw("post", "/tests", { ...base(), gradeId: s.g4.id })).status).toBe(400);
    const mine = await teacher1().post("/tests", base());
    expect((await api(t, s.teacher2).raw("get", `/tests/${mine.id}`)).status).toBe(404);
    expect((await api(t, s.guardian).raw("get", "/tests")).status).toBe(403);
    expect((await s.a.get(`/tests/${mine.id}`)).id).toBe(mine.id); // school-wide
    await teacher1().raw("delete", `/tests/${mine.id}`);
  });

  it("the window: SCHEDULED until it starts, CLOSED after it ends — also without the delayed job", async () => {
    const test = await teacher1().post("/tests", { ...base(), startsAt: at(hour), endsAt: at(2 * hour) });
    await teacher1().put(`/tests/${test.id}/questions`, { questions: [{ questionId: questions[2]!.id }] });
    expect((await teacher1().post(`/tests/${test.id}/publish`)).status).toBe("SCHEDULED");
    const jobs = await t.deps.root.outboxEvent.findMany({ where: { aggregateId: test.id, type: "test.status_due" } });
    expect(jobs.map((j) => j.availableAt.getTime() > Date.now())).toEqual([true, true]);

    const { root } = t.deps;
    await root.test.update({ where: { id: test.id }, data: { startsAt: new Date(Date.now() - hour) } });
    expect((await teacher1().get(`/tests/${test.id}`)).status).toBe("OPEN");
    await root.test.update({ where: { id: test.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await teacher1().get(`/tests/${test.id}`)).status).toBe("CLOSED");
    expect((await teacher1().raw("patch", `/tests/${test.id}`, { endsAt: at(hour) })).status).toBe(409);
  });

  it("an end in the past or before the start is refused", async () => {
    const backwards = await teacher1().raw("post", "/tests", { ...base(), startsAt: at(2 * hour), endsAt: at(hour) });
    expect(backwards.status).toBe(400);
    const past = await teacher1().post("/tests", { ...base(), endsAt: at(-hour) });
    await teacher1().put(`/tests/${past.id}/questions`, { questions: [{ questionId: questions[2]!.id }] });
    expect((await teacher1().get(`/tests/${past.id}/problems`)).problems).toEqual(["WINDOW_IN_PAST"]);
    expect((await teacher1().raw("post", `/tests/${past.id}/publish`)).status).toBe(400);
  });

  it("pool rules: an unfillable rule blocks publishing; the frozen set is every matching question", async () => {
    const test = await teacher1().post("/tests", {
      ...base(),
      selection: { mode: "POOL", rules: [{ topicId: loops.id, difficulty: null, count: 5 }] },
    });
    expect((await teacher1().get(`/tests/${test.id}/problems`)).problems).toEqual(["POOL_RULE_UNFILLABLE"]);
    await teacher1().patch(`/tests/${test.id}`, {
      selection: {
        mode: "POOL",
        rules: [
          { topicId: loops.id, difficulty: "EASY", count: 1 },
          { topicId: null, difficulty: "HARD", count: 1 },
        ],
      },
    });
    const published = await teacher1().post(`/tests/${test.id}/publish`);
    expect(published.questions).toHaveLength(3); // two EASY loops + one HARD
  });

  it("too many questions per attempt against the school limit (Q-36)", async () => {
    await s.a.put("/settings/school", { maxQuestionsPerTest: 1 });
    const test = await teacher1().post("/tests", base());
    await teacher1().put(`/tests/${test.id}/questions`, {
      questions: [{ questionId: questions[2]!.id }, { questionId: questions[3]!.id }],
    });
    expect((await teacher1().get(`/tests/${test.id}/problems`)).problems).toEqual(["TOO_MANY_QUESTIONS"]);
    await teacher1().patch(`/tests/${test.id}`, { questionCount: 1 });
    expect((await teacher1().get(`/tests/${test.id}/problems`)).problems).toEqual([]);
    await s.a.put("/settings/school", { maxQuestionsPerTest: 50 });
  });
});

describe("weighted and offline tests (§6, §7)", () => {
  it("acceptance 14: a weighted test cannot be attached to a CLOSED period", async () => {
    const closed = await s.a.post(`/academic-years/${s.year.id}/periods`, {
      type: "QUARTER",
      name: "Yopiq chorak",
      order: 2,
      startDate: "2027-01-01",
      endDate: "2027-03-20",
    });
    await t.deps.root.academicPeriod.update({ where: { id: closed.id }, data: { status: "CLOSED" } });
    const res = await teacher1().raw("post", "/tests", {
      ...base(),
      purpose: "WEIGHTED",
      periodId: closed.id,
      weight: 2,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe("PERIOD_CLOSED");
    expect((await teacher1().raw("post", "/tests", { ...base(), purpose: "WEIGHTED" })).status).toBe(400);
    const ok = await teacher1().post("/tests", { ...base(), purpose: "WEIGHTED", periodId: q1.id, weight: 2 });
    expect(ok).toMatchObject({ purpose: "WEIGHTED", weight: "2", periodName: "1-chorak" });
    // The period closes after the test was created: publishing is refused.
    await teacher1().put(`/tests/${ok.id}/questions`, { questions: [{ questionId: questions[2]!.id }] });
    await t.deps.root.academicPeriod.update({ where: { id: q1.id }, data: { status: "CLOSED" } });
    expect((await teacher1().get(`/tests/${ok.id}/problems`)).problems).toEqual(["PERIOD_CLOSED"]);
    await t.deps.root.academicPeriod.update({ where: { id: q1.id }, data: { status: "ACTIVE" } });
  });

  it("offline: the scale is one of the allowed ones; the day is required; publishing opens it", async () => {
    expect((await teacher1().raw("post", "/tests", { ...base(), format: "OFFLINE", maxScore: "30" })).status).toBe(400);
    const test = await teacher1().post("/tests", { ...base(), format: "OFFLINE", maxScore: "20" });
    expect((await teacher1().get(`/tests/${test.id}/problems`)).problems).toEqual(["OFFLINE_NEEDS_DATE"]);
    await teacher1().patch(`/tests/${test.id}`, { schoolDate: "2026-11-10" });
    expect(await teacher1().post(`/tests/${test.id}/publish`)).toMatchObject({
      status: "OPEN",
      maxScore: "20",
      schoolDate: "2026-11-10",
    });
    expect((await teacher1().raw("put", `/tests/${test.id}/questions`, { questions: [] })).status).toBe(409);
  });
});
