// M4 step 4: taking a test (tests.md §4.2–§4.5, §5; security-baseline.md S4–S5) — acceptance 1–8, 15, 17, 18.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { api, buildSchool, studentAuth } from "./support/school";

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof buildSchool>>;
let regular: string;
let studentA: Record<string, string>; // 7-A
let studentA2: Record<string, string>; // 7-A, a second student
let studentB: Record<string, string>; // 7-B
let s7a2: { id: string };
const qids: string[] = [];

const teacher1 = () => api(t, s.teacher1);
const as = (auth: Record<string, string>) => api(t, auth);
const minute = 60_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A published test for 7-A with the six questions, shuffled. */
async function publishedTest(extra: Record<string, unknown> = {}) {
  const test = await teacher1().post("/tests", {
    title: `Test ${randomUUID().slice(0, 6)}`,
    subjectId: s.math.id,
    gradeId: s.g7.id,
    testTypeId: regular,
    format: "ONLINE",
    purpose: "PRACTICE",
    showResultToStudent: "IMMEDIATE",
    timeLimitMinutes: 30,
    assignTo: { teachingGroupIds: [s.c7a.classTeachingGroupId] },
    ...extra,
  });
  await teacher1().put(`/tests/${test.id}/questions`, { questions: qids.map((questionId) => ({ questionId })) });
  return teacher1().post(`/tests/${test.id}/publish`);
}

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  s = await buildSchool(t, t.defaultTenant);
  const slug = t.defaultTenant.tenant.slug;
  s7a2 = await s.a.post("/students", {
    firstName: "Demo",
    lastName: "Oquvchi A2",
    enrollment: { classGroupId: s.c7a.id, validFrom: "2026-09-01" },
  });
  studentA = await studentAuth(t, s, s.s7a.id, slug);
  studentA2 = await studentAuth(t, s, s7a2.id, slug);
  studentB = await studentAuth(t, s, s.s7b.id, slug);
  regular = (await teacher1().get("/test-types")).find((x: { code: string }) => x.code === "REGULAR").id;
  const common = { subjectId: s.math.id, gradeId: s.g7.id };
  const created = [
    await teacher1().post("/question-bank/questions", {
      ...common,
      type: "SINGLE",
      text: "2+2?",
      options: ["3", "4", "5", "6"].map((text, i) => ({ id: `o${i}`, text, isCorrect: text === "4" })),
    }),
    await teacher1().post("/question-bank/questions", {
      ...common,
      type: "MULTIPLE",
      text: "Juft sonlar?",
      points: 3,
      options: ["2", "3", "4", "5"].map((text, i) => ({ id: `o${i}`, text, isCorrect: Number(text) % 2 === 0 })),
    }),
    await teacher1().post("/question-bank/questions", {
      ...common,
      type: "SHORT_TEXT",
      text: "Poytaxt?",
      acceptedAnswers: ["Toshkent"],
    }),
    await teacher1().post("/question-bank/questions", {
      ...common,
      type: "MATCHING",
      text: "Moslang",
      points: 2,
      pairs: [
        { leftId: "l1", left: "2+2", rightId: "r1", right: "4" },
        { leftId: "l2", left: "3+3", rightId: "r2", right: "6" },
      ],
    }),
    ...(await Promise.all(
      [5, 6].map((n) =>
        teacher1().post("/question-bank/questions", {
          ...common,
          type: "SINGLE",
          text: `${n}-savol?`,
          options: [
            { id: "a", text: "ha", isCorrect: true },
            { id: "b", text: "yo'q", isCorrect: false },
          ],
        }),
      ),
    )),
  ];
  qids.push(...created.map((q: { id: string }) => q.id));
}, 240_000);
afterAll(() => t.close());

const FORBIDDEN = /^(isCorrect|correct.*|accepted.*|pairs)$/i;
/** Every key in a JSON tree, with its path (answers are the student's own and checked separately). */
function keysOf(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keysOf(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [`${path}.${k}`, ...keysOf(v, `${path}.${k}`)]);
  return [];
}

describe("starting and resuming (§4.2)", () => {
  it("acceptance 1: no answer key anywhere in what the student receives", async () => {
    const test = await publishedTest();
    const view = await as(studentA).post(`/tests/${test.id}/start`);
    const leaks = keysOf({ ...view, answers: undefined }).filter((p) => FORBIDDEN.test(p.split(".").pop()!));
    expect(leaks).toEqual([]);
    expect(view.questions).toHaveLength(6);
    const matching = view.questions.find((q: { type: string }) => q.type === "MATCHING");
    expect(Object.keys(matching).sort()).toEqual([
      "imageAssetId",
      "leftItems",
      "points",
      "rightItems",
      "testQuestionId",
      "text",
      "type",
    ]);
    const list = await as(studentA).get("/me/tests");
    expect(keysOf(list).filter((p) => FORBIDDEN.test(p.split(".").pop()!))).toEqual([]);
  });

  it("acceptance 2 and 3: a reload keeps order, options, position and answers; two students get different orders", async () => {
    const test = await publishedTest();
    const first = await as(studentA).post(`/tests/${test.id}/start`);
    const q = first.questions[0];
    const answer =
      q.type === "SHORT_TEXT"
        ? { text: "x" }
        : q.type === "MATCHING"
          ? { pairs: [{ leftId: q.leftItems[0].id, rightId: q.rightItems[0].id }] }
          : { optionIds: [q.options[0].id] };
    await as(studentA).put(`/attempts/${first.id}/answers/${q.testQuestionId}`, {
      answer,
      clientSeq: 1,
      currentIndex: 3,
    });
    const again = await as(studentA).post(`/tests/${test.id}/start`); // idempotent: the same attempt
    const reloaded = await as(studentA).get(`/attempts/${first.id}`);
    for (const v of [again, reloaded]) {
      expect(v.id).toBe(first.id);
      expect(v.questions).toEqual(first.questions);
      expect(v.currentIndex).toBe(3);
      expect(v.answers[q.testQuestionId]).toEqual({ answer, clientSeq: 1 });
    }
    const other = await as(studentA2).post(`/tests/${test.id}/start`);
    const orderOf = (v: { questions: { testQuestionId: string }[] }) => v.questions.map((x) => x.testQuestionId);
    expect(orderOf(other)).not.toEqual(orderOf(first));
    expect([...orderOf(other)].sort()).toEqual([...orderOf(first)].sort());
  });

  it("acceptance 15: not assigned → 403; outside the window → 409; one attempt in the common window", async () => {
    const test = await publishedTest();
    expect((await as(studentB).raw("post", `/tests/${test.id}/start`)).status).toBe(403);
    const later = await publishedTest({ startsAt: at(60 * minute), endsAt: at(120 * minute) });
    const early = await as(studentA).raw("post", `/tests/${later.id}/start`);
    expect(early.status).toBe(409);
    expect(early.body.error.details.reason).toBe("TEST_NOT_OPEN");
    const view = await as(studentA2).post(`/tests/${test.id}/start`);
    await as(studentA2).post(`/attempts/${view.id}/submit`);
    expect((await as(studentA2).raw("post", `/tests/${test.id}/start`)).body.error.details.reason).toBe(
      "ALREADY_TAKEN",
    );
    // A student never reaches another student's attempt; teachers have no student endpoints.
    expect((await as(studentA).raw("get", `/attempts/${view.id}`)).status).toBe(404);
    expect((await teacher1().raw("get", `/attempts/${view.id}`)).status).toBe(403);
  });
});

describe("answering (§4.3, S5)", () => {
  it("acceptance 8 and 17: an older clientSeq loses; foreign questions and options are a 400", async () => {
    const test = await publishedTest();
    const view = await as(studentA2).post(`/tests/${test.id}/start`);
    const single = view.questions.find((q: { type: string; text: string }) => q.type === "SINGLE" && q.text === "2+2?");
    const put = (body: unknown, tq = single.testQuestionId) =>
      as(studentA2).raw("put", `/attempts/${view.id}/answers/${tq}`, body);
    expect((await put({ answer: { optionIds: [single.options[1].id] }, clientSeq: 5 })).body).toEqual({
      saved: true,
      clientSeq: 5,
    });
    expect((await put({ answer: { optionIds: [single.options[2].id] }, clientSeq: 4 })).body).toEqual({
      saved: false,
      clientSeq: 5,
    });
    expect((await as(studentA2).get(`/attempts/${view.id}`)).answers[single.testQuestionId].answer).toEqual({
      optionIds: [single.options[1].id],
    });
    // Another attempt's question, an option of another question, two options on SINGLE, a malformed body.
    const otherTest = await publishedTest();
    const otherView = await as(studentA).post(`/tests/${otherTest.id}/start`);
    expect((await put({ answer: { optionIds: [] }, clientSeq: 9 }, otherView.questions[0].testQuestionId)).status).toBe(
      400,
    );
    // "a" is an option of "5-savol?", not of "2+2?" (whose options are o0–o3).
    expect((await put({ answer: { optionIds: ["a"] }, clientSeq: 9 })).status).toBe(400);
    expect(
      (await put({ answer: { optionIds: single.options.slice(0, 2).map((o: { id: string }) => o.id) }, clientSeq: 9 }))
        .status,
    ).toBe(400);
    expect((await put({ answer: "o1", clientSeq: 9 })).status).toBe(400);
    expect((await put({ answer: { optionIds: [single.options[1].id] } })).status).toBe(400);
  });

  it("grading on submit: SINGLE, MULTIPLE (all or nothing), SHORT_TEXT, MATCHING", async () => {
    const test = await publishedTest();
    const view = await as(studentB).raw("post", `/tests/${test.id}/start`);
    expect(view.status).toBe(403);
    const v = await as(studentA).post(`/tests/${test.id}/start`);
    const byText = (text: string) => v.questions.find((q: { text: string }) => q.text === text);
    const optionId = (q: { options: { id: string; text: string }[] }, text: string) =>
      q.options.find((o) => o.text === text)!.id;
    const save = (q: { testQuestionId: string }, answer: unknown, seq = 1) =>
      as(studentA).put(`/attempts/${v.id}/answers/${q.testQuestionId}`, { answer, clientSeq: seq });
    const two = byText("2+2?");
    await save(two, { optionIds: [optionId(two, "4")] });
    const even = byText("Juft sonlar?");
    await save(even, { optionIds: [optionId(even, "2")] }); // 1 of 2 right: 0 (ALL_OR_NOTHING)
    await save(byText("Poytaxt?"), { text: "  toshkent " });
    const match = byText("Moslang");
    const right = (text: string) => match.rightItems.find((r: { text: string }) => r.text === text).id;
    await save(match, {
      pairs: [
        { leftId: "l1", rightId: right("4") },
        { leftId: "l2", rightId: right("4") },
      ],
    });
    const done = await as(studentA).post(`/attempts/${v.id}/submit`);
    // 1 + 0 + 1 + 1 (half of 2) + 0 + 0 = 3 of 9
    expect(done).toMatchObject({
      status: "FINISHED",
      finishReason: "SUBMITTED",
      result: { score: "3", maxScore: "9" },
    });
    expect(Number(done.result.percent)).toBeCloseTo(33.3333, 3);
    // Finishing twice changes nothing.
    expect((await as(studentA).post(`/attempts/${v.id}/submit`)).result).toEqual(done.result);
    expect(
      (
        await as(studentA).raw("put", `/attempts/${v.id}/answers/${two.testQuestionId}`, {
          answer: { optionIds: [] },
          clientSeq: 2,
        })
      ).status,
    ).toBe(409);
  });
});

describe("deadline (§4.5)", () => {
  async function runningPastDeadline() {
    const test = await publishedTest();
    const v = await as(studentA2).post(`/tests/${test.id}/start`);
    const q = v.questions.find((x: { text: string }) => x.text === "2+2?");
    await as(studentA2).put(`/attempts/${v.id}/answers/${q.testQuestionId}`, {
      answer: { optionIds: [q.options.find((o: { text: string }) => o.text === "4").id] },
      clientSeq: 1,
    });
    await t.deps.root.testAttempt.update({ where: { id: v.id }, data: { deadline: new Date(Date.now() - 1000) } });
    return { v, q };
  }

  it("acceptance 4: an answer after the deadline → 409; the attempt ends TIME_UP with the saved answers graded", async () => {
    const { v, q } = await runningPastDeadline();
    const late = await as(studentA2).raw("put", `/attempts/${v.id}/answers/${q.testQuestionId}`, {
      answer: { optionIds: [] },
      clientSeq: 2,
    });
    expect(late.status).toBe(409);
    const after = await as(studentA2).get(`/attempts/${v.id}`);
    expect(after).toMatchObject({ status: "FINISHED", finishReason: "TIME_UP", result: { score: "1" } });
  });

  it("acceptance 5: without the job, reading the attempt finishes it", async () => {
    const { v } = await runningPastDeadline();
    expect((await t.deps.root.testAttempt.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("IN_PROGRESS");
    expect((await as(studentA2).get(`/attempts/${v.id}`)).finishReason).toBe("TIME_UP");
    const row = await t.deps.root.testAttempt.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.finishedAt!.getTime()).toBeLessThan(Date.now() - 500); // ended at the deadline, not when noticed
  });

  it("acceptance 6: a client-sent SUBMITTED after the deadline is TIME_UP", async () => {
    const { v } = await runningPastDeadline();
    const res = await as(studentA2).post(`/attempts/${v.id}/submit`, { finishReason: "SUBMITTED" });
    expect(res.finishReason).toBe("TIME_UP");
  });

  it("the deadline job finishes it as well; a deadline is never after the window", async () => {
    const test = await publishedTest({ endsAt: at(10 * minute), timeLimitMinutes: 60 });
    const v = await as(studentA2).post(`/tests/${test.id}/start`);
    expect(new Date(v.deadline).getTime()).toBeLessThanOrEqual(new Date(test.endsAt).getTime());
    const job = await t.deps.root.outboxEvent.findFirstOrThrow({
      where: { aggregateId: v.id, type: "attempt.deadline_due" },
    });
    expect(job.availableAt.toISOString()).toBe(v.deadline);
  });
});

describe("anti-cheat (§4.4)", () => {
  it("acceptance 7: one counted violation per 2 s; the third counted one ends the attempt (VIOLATION)", async () => {
    const test = await publishedTest({ violationThreshold: 3 });
    const v = await as(studentA2).post(`/tests/${test.id}/start`);
    const event = (type: string) => as(studentA2).raw("post", `/attempts/${v.id}/events`, { type });
    const burst = [
      await event("VISIBILITY_HIDDEN"),
      await event("VISIBILITY_HIDDEN"),
      await event("VISIBILITY_HIDDEN"),
    ];
    expect(burst.map((r) => r.body.counted)).toEqual([true, false, false]);
    expect(burst[2]!.body).toMatchObject({ violationCount: 1, remaining: 2, finished: false });
    expect((await event("VISIBILITY_VISIBLE")).body.counted).toBe(false);
    // Spread the remaining ones in time (as if 3 s apart) by moving the stored events back.
    const shift = () =>
      t.deps.root.testEvent.updateMany({ where: { attemptId: v.id }, data: { serverTs: new Date(Date.now() - 3000) } });
    await shift();
    expect((await event("BLUR")).body).toMatchObject({ counted: true, violationCount: 2, remaining: 1 });
    await shift();
    expect((await event("VISIBILITY_HIDDEN")).body).toMatchObject({ counted: true, violationCount: 3, finished: true });
    expect((await as(studentA2).get(`/attempts/${v.id}`)).finishReason).toBe("VIOLATION");
    expect((await event("BLUR")).status).toBe(409);
  });
});

describe("results visibility, retakes, reopening (S4, §5)", () => {
  it("acceptance 18: per-question results only after the common window and every retake window close", async () => {
    const test = await publishedTest({ endsAt: at(30 * minute) });
    const v = await as(studentA).post(`/tests/${test.id}/start`);
    const done = await as(studentA).post(`/attempts/${v.id}/submit`);
    expect(done.result).not.toBeNull(); // IMMEDIATE: the score
    expect(done.perQuestion).toBeNull();
    // A retake window for the other student, still open after the common window ends.
    await s.a.post(`/tests/${test.id}/overrides`, {
      studentIds: [s7a2.id],
      startsAt: at(-minute),
      endsAt: at(90 * minute),
      reason: "Kasal edi",
    });
    await t.deps.root.test.update({ where: { id: test.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await as(studentA).get(`/attempts/${v.id}`)).perQuestion).toBeNull();
    await t.deps.root.testWindowOverride.updateMany({
      where: { testId: test.id },
      data: { endsAt: new Date(Date.now() - 500) },
    });
    const visible = await as(studentA).get(`/attempts/${v.id}`);
    expect(Object.values(visible.perQuestion)).toHaveLength(6);
    expect(Object.values(visible.perQuestion).every((x) => typeof x === "boolean")).toBe(true);
  });

  it("AFTER_CLOSE hides the score until the window closes; NEVER always", async () => {
    const test = await publishedTest({ showResultToStudent: "AFTER_CLOSE", endsAt: at(30 * minute) });
    const v = await as(studentA).post(`/tests/${test.id}/start`);
    expect((await as(studentA).post(`/attempts/${v.id}/submit`)).result).toBeNull();
    const never = await publishedTest({ showResultToStudent: "NEVER" });
    const w = await as(studentA).post(`/tests/${never.id}/start`);
    await teacher1().post(`/tests/${never.id}/close`);
    expect(await as(studentA).get(`/attempts/${w.id}`)).toMatchObject({ result: null, perQuestion: null });
  });

  it("a retake window allows a second attempt (with its own time limit); only tests.reopen gives one", async () => {
    const test = await publishedTest();
    const first = await as(studentA).post(`/tests/${test.id}/start`);
    await as(studentA).post(`/attempts/${first.id}/submit`);
    const body = {
      studentIds: [s.s7a.id],
      startsAt: at(-minute),
      endsAt: at(60 * minute),
      timeLimitMinutes: 5,
      reason: "Qayta",
    };
    expect((await teacher1().raw("post", `/tests/${test.id}/overrides`, body)).status).toBe(403); // Q-22
    expect((await s.a.raw("post", `/tests/${test.id}/overrides`, { ...body, studentIds: [s.s7b.id] })).status).toBe(
      400,
    );
    await s.a.post(`/tests/${test.id}/overrides`, body);
    const second = await as(studentA).post(`/tests/${test.id}/start`);
    expect(second.attemptNo).toBe(2);
    expect(new Date(second.deadline).getTime() - new Date(second.startedAt).getTime()).toBe(5 * minute);
    await as(studentA).post(`/attempts/${second.id}/submit`);
    expect((await as(studentA).raw("post", `/tests/${test.id}/start`)).status).toBe(409);
    const list = await as(studentA).get("/me/tests");
    expect(list.find((x: { id: string }) => x.id === test.id)).toMatchObject({ state: "DONE", timeLimitMinutes: 5 });
  });

  it("reopening keeps the answers and sets a new deadline; closing a test ends running attempts (ADMIN_CLOSED)", async () => {
    const test = await publishedTest();
    const v = await as(studentA).post(`/tests/${test.id}/start`);
    const q = v.questions[0];
    const answer = q.options ? { optionIds: [q.options[0].id] } : q.leftItems ? { pairs: [] } : { text: "a" };
    await as(studentA).put(`/attempts/${v.id}/answers/${q.testQuestionId}`, { answer, clientSeq: 1 });
    await as(studentA).post(`/attempts/${v.id}/submit`);
    expect(
      (await teacher1().raw("post", `/attempts/${v.id}/reopen`, { reason: "Texnik xato", minutes: 10 })).status,
    ).toBe(403);
    const reopened = await s.a.post(`/attempts/${v.id}/reopen`, { reason: "Texnik xato", minutes: 10 });
    expect(reopened).toMatchObject({ status: "IN_PROGRESS", score: null });
    const again = await as(studentA).get(`/attempts/${v.id}`);
    expect(again.answers[q.testQuestionId].answer).toEqual(answer);
    const audit = await t.deps.root.auditLog.findFirst({ where: { action: "test_attempt.reopen", entityId: v.id } });
    expect(audit).not.toBeNull();

    const running = await as(studentA2).post(`/tests/${test.id}/start`);
    await teacher1().post(`/tests/${test.id}/close`);
    expect((await as(studentA2).get(`/attempts/${running.id}`)).finishReason).toBe("ADMIN_CLOSED");
    const attempts = await teacher1().get(`/tests/${test.id}/attempts`);
    expect(attempts.map((a: { finishReason: string }) => a.finishReason).sort()).toEqual([
      "ADMIN_CLOSED",
      "ADMIN_CLOSED",
    ]);
  });
});
