// Offline results (tests.md §6): a grid of the test's students; an empty cell is not saved; 0 ≤ rawScore ≤ maxScore;
// a change is a new row (the old one points at it — the history stays, OfflineResult_history). A weighted test's
// results in a closed period change only with assessment.reopen and a reason, and mark the period results stale.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import type { OfflineResultsDto, SaveOfflineResultsSchema } from "@idrok/shared";
import { schoolDateFromDb } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden } from "../../http/errors";
import { offlinePercent } from "../../domain/tests";
import { activeOn } from "../access/scope";
import { markStale } from "../assessment/closing.service";
import { writeAudit } from "../audit/audit.service";
import { TestsService } from "./tests.service";

export class OfflineResultsService {
  private readonly tests: TestsService;
  constructor(private readonly db: Db) {
    this.tests = new TestsService(db);
  }

  /** Students the test is for: named ones and members of the assigned groups on the test's day. */
  private async students(tx: Db | DbTransaction, test: Awaited<ReturnType<TestsService["find"]>>) {
    const day = test.schoolDate ? schoolDateFromDb(test.schoolDate) : null;
    const groupIds = test.assignments.flatMap((a) => (a.teachingGroupId ? [a.teachingGroupId] : []));
    const named = test.assignments.flatMap((a) => (a.studentId ? [a.studentId] : []));
    return tx.student.findMany({
      where: {
        OR: [
          { id: { in: named } },
          { groupMemberships: { some: { teachingGroupId: { in: groupIds }, ...(day ? activeOn(day) : {}) } } },
        ],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  }

  async get(auth: RequestAuth, testId: string): Promise<OfflineResultsDto> {
    const test = await this.tests.find(auth, testId);
    if (test.format !== "OFFLINE") throw new AppError("CONFLICT", 409, { reason: "NOT_OFFLINE" });
    const [students, results] = await Promise.all([
      this.students(this.db, test),
      this.db.offlineResult.findMany({ where: { testId }, orderBy: { enteredAt: "asc" } }),
    ]);
    const rows = students.map((st) => {
      const mine = results.filter((r) => r.studentId === st.id);
      const current = mine.find((r) => r.supersededById === null);
      return {
        studentId: st.id,
        studentName: `${st.lastName} ${st.firstName}`,
        status: current?.status ?? null,
        rawScore: current?.rawScore?.toString() ?? null,
        percent:
          current?.status === "SCORED"
            ? (offlinePercent(current.rawScore!.toString(), test.maxScore.toString())?.toString() ?? null)
            : null,
        note: current?.note ?? null,
        enteredAt: current?.enteredAt.toISOString() ?? null,
        corrections: Math.max(0, mine.length - 1),
      };
    });
    return { maxScore: test.maxScore.toString(), rows, missing: rows.filter((r) => r.status === null).length };
  }

  async save(auth: RequestAuth, testId: string, input: z.infer<typeof SaveOfflineResultsSchema>) {
    await this.db.$transaction(async (tx) => {
      const test = await this.tests.find(auth, testId, tx);
      if (test.format !== "OFFLINE") throw new AppError("CONFLICT", 409, { reason: "NOT_OFFLINE" });
      if (test.status === "DRAFT" || test.status === "ARCHIVED")
        throw new AppError("CONFLICT", 409, { reason: "TEST_NOT_PUBLISHED" });
      const closedPeriod = test.purpose === "WEIGHTED" && test.period?.status === "CLOSED";
      if (closedPeriod) {
        if (!auth.permissions.includes("assessment.reopen")) throw forbidden({ reason: "PERIOD_CLOSED" });
        if (!input.reason)
          throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "reason", code: "required" }] });
      }
      const eligible = new Set((await this.students(tx, test)).map((s) => s.id));
      const max = Number(test.maxScore);
      const fields: { path: string; code: string }[] = [];
      input.results.forEach((r, i) => {
        if (!eligible.has(r.studentId)) fields.push({ path: `results.${i}.studentId`, code: "invalid" });
        if (r.status === "SCORED" && (r.rawScore === null || r.rawScore === undefined))
          fields.push({ path: `results.${i}.rawScore`, code: "required" });
        // Acceptance 12: above the scale is refused, never clipped.
        if (r.status === "SCORED" && r.rawScore != null && Number(r.rawScore) > max)
          fields.push({ path: `results.${i}.rawScore`, code: "above_max" });
      });
      if (new Set(input.results.map((r) => r.studentId)).size !== input.results.length)
        fields.push({ path: "results", code: "duplicate" });
      if (fields.length) throw new AppError("VALIDATION_ERROR", 400, { fields });

      const tenantId = requireTenantId();
      const changed: string[] = [];
      for (const r of input.results) {
        const rawScore = r.status === "SCORED" ? r.rawScore! : null;
        const note = r.note ?? null;
        const current = await tx.offlineResult.findFirst({
          where: { testId, studentId: r.studentId, supersededById: null },
        });
        if (
          current &&
          current.status === r.status &&
          (current.rawScore?.toString() ?? null) === (rawScore === null ? null : String(Number(rawScore))) &&
          current.note === note
        )
          continue;
        // One current row per student (partial unique index): the old row first points at itself, then at its successor.
        if (current) await tx.offlineResult.update({ where: { id: current.id }, data: { supersededById: current.id } });
        const created = await tx.offlineResult.create({
          data: {
            tenantId,
            testId,
            studentId: r.studentId,
            status: r.status,
            rawScore,
            note,
            enteredById: auth.userId,
          },
        });
        if (current) await tx.offlineResult.update({ where: { id: current.id }, data: { supersededById: created.id } });
        changed.push(r.studentId);
      }
      if (closedPeriod && changed.length) await markStale(tx, test.periodId!, changed);
      if (changed.length)
        await writeAudit(tx, {
          action: "test.offline_results",
          entityType: "Test",
          entityId: testId,
          after: { students: changed.length, ...(input.reason ? { reason: input.reason } : {}) },
        });
    });
    return this.get(auth, testId);
  }
}
