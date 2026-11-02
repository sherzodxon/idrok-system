// Weighted tests as inputs of the TESTS component (scoring.md §5.2, tests.md §7): per student and subject, each
// published WEIGHTED test of the period with the student's finished attempts (online) or current result (offline).
// No result yet: pending (left out) while the test can still be taken or the absence is excused; missed once it is over
// (the policy's `missedTest` decides).
import type { Db, DbTransaction } from "@idrok/db";
import { schoolDateFromDb } from "@idrok/shared/time";
import type { TestInput } from "../../domain/scoring";
import { offlinePercent } from "../../domain/tests";
import { activeOn } from "../access/scope";

export interface LoadedTest extends TestInput {
  testId: string;
  includedInAssessment: boolean;
}

export const testKey = (studentId: string, subjectId: string) => `${studentId}|${subjectId}`;

export async function loadTestInputs(
  db: Db | DbTransaction,
  q: { periodId: string; studentIds: string[]; subjectId?: string | null; now?: Date },
): Promise<Map<string, LoadedTest[]>> {
  const now = q.now ?? new Date();
  const out = new Map<string, LoadedTest[]>();
  if (!q.studentIds.length) return out;
  const tests = await db.test.findMany({
    where: {
      periodId: q.periodId,
      purpose: "WEIGHTED",
      status: { in: ["SCHEDULED", "OPEN", "CLOSED"] },
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
    },
    include: {
      assignments: true,
      overrides: { where: { studentId: { in: q.studentIds } }, select: { studentId: true, endsAt: true } },
      attempts: {
        where: { studentId: { in: q.studentIds }, status: "FINISHED" },
        select: { studentId: true, percent: true, finishedAt: true },
        orderBy: { finishedAt: "asc" },
      },
      offlineResults: {
        where: { studentId: { in: q.studentIds }, supersededById: null },
        select: { studentId: true, status: true, rawScore: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const test of tests) {
    // Who the test is for: named students, and members of the assigned groups on the test's day.
    const day = test.schoolDate ? schoolDateFromDb(test.schoolDate) : null;
    const groupIds = test.assignments.flatMap((a) => (a.teachingGroupId ? [a.teachingGroupId] : []));
    const members = groupIds.length
      ? await db.teachingGroupMember.findMany({
          where: {
            teachingGroupId: { in: groupIds },
            studentId: { in: q.studentIds },
            ...(day ? activeOn(day) : {}),
          },
          select: { studentId: true },
        })
      : [];
    const assigned = new Set([
      ...test.assignments.flatMap((a) => (a.studentId && q.studentIds.includes(a.studentId) ? [a.studentId] : [])),
      ...members.map((m) => m.studentId),
    ]);
    const over = test.status === "CLOSED" || (test.endsAt !== null && test.endsAt <= now);
    for (const studentId of assigned) {
      let attempts: string[] = [];
      let pending: boolean;
      if (test.format === "ONLINE") {
        attempts = test.attempts
          .filter((a) => a.studentId === studentId && a.percent)
          .map((a) => a.percent!.toString());
        const ownWindowOpen = test.overrides.some((o) => o.studentId === studentId && o.endsAt > now);
        pending = !attempts.length && (!over || ownWindowOpen);
      } else {
        const result = test.offlineResults.find((r) => r.studentId === studentId);
        if (result?.status === "SCORED")
          attempts = [offlinePercent(result.rawScore!.toString(), test.maxScore.toString())!.toString()];
        pending = !result || result.status === "EXCUSED";
      }
      const key = testKey(studentId, test.subjectId);
      const list = out.get(key) ?? [];
      list.push({
        testId: test.id,
        weight: test.weight?.toString() ?? "1",
        attempts,
        retakePolicy: test.retakePolicy,
        pending,
        includedInAssessment: test.includedInAssessment,
      });
      out.set(key, list);
    }
  }
  return out;
}

/** The tests that count for the policy's mode (scoring.md §5.2). */
export function testsForMode(tests: LoadedTest[], mode: "COMBINED" | "SEPARATE" | "SELECTIVE") {
  if (mode === "SEPARATE") return [];
  return mode === "SELECTIVE" ? tests.filter((t) => t.includedInAssessment) : tests;
}
