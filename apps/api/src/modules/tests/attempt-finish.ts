// Finishing attempts (tests.md §4.5): grading from the answers saved on the server, once. Shared by the student
// actions, the deadline job, reopening and closing a test.
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type { AnswerValue } from "@idrok/shared";
import { attemptScore, gradeAnswer, isPastDeadline, type MultipleScoring } from "../../domain/tests";
import { markStale } from "../assessment/closing.service";
import { gradable } from "../question-bank/question-bank.service";
import { requestTestCoins } from "../coins/auto-coins";

export type FinishReason = "SUBMITTED" | "TIME_UP" | "VIOLATION" | "ADMIN_CLOSED";

export const lockAttempt = (tx: DbTransaction, attemptId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attempt:${requireTenantId()}:${attemptId}`}, 0))`;
export const lockStart = (tx: DbTransaction, testId: string, studentId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`start:${requireTenantId()}:${testId}:${studentId}`}, 0))`;

export const testQuestionInclude = {
  questionVersion: { include: { question: { select: { type: true, topicId: true, difficulty: true } } } },
} satisfies Prisma.TestQuestionInclude;
export type TestQuestionRow = Prisma.TestQuestionGetPayload<{ include: typeof testQuestionInclude }>;

/**
 * Grades every question of the attempt from the answers saved on the server and finishes it. Idempotent: a finished
 * attempt is returned as it is (finishing twice changes nothing — §4.5). The caller holds the attempt lock.
 */
export async function finishAttempt(tx: DbTransaction, attemptId: string, reason: FinishReason, now = new Date()) {
  const attempt = await tx.testAttempt.findFirstOrThrow({
    where: { id: attemptId },
    include: { test: { select: { multipleScoring: true } }, answers: true },
  });
  if (attempt.status === "FINISHED") return attempt;
  const order = attempt.questionOrder as string[];
  const questions = await tx.testQuestion.findMany({ where: { id: { in: order } }, include: testQuestionInclude });
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = new Map(attempt.answers.map((a) => [a.testQuestionId, a]));
  const graded = order.map((tqId) => {
    const tq = byId.get(tqId)!;
    const saved = answers.get(tqId);
    const g = gradeAnswer(
      gradable(tq.questionVersion.question.type, tq.questionVersion),
      (saved?.answer as AnswerValue | undefined) ?? null,
      tq.points.toString(),
      attempt.test.multipleScoring as MultipleScoring,
    );
    return { tq, saved, g };
  });
  for (const { saved, g } of graded)
    if (saved)
      await tx.testAnswer.update({
        where: { id: saved.id },
        data: { isCorrect: g.isCorrect, pointsAwarded: g.points.toString() },
      });
  const score = attemptScore(graded.map(({ tq, g }) => ({ points: tq.points.toString(), awarded: g.points })));
  // A weighted test of a closed period: its FINAL results are now behind (scoring.md §7).
  const test = await tx.test.findFirstOrThrow({
    where: { id: attempt.testId },
    select: { status: true, purpose: true, periodId: true, period: { select: { status: true } } },
  });
  if (test.purpose === "WEIGHTED" && test.period?.status === "CLOSED")
    await markStale(tx, test.periodId!, [attempt.studentId]);
  // A retake on a closed test: its result may earn automatic coins (closing the test requests them itself).
  if (test.status === "CLOSED" && reason !== "ADMIN_CLOSED") await requestTestCoins(tx, attempt.testId);
  // TIME_UP ends at the deadline itself, whenever the server noticed it.
  const finishedAt = reason === "TIME_UP" && attempt.deadline && attempt.deadline < now ? attempt.deadline : now;
  return tx.testAttempt.update({
    where: { id: attemptId },
    data: {
      status: "FINISHED",
      finishReason: reason,
      finishedAt,
      score: score.score.toString(),
      maxScore: score.maxScore.toString(),
      percent: score.percent?.toDecimalPlaces(4).toString() ?? null,
      gradedAt: now,
    },
    include: { test: { select: { multipleScoring: true } }, answers: true },
  });
}

/** Lazy finish (acceptance 5): an attempt past its deadline is finished with TIME_UP before anything else. */
export async function finishIfDue(tx: DbTransaction, attemptId: string, now = new Date()) {
  const a = await tx.testAttempt.findFirst({ where: { id: attemptId }, select: { status: true, deadline: true } });
  if (a?.status === "IN_PROGRESS" && isPastDeadline(a.deadline, now))
    await finishAttempt(tx, attemptId, "TIME_UP", now);
}

export async function scheduleDeadlineJob(tx: DbTransaction, attempt: { id: string; deadline: Date | null }) {
  if (!attempt.deadline) return;
  const tenantId = requireTenantId();
  await tx.outboxEvent.create({
    data: {
      tenantId,
      type: "attempt.deadline_due",
      aggregateType: "TestAttempt",
      aggregateId: attempt.id,
      payload: { tenantId, attemptId: attempt.id },
      availableAt: attempt.deadline,
    },
  });
}

/** Worker: the deadline job, the same finish as the lazy one. */
export async function processDeadline(db: Db, attemptId: string) {
  await db.$transaction(async (tx) => {
    await lockAttempt(tx, attemptId);
    await finishIfDue(tx, attemptId);
  });
}

/** Closing a test ends its running attempts (ADMIN_CLOSED); retake windows keep theirs. */
export async function finishRunning(tx: DbTransaction, testId: string) {
  const now = new Date();
  const running = await tx.testAttempt.findMany({
    where: { testId, status: "IN_PROGRESS" },
    select: { id: true, studentId: true },
  });
  const overridden = new Set(
    (
      await tx.testWindowOverride.findMany({
        where: { testId, startsAt: { lte: now }, endsAt: { gt: now } },
        select: { studentId: true },
      })
    ).map((o) => o.studentId),
  );
  for (const a of running.filter((r) => !overridden.has(r.studentId))) {
    await lockAttempt(tx, a.id);
    await finishAttempt(tx, a.id, "ADMIN_CLOSED", now);
  }
}
