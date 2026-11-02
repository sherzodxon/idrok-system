// Closing a period (scoring.md §7): prepare (DRAFT results + completeness report) → close (FINAL snapshot, period
// CLOSED) → later changes only mark results stale → recompute makes a new FINAL version. Plus MANUAL component scores
// (Q-12) and the "who has not scored" report.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import {
  AssessmentConfigSchema,
  type CloseReportSchema,
  type ManualScoreQuerySchema,
  type MissingScoresQuerySchema,
  type SaveManualScoreSchema,
} from "@idrok/shared";
import { diffSchoolDays, schoolDateFromDb, schoolDateToDb } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { activeOn, resolveScope } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { activeLimitRules, limitSettings, scoreSettings } from "../scores/score-config.service";
import { sessionOutcome } from "../../domain/scoring";
import { effectiveVersion } from "./policies.service";
import { ResultsService, type ComputedResult } from "./results.service";
import { loadStudentSessions } from "./scoring-data";

const conflict = (reason: string) => new AppError("CONFLICT", 409, { reason });
type CloseReport = z.infer<typeof CloseReportSchema>;

const runSelect = { id: true, periodId: true, status: true, report: true, preparedAt: true, closedAt: true } as const;
const runDto = (r: Prisma.PeriodCloseRunGetPayload<{ select: typeof runSelect }>) => ({
  id: r.id,
  periodId: r.periodId,
  status: r.status,
  report: r.report as CloseReport,
  preparedAt: r.preparedAt.toISOString(),
  closedAt: r.closedAt?.toISOString() ?? null,
});

/**
 * The FINAL results a change to these students in a closed period no longer match (§7.3): they become stale (the
 * period and the periods above it). The snapshot itself is untouched.
 */
export async function markStale(tx: DbTransaction, periodId: string, studentIds: string[]) {
  const ids = [periodId];
  let current = await tx.academicPeriod.findFirst({ where: { id: periodId }, select: { parentId: true } });
  while (current?.parentId) {
    ids.push(current.parentId);
    current = await tx.academicPeriod.findFirst({ where: { id: current.parentId }, select: { parentId: true } });
  }
  await tx.periodResult.updateMany({
    where: { periodId: { in: ids }, studentId: { in: studentIds }, status: "FINAL", isCurrent: true, isStale: false },
    data: { isStale: true },
  });
}

/** Results row data from a computed result. */
const rowData = (r: ComputedResult) => ({
  tenantId: requireTenantId(),
  studentId: r.studentId,
  subjectId: r.subjectId,
  periodId: r.periodId,
  policyVersionId: r.policyVersionId,
  isComplete: r.complete,
  components: r.components,
  totalPoints: r.totalPoints,
  maxPoints: r.maxPoints,
  percent: r.percent,
  displayPercent: r.displayPercent,
  gradeLabel: r.gradeLabel,
  inputsHash: r.inputsHash,
  computedAt: new Date(),
});

export class ClosingService {
  constructor(private readonly db: Db) {}

  /** Students with lessons or an enrollment in the period. */
  private async periodStudents(
    tx: DbTransaction | Db,
    period: { academicYearId: string; startDate: Date; endDate: Date },
  ) {
    const enrollments = await tx.studentEnrollment.findMany({
      where: {
        academicYearId: period.academicYearId,
        validFrom: { lte: period.endDate },
        OR: [{ validTo: null }, { validTo: { gte: period.startDate } }],
      },
      select: { studentId: true },
    });
    return [...new Set(enrollments.map((e) => e.studentId))];
  }

  private async period(tx: DbTransaction | Db, id: string) {
    const period = await tx.academicPeriod.findFirst({ where: { id } });
    if (!period) throw notFound();
    return period;
  }

  async runs(periodId: string) {
    const rows = await this.db.periodCloseRun.findMany({
      where: { periodId },
      orderBy: { preparedAt: "desc" },
      select: runSelect,
    });
    return rows.map(runDto);
  }

  /** §7.1: DRAFT results for every student × subject and the completeness report. */
  async prepare(periodId: string, userId: string) {
    return this.db.$transaction(
      async (tx) => {
        const period = await this.period(tx, periodId);
        if (period.status === "CLOSED") throw conflict("PERIOD_CLOSED");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`period-close:${periodId}`}, 0))`;
        const studentIds = await this.periodStudents(tx, period);
        const results = await new ResultsService(tx).compute(periodId, studentIds);
        await tx.periodResult.deleteMany({ where: { periodId, status: "DRAFT" } });
        const nextVersion =
          ((await tx.periodResult.aggregate({ where: { periodId }, _max: { version: true } }))._max.version ?? 0) + 1;
        // Earlier FINAL rows of an open period (a reopened one) stay current until the close replaces them.
        const finals = new Set(
          (
            await tx.periodResult.findMany({
              where: { periodId, isCurrent: true },
              select: { studentId: true, subjectId: true },
            })
          ).map((r) => `${r.studentId}|${r.subjectId}`),
        );
        await tx.periodResult.createMany({
          data: results.map((r) => ({
            ...rowData(r),
            version: nextVersion,
            status: "DRAFT" as const,
            isCurrent: !finals.has(`${r.studentId}|${r.subjectId}`),
          })),
        });
        const report = await this.report(tx, period, studentIds, results);
        await tx.periodCloseRun.updateMany({ where: { periodId, status: "PREPARED" }, data: { status: "CANCELLED" } });
        const run = await tx.periodCloseRun.create({
          data: { tenantId: requireTenantId(), periodId, report, preparedById: userId },
          select: runSelect,
        });
        await writeAudit(tx, {
          action: "period.prepare_close",
          entityType: "AcademicPeriod",
          entityId: periodId,
          after: report,
        });
        return runDto(run);
      },
      { timeout: 120_000 },
    );
  }

  private async report(
    tx: DbTransaction,
    period: { id: string; startDate: Date; endDate: Date },
    studentIds: string[],
    results: ComputedResult[],
  ): Promise<CloseReport> {
    // PENDING lessons by the teacher who taught them.
    const settings = await scoreSettings(tx);
    const sessions = await loadStudentSessions(tx, {
      studentIds,
      from: schoolDateFromDb(period.startDate),
      to: schoolDateFromDb(period.endDate),
      rules: await activeLimitRules(tx),
      settings: limitSettings(settings),
    });
    const configs = new Map<string, ReturnType<typeof AssessmentConfigSchema.parse>>();
    const pendingSessionIds = new Set<string>();
    for (const list of sessions.values())
      for (const s of list) {
        if (!configs.has(s.subjectId)) {
          const v = await effectiveVersion(tx, period.id, s.subjectId);
          configs.set(s.subjectId, AssessmentConfigSchema.parse(v!.config));
        }
        if (sessionOutcome(s, configs.get(s.subjectId)!).state === "PENDING") pendingSessionIds.add(s.sessionId);
      }
    const lessons = await tx.lessonSession.findMany({
      where: { id: { in: [...pendingSessionIds] } },
      select: { teacherId: true, substituteTeacherId: true },
    });
    const byTeacher = new Map<string, number>();
    for (const l of lessons) {
      const t = l.substituteTeacherId ?? l.teacherId;
      byTeacher.set(t, (byTeacher.get(t) ?? 0) + 1);
    }
    const teachers = await tx.employee.findMany({
      where: { id: { in: [...byTeacher.keys()] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const emptyComponents: Record<string, number> = {};
    // Policy components only (a higher period's parts and the overall result's subjects are not components).
    const componentTypes = new Set(["DAILY_SCORES", "TESTS", "MANUAL"]);
    for (const r of results)
      for (const c of r.components)
        if (c.percent === null && componentTypes.has(c.type))
          emptyComponents[c.type] = (emptyComponents[c.type] ?? 0) + 1;
    return {
      students: studentIds.length,
      results: results.length,
      incompleteResults: results.filter((r) => !r.complete).length,
      emptyComponents,
      pendingByTeacher: teachers
        .map((t) => ({
          teacherId: t.id,
          teacherName: `${t.lastName} ${t.firstName}`,
          pendingSessions: byTeacher.get(t.id)!,
        }))
        .sort((a, b) => b.pendingSessions - a.pendingSessions),
    };
  }

  /** §7.2: the period closes; results computed now become FINAL (one transaction, audited). */
  async close(periodId: string, runId: string, userId: string) {
    return this.db.$transaction(
      async (tx) => {
        const period = await this.period(tx, periodId);
        if (period.status === "CLOSED") throw conflict("PERIOD_CLOSED");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`period-close:${periodId}`}, 0))`;
        const run = await tx.periodCloseRun.findFirst({ where: { id: runId, periodId, status: "PREPARED" } });
        if (!run) throw conflict("RUN_NOT_PREPARED");
        const studentIds = await this.periodStudents(tx, period);
        const results = await new ResultsService(tx).compute(periodId, studentIds);
        await this.finalize(tx, periodId, results, userId);
        await tx.academicPeriod.update({
          where: { id: periodId },
          data: { status: "CLOSED", closedAt: new Date(), closedById: userId },
        });
        const closed = await tx.periodCloseRun.update({
          where: { id: runId },
          data: { status: "CLOSED", closedById: userId, closedAt: new Date() },
          select: runSelect,
        });
        await writeAudit(tx, {
          action: "period.close",
          entityType: "AcademicPeriod",
          entityId: periodId,
          before: { status: period.status },
          after: { status: "CLOSED", results: results.length },
        });
        return runDto(closed);
      },
      { timeout: 120_000 },
    );
  }

  /** New FINAL rows become current; drafts go; earlier FINAL rows stay as history. */
  private async finalize(tx: DbTransaction, periodId: string, results: ComputedResult[], userId: string) {
    await tx.periodResult.deleteMany({ where: { periodId, status: "DRAFT" } });
    const nextVersion =
      ((await tx.periodResult.aggregate({ where: { periodId }, _max: { version: true } }))._max.version ?? 0) + 1;
    const keys = results.map((r) => ({ studentId: r.studentId, subjectId: r.subjectId }));
    for (const k of keys)
      await tx.periodResult.updateMany({ where: { periodId, ...k, isCurrent: true }, data: { isCurrent: false } });
    await tx.periodResult.createMany({
      data: results.map((r) => ({
        ...rowData(r),
        version: nextVersion,
        status: "FINAL" as const,
        finalizedById: userId,
        finalizedAt: new Date(),
      })),
    });
  }

  /** §7.3: the admin confirms recomputing the stale results of a closed period: a new FINAL version for those. */
  async recompute(periodId: string, reason: string, userId: string) {
    return this.db.$transaction(
      async (tx) => {
        const period = await this.period(tx, periodId);
        if (period.status !== "CLOSED") throw conflict("PERIOD_NOT_CLOSED");
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`period-close:${periodId}`}, 0))`;
        const stale = await tx.periodResult.findMany({
          where: { periodId, isCurrent: true, isStale: true },
          select: { studentId: true },
        });
        const studentIds = [...new Set(stale.map((s) => s.studentId))];
        if (!studentIds.length) return { recomputed: 0 };
        const results = await new ResultsService(tx).compute(periodId, studentIds);
        await this.finalize(tx, periodId, results, userId);
        await writeAudit(tx, {
          action: "period.recompute",
          entityType: "AcademicPeriod",
          entityId: periodId,
          after: { students: studentIds.length, results: results.length },
          reason,
        });
        return { recomputed: results.length };
      },
      { timeout: 120_000 },
    );
  }

  // ---------------------------------------------------------------- manual scores (Q-12)

  /** Teachers enter for the subjects they teach to the student's groups; school roles for anyone. */
  private async assertTeaches(auth: RequestAuth, subjectId: string, studentId: string, onDate: Date) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind === "school") return;
    if (scope.kind !== "teacher") throw forbidden();
    const teaches = await this.db.teacherAssignment.findFirst({
      where: {
        teacherId: scope.employeeId,
        subjectId,
        teachingGroup: { members: { some: { studentId, ...activeOn(schoolDateFromDb(onDate)) } } },
      },
    });
    if (!teaches) throw forbidden();
  }

  async saveManual(auth: RequestAuth, input: z.infer<typeof SaveManualScoreSchema>) {
    return this.db.$transaction(async (tx) => {
      const period = await this.period(tx, input.periodId);
      await this.assertTeaches(
        auth,
        input.subjectId,
        input.studentId,
        period.endDate < new Date() ? period.endDate : period.startDate,
      );
      const version = await effectiveVersion(tx, input.periodId, input.subjectId);
      const config = AssessmentConfigSchema.parse(version!.config);
      const keys = [
        ...config.components.filter((c) => c.type === "MANUAL").map((c) => c.key),
        ...[...config.higherPeriods, config.higherDefault].flatMap((h) =>
          h.finalComponent ? [h.finalComponent.key] : [],
        ),
      ];
      if (!keys.includes(input.componentKey))
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "componentKey", code: "invalid" }] });
      const closed = period.status === "CLOSED";
      if (closed) {
        if (!auth.permissions.includes("assessment.reopen")) throw forbidden({ reason: "PERIOD_CLOSED" });
        if (!input.reason)
          throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "reason", code: "required" }] });
      }
      const where = {
        periodId: input.periodId,
        subjectId: input.subjectId,
        studentId: input.studentId,
        componentKey: input.componentKey,
        supersededById: null,
      };
      const before = await tx.manualAssessmentScore.findFirst({ where });
      // One current row per key (partial unique index): the old row first points at itself, then at its successor.
      if (before)
        await tx.manualAssessmentScore.update({ where: { id: before.id }, data: { supersededById: before.id } });
      const created = await tx.manualAssessmentScore.create({
        data: {
          tenantId: requireTenantId(),
          periodId: input.periodId,
          subjectId: input.subjectId,
          studentId: input.studentId,
          componentKey: input.componentKey,
          points: input.points,
          maxPoints: input.maxPoints,
          note: input.note ?? null,
          enteredById: auth.userId,
        },
      });
      if (before)
        await tx.manualAssessmentScore.update({ where: { id: before.id }, data: { supersededById: created.id } });
      if (closed) await markStale(tx, input.periodId, [input.studentId]);
      await writeAudit(tx, {
        action: "manual_score.save",
        entityType: "ManualAssessmentScore",
        entityId: created.id,
        before: before ? { points: before.points.toString(), maxPoints: before.maxPoints.toString() } : null,
        after: { ...input, reason: undefined },
        reason: input.reason ?? null,
      });
      return {
        id: created.id,
        periodId: created.periodId,
        subjectId: created.subjectId,
        studentId: created.studentId,
        componentKey: created.componentKey,
        points: created.points.toString(),
        maxPoints: created.maxPoints.toString(),
        note: created.note,
        enteredAt: created.enteredAt.toISOString(),
      };
    });
  }

  async listManual(auth: RequestAuth, q: z.infer<typeof ManualScoreQuerySchema>) {
    const rows = await this.db.manualAssessmentScore.findMany({
      where: {
        periodId: q.periodId,
        subjectId: q.subjectId,
        supersededById: null,
        student: { groupMemberships: { some: { teachingGroupId: q.teachingGroupId } } },
      },
      orderBy: { enteredAt: "asc" },
    });
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind !== "school" && !(scope.kind === "teacher" && scope.teachingGroupIds.includes(q.teachingGroupId)))
      throw forbidden();
    return rows.map((r) => ({
      id: r.id,
      periodId: r.periodId,
      subjectId: r.subjectId,
      studentId: r.studentId,
      componentKey: r.componentKey,
      points: r.points.toString(),
      maxPoints: r.maxPoints.toString(),
      note: r.note,
      enteredAt: r.enteredAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- "who has not scored" (§9)

  async missingScores(q: z.infer<typeof MissingScoresQuerySchema>) {
    if (diffSchoolDays(q.from, q.to) < 0 || diffSchoolDays(q.from, q.to) > 366)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "to", code: "range_too_long" }] });
    const lessons = await this.db.lessonSession.findMany({
      where: {
        date: { gte: schoolDateToDb(q.from), lte: schoolDateToDb(q.to) },
        status: { not: "CANCELLED" },
        startsAt: { lte: new Date() },
      },
      select: {
        teacherId: true,
        substituteTeacherId: true,
        _count: { select: { scoreEntries: true, attendance: true } },
      },
    });
    const rows = new Map<string, { lessons: number; unscored: number; unmarked: number }>();
    for (const l of lessons) {
      const id = l.substituteTeacherId ?? l.teacherId;
      const row = rows.get(id) ?? { lessons: 0, unscored: 0, unmarked: 0 };
      row.lessons++;
      if (!l._count.scoreEntries) row.unscored++;
      if (!l._count.attendance) row.unmarked++;
      rows.set(id, row);
    }
    const teachers = await this.db.employee.findMany({
      where: { id: { in: [...rows.keys()] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return teachers
      .map((t) => ({ teacherId: t.id, teacherName: `${t.lastName} ${t.firstName}`, ...rows.get(t.id)! }))
      .sort((a, b) => b.unscored - a.unscored || a.teacherName.localeCompare(b.teacherName, "uz"));
  }
}
