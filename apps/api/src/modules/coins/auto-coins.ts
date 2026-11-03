// Automatic coins for test results (MASTER_SPEC §14 "Yuqori test natijasi"). A test's final results are rewarded once
// it is over: an online test when it closes (and again after a retake on a closed test), an offline test whenever its
// results are saved. One award per student and test (`sourceRef`), so running this again changes nothing.
import { requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import { TestResultRuleConfigSchema } from "@idrok/shared";
import { D } from "@idrok/shared/decimal";
import { testResultAward, type FinalTestResult, type TestResultRule } from "../../domain/coins";
import { offlinePercent } from "../../domain/tests";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { coinSettings, lockStudentCoins, post } from "./ledger";

/** Asks the worker to (re)award the test's results — written with the change that may have made them final. */
export async function requestTestCoins(tx: DbTransaction, testId: string) {
  const tenantId = requireTenantId();
  await tx.outboxEvent.create({
    data: {
      tenantId,
      type: "coins.test_results_due",
      aggregateType: "Test",
      aggregateId: testId,
      payload: { tenantId, testId },
    },
  });
}

/** Final result per student: online by the retake policy (LAST / BEST of finished attempts), offline the current one. */
async function finalResults(db: Db, testId: string): Promise<Map<string, FinalTestResult> | null> {
  const test = await db.test.findFirst({
    where: { id: testId },
    select: {
      format: true,
      status: true,
      purpose: true,
      retakePolicy: true,
      maxScore: true,
      attempts: {
        where: { status: "FINISHED" },
        select: { studentId: true, percent: true, finishReason: true, finishedAt: true },
        orderBy: { finishedAt: "asc" },
      },
      offlineResults: {
        where: { supersededById: null, status: "SCORED" },
        select: { studentId: true, rawScore: true },
      },
    },
  });
  if (!test) return null;
  const over = test.format === "ONLINE" ? test.status === "CLOSED" : ["OPEN", "CLOSED"].includes(test.status);
  if (!over) return null;
  const out = new Map<string, FinalTestResult>();
  if (test.format === "OFFLINE") {
    for (const r of test.offlineResults)
      out.set(r.studentId, {
        percent: offlinePercent(r.rawScore!.toString(), test.maxScore.toString()),
        purpose: test.purpose,
        violation: false,
      });
    return out;
  }
  const byStudent = new Map<string, typeof test.attempts>();
  for (const a of test.attempts) byStudent.set(a.studentId, [...(byStudent.get(a.studentId) ?? []), a]);
  for (const [studentId, attempts] of byStudent) {
    const scored = attempts.filter((a) => a.percent !== null);
    if (!scored.length) continue;
    const chosen =
      test.retakePolicy === "BEST"
        ? scored.reduce((best, a) => (D(a.percent!).gt(D(best.percent!)) ? a : best))
        : scored[scored.length - 1]!;
    out.set(studentId, {
      percent: chosen.percent!.toString(),
      purpose: test.purpose,
      violation: chosen.finishReason === "VIOLATION",
    });
  }
  return out;
}

/** Awards the test's final results; returns how many students got coins now. */
export async function awardTestCoins(db: Db, testId: string): Promise<number> {
  const settings = await coinSettings(db);
  if (!settings.isEnabled || !settings.autoCoinsEnabled || !settings.rewardsEnabled) return 0;
  const rows = await db.coinAutoRule.findMany({
    where: { source: "TEST_RESULT", isActive: true, criterion: { isActive: true } },
    select: { id: true, criterionId: true, config: true, criterion: { select: { name: true } } },
  });
  if (!rows.length) return 0;
  const rules: (TestResultRule & { criterionName: string })[] = rows.map((r) => ({
    id: r.id,
    criterionId: r.criterionId,
    criterionName: r.criterion.name,
    ...TestResultRuleConfigSchema.parse(r.config),
  }));
  const results = await finalResults(db, testId);
  if (!results) return 0;
  const { today } = await schoolClock(db);
  const sourceRef = `test:${testId}`;
  let awarded = 0;
  for (const [studentId, result] of results) {
    const award = testResultAward(rules, result);
    if (!award) continue;
    const rule = rules.find((r) => r.id === award.id)!;
    const done = await db.$transaction(async (tx) => {
      await lockStudentCoins(tx, studentId);
      const existing = await tx.coinTransaction.findFirst({
        where: { studentId, source: "TEST_RESULT", sourceRef },
        select: { id: true },
      });
      if (existing) return false;
      const { transaction } = await post(tx, {
        studentId,
        type: "REWARD",
        source: "TEST_RESULT",
        amount: award.amount,
        floor: 0,
        schoolDate: today,
        idempotencyKey: `auto:${sourceRef}:${studentId}`,
        actorUserId: null,
        criterionId: award.criterionId,
        criterionNameSnapshot: rule.criterionName,
        sourceRef,
      });
      await writeAudit(tx, {
        action: "coins.auto.test_result",
        entityType: "CoinTransaction",
        entityId: transaction.id,
        actorUserId: null,
        after: { testId, studentId, ruleId: award.id, amount: award.amount, percent: String(result.percent) },
      });
      return true;
    });
    if (done) awarded++;
  }
  return awarded;
}
