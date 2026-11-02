// Attempts (tests.md §4.2–§4.5, §5; security-baseline.md S4–S5). The server owns everything that matters: the question
// and option order (stored at start, from a seed), the deadline, which events count as violations and how an attempt
// ends. The student's DTOs never carry the answer key. Every write on an attempt holds an advisory lock on it, so
// answers, events and finishing never interleave; every access first finishes an attempt whose deadline has passed
// (the delayed job may not have run).
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  AnswerValue,
  AttemptEventSchema,
  AttemptViewDto,
  CreateOverridesSchema,
  ReopenAttemptSchema,
  SaveAnswerSchema,
  StudentTestDto,
  TestAttemptDto,
  TestSelection,
} from "@idrok/shared";
import { sum } from "@idrok/shared/decimal";
import { schoolDateToDb } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import {
  answerProblem,
  attemptDeadline,
  countsAsViolation,
  isPastDeadline,
  resultVisibility,
  seededShuffle,
  selectFromPool,
  violationLimitReached,
  windowState,
  type MatchingPair,
  type QuestionOption,
  type TestEventType,
} from "../../domain/tests";
import { activeOn, resolveScope } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { gradable } from "../question-bank/question-bank.service";
import { refreshTestStatuses, TestsService } from "./tests.service";
import {
  finishAttempt,
  finishIfDue,
  lockAttempt,
  lockStart,
  scheduleDeadlineJob,
  testQuestionInclude,
  type TestQuestionRow,
} from "./attempt-finish";

const conflict = (reason: string) => new AppError("CONFLICT", 409, { reason });
const invalid = (path: string, code = "invalid") => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });

const resultOf = (a: { score: Prisma.Decimal | null; maxScore: Prisma.Decimal; percent: Prisma.Decimal | null }) =>
  a.score === null
    ? null
    : { score: a.score.toString(), maxScore: a.maxScore.toString(), percent: a.percent?.toString() ?? null };

export class AttemptsService {
  private readonly tests: TestsService;
  constructor(private readonly db: Db) {
    this.tests = new TestsService(db);
  }

  /** The caller's own student record (the portal is self-service). */
  private async studentId(auth: RequestAuth) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind !== "student") throw forbidden({ reason: "STUDENTS_ONLY" });
    return scope.studentId;
  }

  /** Tests assigned to a student: to them by name or to a group they are a member of today. */
  private async assignedWhere(studentId: string): Promise<Prisma.TestWhereInput> {
    const { today } = await schoolClock(this.db);
    const groups = await this.db.teachingGroupMember.findMany({
      where: { studentId, ...activeOn(today) },
      select: { teachingGroupId: true },
    });
    return {
      assignments: {
        some: { OR: [{ studentId }, { teachingGroupId: { in: groups.map((g) => g.teachingGroupId) } }] },
      },
    };
  }

  /** The window that applies to a student now: an open retake window first, else the common one. */
  private windowFor(
    test: { startsAt: Date | null; endsAt: Date | null; timeLimitMinutes: number | null; status: string },
    overrides: { startsAt: Date; endsAt: Date; timeLimitMinutes: number | null; createdAt: Date }[],
    now: Date,
  ) {
    const open = overrides
      .filter((o) => windowState(o, now) === "OPEN")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    // A retake window counts attempts started in it after it was given (not the one that made it necessary).
    if (open)
      return {
        ...open,
        override: true,
        open: true,
        since: open.createdAt > open.startsAt ? open.createdAt : open.startsAt,
      };
    const commonOpen = test.status === "OPEN" && windowState(test, now) === "OPEN";
    return {
      startsAt: test.startsAt,
      endsAt: test.endsAt,
      timeLimitMinutes: test.timeLimitMinutes,
      override: false,
      open: commonOpen,
      since: null,
    };
  }

  // ---- student: list, start, view

  async myTests(auth: RequestAuth): Promise<StudentTestDto[]> {
    const studentId = await this.studentId(auth);
    await refreshTestStatuses(this.db);
    const now = new Date();
    const tests = await this.db.test.findMany({
      where: {
        AND: [
          await this.assignedWhere(studentId),
          { format: "ONLINE", status: { in: ["SCHEDULED", "OPEN", "CLOSED"] } },
        ],
      },
      include: {
        subject: { select: { name: true } },
        testType: { select: { code: true, name: true } },
        overrides: true,
        attempts: { where: { studentId }, orderBy: { attemptNo: "asc" } },
        _count: { select: { questions: true } },
      },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    });
    // Running attempts past their deadline are finished first, so the list never shows a stale "in progress".
    for (const a of tests
      .flatMap((t) => t.attempts)
      .filter((a) => a.status === "IN_PROGRESS" && isPastDeadline(a.deadline, now)))
      await this.db.$transaction(async (tx) => {
        await lockAttempt(tx, a.id);
        await finishIfDue(tx, a.id, now);
      });
    const fresh = await this.db.testAttempt.findMany({ where: { studentId, testId: { in: tests.map((t) => t.id) } } });
    return tests.map((t) => {
      const own = t.overrides.filter((o) => o.studentId === studentId);
      const w = this.windowFor(t, own, now);
      const attempts = fresh.filter((a) => a.testId === t.id).sort((a, b) => a.attemptNo - b.attemptNo);
      const visible = resultVisibility({
        showResultToStudent: t.showResultToStudent,
        testClosed: t.status === "CLOSED",
        endsAt: t.endsAt,
        overrideEnds: t.overrides.map((o) => o.endsAt),
        now,
      });
      const running = attempts.some((a) => a.status === "IN_PROGRESS");
      const canStart = w.open && (w.since ? !attempts.some((a) => a.startedAt >= w.since!) : !attempts.length);
      const upcoming = !w.open && (t.status === "SCHEDULED" || own.some((o) => windowState(o, now) === "NOT_YET"));
      const selection = t.selection as TestSelection;
      return {
        id: t.id,
        title: t.title,
        subjectName: t.subject.name,
        testTypeCode: t.testType.code,
        testTypeName: t.testType.name,
        format: t.format,
        purpose: t.purpose,
        startsAt: w.startsAt?.toISOString() ?? null,
        endsAt: w.endsAt?.toISOString() ?? null,
        timeLimitMinutes: w.timeLimitMinutes,
        questionCount:
          selection.mode === "POOL"
            ? selection.rules.reduce((n, r) => n + r.count, 0)
            : (t.questionCount ?? t._count.questions),
        state: running
          ? "IN_PROGRESS"
          : canStart
            ? "AVAILABLE"
            : upcoming
              ? "UPCOMING"
              : attempts.length
                ? "DONE"
                : "MISSED",
        attempts: attempts.map((a) => ({
          id: a.id,
          attemptNo: a.attemptNo,
          status: a.status,
          finishReason: a.finishReason,
          finishedAt: a.finishedAt?.toISOString() ?? null,
          result: a.status === "FINISHED" && visible.score ? resultOf(a) : null,
        })),
      };
    });
  }

  /** §4.2: starting is idempotent — a running attempt is returned; a new one gets its order and deadline once. */
  async start(auth: RequestAuth, testId: string): Promise<AttemptViewDto> {
    const studentId = await this.studentId(auth);
    const assigned = await this.db.test.findFirst({
      where: { AND: [{ id: testId }, await this.assignedWhere(studentId)] },
    });
    if (!assigned) {
      // Acceptance 15: a test that exists but is not given to this student is a 403, an unknown one a 404.
      if (await this.db.test.findFirst({ where: { id: testId, status: { not: "DRAFT" } } }))
        throw forbidden({ reason: "NOT_ASSIGNED" });
      throw notFound();
    }
    const attemptId = await this.db.$transaction(async (tx) => {
      await lockStart(tx, testId, studentId);
      await refreshTestStatuses(tx, { id: testId });
      const test = await tx.test.findFirstOrThrow({
        where: { id: testId },
        include: { overrides: { where: { studentId } } },
      });
      if (test.format !== "ONLINE" || test.status === "DRAFT" || test.status === "ARCHIVED")
        throw conflict("TEST_NOT_OPEN");
      const now = new Date();
      const running = await tx.testAttempt.findFirst({ where: { testId, studentId, status: "IN_PROGRESS" } });
      if (running) {
        await finishIfDue(tx, running.id, now);
        const still = await tx.testAttempt.findFirstOrThrow({ where: { id: running.id } });
        if (still.status === "IN_PROGRESS") return still.id;
      }
      const w = this.windowFor(test, test.overrides, now);
      if (!w.open) throw conflict("TEST_NOT_OPEN");
      const previous = await tx.testAttempt.findMany({ where: { testId, studentId }, orderBy: { attemptNo: "desc" } });
      // One attempt in the common window; a retake window allows one more inside it (§5).
      if (w.since ? previous.some((a) => a.startedAt >= w.since!) : previous.length) throw conflict("ALREADY_TAKEN");

      const id = randomUUID();
      const questions = await tx.testQuestion.findMany({
        where: { testId },
        orderBy: { order: "asc" },
        include: testQuestionInclude,
      });
      const chosen = this.chooseQuestions(test, questions, id);
      const optionOrder: Record<string, string[]> = {};
      for (const tq of chosen) {
        const type = tq.questionVersion.question.type;
        if (type === "MATCHING") {
          const rights = ((tq.questionVersion.pairs as MatchingPair[] | null) ?? []).map((p) => p.rightId);
          optionOrder[tq.id] = seededShuffle(rights, `${id}:${tq.id}`);
        } else if (type === "SINGLE" || type === "MULTIPLE") {
          const ids = (tq.questionVersion.options as unknown as QuestionOption[]).map((o) => o.id);
          optionOrder[tq.id] = test.shuffleOptions ? seededShuffle(ids, `${id}:${tq.id}`) : ids;
        }
      }
      const { today } = await schoolClock(tx as unknown as Db);
      const deadline = attemptDeadline(now, { endsAt: w.endsAt, timeLimitMinutes: w.timeLimitMinutes });
      const created = await tx.testAttempt.create({
        data: {
          id,
          tenantId: requireTenantId(),
          testId,
          studentId,
          attemptNo: (previous[0]?.attemptNo ?? 0) + 1,
          startedAt: now,
          deadline,
          questionOrder: chosen.map((q) => q.id),
          optionOrder,
          maxScore: sum(chosen.map((q) => q.points.toString())).toString(),
          schoolDate: schoolDateToDb(today),
        },
      });
      await scheduleDeadlineJob(tx, created);
      return created.id;
    });
    return this.view(auth, attemptId);
  }

  /** The questions of one attempt: a pool draw or a subset when the test asks for fewer, shuffled when asked. */
  private chooseQuestions(
    test: { selection: Prisma.JsonValue; questionCount: number | null; shuffleQuestions: boolean },
    questions: TestQuestionRow[],
    seed: string,
  ) {
    const selection = test.selection as TestSelection;
    let chosen = questions;
    if (selection.mode === "POOL") {
      const ids = selectFromPool(
        selection.rules,
        questions.map((q) => ({
          id: q.id,
          topicId: q.questionVersion.question.topicId,
          difficulty: q.questionVersion.question.difficulty,
        })),
        seed,
      );
      if (!ids) throw conflict("POOL_EXHAUSTED");
      const byId = new Map(questions.map((q) => [q.id, q]));
      chosen = ids.map((qid) => byId.get(qid)!);
    } else if (test.questionCount && test.questionCount < questions.length) {
      const subset = new Set(
        seededShuffle(questions, `${seed}:subset`)
          .slice(0, test.questionCount)
          .map((q) => q.id),
      );
      chosen = questions.filter((q) => subset.has(q.id));
    }
    return test.shuffleQuestions ? seededShuffle(chosen, `${seed}:order`) : chosen;
  }

  private async ownAttempt(auth: RequestAuth, attemptId: string, tx: Db | DbTransaction = this.db) {
    const studentId = await this.studentId(auth);
    const attempt = await tx.testAttempt.findFirst({ where: { id: attemptId, studentId } });
    if (!attempt) throw notFound();
    return attempt;
  }

  /** GET /attempts/:id — questions without the key, the saved answers, the server clock (§4.3, S4). */
  async view(auth: RequestAuth, attemptId: string): Promise<AttemptViewDto> {
    await this.ownAttempt(auth, attemptId);
    await this.db.$transaction(async (tx) => {
      await lockAttempt(tx, attemptId);
      await finishIfDue(tx, attemptId);
    });
    const now = new Date();
    const a = await this.db.testAttempt.findFirstOrThrow({
      where: { id: attemptId },
      include: {
        answers: true,
        test: { include: { subject: { select: { name: true } }, overrides: { select: { endsAt: true } } } },
      },
    });
    const order = a.questionOrder as string[];
    const optionOrder = a.optionOrder as Record<string, string[]>;
    const questions = await this.db.testQuestion.findMany({
      where: { id: { in: order } },
      include: testQuestionInclude,
    });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const visible =
      a.status === "FINISHED"
        ? resultVisibility({
            showResultToStudent: a.test.showResultToStudent,
            testClosed: a.test.status === "CLOSED",
            endsAt: a.test.endsAt,
            overrideEnds: a.test.overrides.map((o) => o.endsAt),
            now,
          })
        : { score: false, perQuestion: false };
    return {
      id: a.id,
      testId: a.testId,
      title: a.test.title,
      subjectName: a.test.subject.name,
      attemptNo: a.attemptNo,
      status: a.status,
      finishReason: a.finishReason,
      startedAt: a.startedAt.toISOString(),
      deadline: a.deadline?.toISOString() ?? null,
      serverNow: now.toISOString(),
      currentIndex: a.currentIndex,
      violationCount: a.violationCount,
      violationThreshold: a.test.violationThreshold,
      questions: order.map((tqId) => studentQuestion(byId.get(tqId)!, optionOrder[tqId])),
      answers: Object.fromEntries(
        a.answers.map((x) => [x.testQuestionId, { answer: x.answer as AnswerValue, clientSeq: x.clientSeq }]),
      ),
      result: visible.score ? resultOf(a) : null,
      perQuestion: visible.perQuestion
        ? Object.fromEntries(
            order.map((tqId) => [tqId, a.answers.find((x) => x.testQuestionId === tqId)?.isCorrect ?? false]),
          )
        : null,
    };
  }

  /** Runs `fn` on a running attempt under its lock; an attempt past its deadline is finished and the call is a 409. */
  private async onRunning<T>(auth: RequestAuth, attemptId: string, fn: (tx: DbTransaction, now: Date) => Promise<T>) {
    await this.ownAttempt(auth, attemptId);
    const outcome = await this.db.$transaction(async (tx) => {
      await lockAttempt(tx, attemptId);
      const now = new Date();
      const a = await tx.testAttempt.findFirstOrThrow({ where: { id: attemptId } });
      if (a.status === "FINISHED") return { done: "ATTEMPT_FINISHED" as const };
      if (isPastDeadline(a.deadline, now)) {
        await finishAttempt(tx, attemptId, "TIME_UP", now);
        return { done: "DEADLINE_PASSED" as const };
      }
      return { value: await fn(tx, now) };
    });
    if ("done" in outcome) throw conflict(outcome.done!);
    return outcome.value as T;
  }

  /** §4.3, S5, acceptance 4, 8, 17. */
  async saveAnswer(
    auth: RequestAuth,
    attemptId: string,
    testQuestionId: string,
    input: z.infer<typeof SaveAnswerSchema>,
  ) {
    return this.onRunning(auth, attemptId, async (tx, now) => {
      const a = await tx.testAttempt.findFirstOrThrow({ where: { id: attemptId } });
      if (!(a.questionOrder as string[]).includes(testQuestionId)) throw invalid("testQuestionId");
      const tq = await tx.testQuestion.findFirstOrThrow({
        where: { id: testQuestionId },
        include: testQuestionInclude,
      });
      const problem = answerProblem(gradable(tq.questionVersion.question.type, tq.questionVersion), input.answer);
      if (problem) throw invalid("answer", problem.toLowerCase());
      if (input.currentIndex !== undefined)
        await tx.testAttempt.update({ where: { id: attemptId }, data: { currentIndex: input.currentIndex } });
      const existing = await tx.testAnswer.findFirst({ where: { attemptId, testQuestionId } });
      if (existing && existing.clientSeq >= input.clientSeq) return { saved: false, clientSeq: existing.clientSeq };
      if (existing)
        await tx.testAnswer.update({
          where: { id: existing.id },
          data: { answer: input.answer, clientSeq: input.clientSeq, savedAt: now },
        });
      else
        await tx.testAnswer.create({
          data: {
            tenantId: requireTenantId(),
            attemptId,
            testQuestionId,
            answer: input.answer,
            clientSeq: input.clientSeq,
            savedAt: now,
          },
        });
      return { saved: true, clientSeq: input.clientSeq };
    });
  }

  async savePosition(auth: RequestAuth, attemptId: string, currentIndex: number) {
    await this.onRunning(auth, attemptId, async (tx) => {
      const a = await tx.testAttempt.findFirstOrThrow({ where: { id: attemptId } });
      if (currentIndex >= (a.questionOrder as string[]).length) throw invalid("currentIndex");
      await tx.testAttempt.update({ where: { id: attemptId }, data: { currentIndex } });
    });
  }

  /** §4.4: the server decides what counts; at the threshold the server ends the attempt (VIOLATION). */
  async event(auth: RequestAuth, attemptId: string, input: z.infer<typeof AttemptEventSchema>) {
    return this.onRunning(auth, attemptId, async (tx, now) => {
      const a = await tx.testAttempt.findFirstOrThrow({
        where: { id: attemptId },
        include: { test: { select: { violationThreshold: true } } },
      });
      const previous = await tx.testEvent.findMany({
        where: { attemptId, serverTs: { gte: new Date(now.getTime() - 10_000) } },
        select: { type: true, serverTs: true, counted: true },
      });
      const counted = countsAsViolation(previous as { type: TestEventType; serverTs: Date; counted: boolean }[], {
        type: input.type,
        serverTs: now,
      });
      await tx.testEvent.create({
        data: {
          tenantId: requireTenantId(),
          attemptId,
          type: input.type,
          clientTs: input.clientTs ? new Date(input.clientTs) : null,
          clientSeq: input.clientSeq ?? null,
          serverTs: now,
          counted,
        },
      });
      const violationCount = a.violationCount + (counted ? 1 : 0);
      if (counted) await tx.testAttempt.update({ where: { id: attemptId }, data: { violationCount } });
      const threshold = a.test.violationThreshold;
      const finished = counted && violationLimitReached(violationCount, threshold);
      if (finished) await finishAttempt(tx, attemptId, "VIOLATION", now);
      return {
        counted,
        violationCount,
        remaining: threshold > 0 ? Math.max(0, threshold - violationCount) : null,
        finished,
      };
    });
  }

  /** §4.5: the client only asks to submit; past the deadline the server records TIME_UP (acceptance 6). */
  async submit(auth: RequestAuth, attemptId: string) {
    await this.ownAttempt(auth, attemptId);
    await this.db.$transaction(async (tx) => {
      await lockAttempt(tx, attemptId);
      const now = new Date();
      const a = await tx.testAttempt.findFirstOrThrow({ where: { id: attemptId } });
      if (a.status === "FINISHED") return;
      await finishAttempt(tx, attemptId, isPastDeadline(a.deadline, now) ? "TIME_UP" : "SUBMITTED", now);
    });
    return this.view(auth, attemptId);
  }

  /** Bytes of an image used by a question of the student's own attempt. */
  async image(auth: RequestAuth, attemptId: string, assetId: string) {
    const a = await this.ownAttempt(auth, attemptId);
    const used = await this.db.testQuestion.findFirst({
      where: { id: { in: a.questionOrder as string[] }, questionVersion: { imageAssetId: assetId } },
    });
    const asset =
      used && (await this.db.fileAsset.findFirst({ where: { id: assetId, kind: "QUESTION_IMAGE", status: "READY" } }));
    if (!asset) throw notFound();
    return asset;
  }

  // ---- teacher / admin

  async attempts(auth: RequestAuth, testId: string): Promise<TestAttemptDto[]> {
    await this.tests.find(auth, testId);
    const due = await this.db.testAttempt.findMany({
      where: { testId, status: "IN_PROGRESS", deadline: { lte: new Date() } },
      select: { id: true },
    });
    for (const d of due)
      await this.db.$transaction(async (tx) => {
        await lockAttempt(tx, d.id);
        await finishIfDue(tx, d.id);
      });
    const rows = await this.db.testAttempt.findMany({
      where: { testId },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: "asc" } }, { attemptNo: "asc" }],
    });
    return rows.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      studentName: `${a.student.lastName} ${a.student.firstName}`,
      attemptNo: a.attemptNo,
      status: a.status,
      finishReason: a.finishReason,
      startedAt: a.startedAt.toISOString(),
      deadline: a.deadline?.toISOString() ?? null,
      finishedAt: a.finishedAt?.toISOString() ?? null,
      violationCount: a.violationCount,
      score: a.score?.toString() ?? null,
      maxScore: a.maxScore.toString(),
      percent: a.percent?.toString() ?? null,
    }));
  }

  /** §4.4: a finished attempt opens again with a new deadline; its answers stay; reason and audit required. */
  async reopen(auth: RequestAuth, attemptId: string, input: z.infer<typeof ReopenAttemptSchema>) {
    const attempt = await this.db.testAttempt.findFirst({ where: { id: attemptId } });
    if (!attempt) throw notFound();
    await this.tests.find(auth, attempt.testId);
    await this.db.$transaction(async (tx) => {
      await lockAttempt(tx, attemptId);
      const a = await tx.testAttempt.findFirstOrThrow({ where: { id: attemptId } });
      if (a.status !== "FINISHED") throw conflict("ATTEMPT_NOT_FINISHED");
      const deadline = new Date(Date.now() + input.minutes * 60_000);
      await tx.testAttempt.update({
        where: { id: attemptId },
        data: {
          status: "IN_PROGRESS",
          finishReason: null,
          finishedAt: null,
          score: null,
          percent: null,
          gradedAt: null,
          deadline,
        },
      });
      await tx.testAnswer.updateMany({ where: { attemptId }, data: { isCorrect: null, pointsAwarded: null } });
      await scheduleDeadlineJob(tx, { id: attemptId, deadline });
      await writeAudit(tx, {
        action: "test_attempt.reopen",
        entityType: "TestAttempt",
        entityId: attemptId,
        before: { finishReason: a.finishReason, score: a.score?.toString() ?? null },
        after: { deadline: deadline.toISOString(), reason: input.reason },
      });
    });
    return (await this.attempts(auth, attempt.testId)).find((x) => x.id === attemptId)!;
  }

  /** §5: retakes and individual time — a window per student; a reason is required. */
  async addOverrides(auth: RequestAuth, testId: string, input: z.infer<typeof CreateOverridesSchema>) {
    const test = await this.tests.find(auth, testId);
    if (test.format !== "ONLINE" || test.status === "DRAFT" || test.status === "ARCHIVED")
      throw conflict("TEST_NOT_PUBLISHED");
    const { today } = await schoolClock(this.db);
    const assignedGroups = test.assignments.flatMap((a) => (a.teachingGroupId ? [a.teachingGroupId] : []));
    const assignedStudents = test.assignments.flatMap((a) => (a.studentId ? [a.studentId] : []));
    const eligible = await this.db.student.findMany({
      where: {
        id: { in: input.studentIds },
        OR: [
          { id: { in: assignedStudents } },
          { groupMemberships: { some: { teachingGroupId: { in: assignedGroups }, ...activeOn(today) } } },
        ],
      },
      select: { id: true },
    });
    if (eligible.length !== new Set(input.studentIds).size) throw invalid("studentIds");
    await this.db.$transaction(async (tx) => {
      for (const studentId of new Set(input.studentIds)) {
        const o = await tx.testWindowOverride.create({
          data: {
            tenantId: requireTenantId(),
            testId,
            studentId,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            timeLimitMinutes: input.timeLimitMinutes ?? null,
            reason: input.reason,
            createdById: auth.userId,
          },
        });
        await writeAudit(tx, {
          action: "test.override",
          entityType: "TestWindowOverride",
          entityId: o.id,
          after: { testId, studentId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason },
        });
      }
    });
    return this.overrides(auth, testId);
  }

  async overrides(auth: RequestAuth, testId: string) {
    await this.tests.find(auth, testId);
    const rows = await this.db.testWindowOverride.findMany({
      where: { testId },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((o) => ({
      id: o.id,
      studentId: o.studentId,
      studentName: `${o.student.lastName} ${o.student.firstName}`,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      timeLimitMinutes: o.timeLimitMinutes,
      reason: o.reason,
      createdAt: o.createdAt.toISOString(),
    }));
  }
}

/** The student shape of one question (S4): ids and texts only, in the attempt's order. */
function studentQuestion(tq: TestQuestionRow, order: string[] | undefined) {
  const v = tq.questionVersion;
  const type = v.question.type;
  const base = {
    testQuestionId: tq.id,
    type,
    text: v.text,
    imageAssetId: v.imageAssetId,
    points: tq.points.toString(),
  };
  if (type === "SINGLE" || type === "MULTIPLE") {
    const options = new Map((v.options as unknown as QuestionOption[]).map((o) => [o.id, o.text]));
    return { ...base, options: (order ?? [...options.keys()]).map((id) => ({ id, text: options.get(id)! })) };
  }
  if (type === "MATCHING") {
    const pairs = (v.pairs as MatchingPair[] | null) ?? [];
    const rights = new Map(pairs.map((p) => [p.rightId, p.right]));
    return {
      ...base,
      leftItems: pairs.map((p) => ({ id: p.leftId, text: p.left })),
      rightItems: (order ?? [...rights.keys()]).map((id) => ({ id, text: rights.get(id)! })),
    };
  }
  return base;
}
