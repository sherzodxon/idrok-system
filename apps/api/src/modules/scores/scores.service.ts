// Scores on lessons (scoring.md §3): the ledger write with all its rules, reversals, attendance and the lesson journal.
//
// Every write for a student runs in one transaction under an advisory lock on the student (Q-46), so the limits of
// every window are checked against a stable set of entries. Entries are never updated or deleted (CLAUDE.md §4).
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type { CreateScoreInput, ReverseScoreSchema, ScoreQuerySchema, SetAttendanceSchema } from "@idrok/shared";
import { D, sum } from "@idrok/shared/decimal";
import {
  diffSchoolDays,
  monthRange,
  schoolDateFromDb,
  schoolDateToDb,
  weekRange,
  type SchoolDate,
} from "@idrok/shared/time";
import {
  checkLimits,
  criterionBoundsError,
  remainingToday,
  sessionMaxPoints,
  type EntryScope,
  type ExistingEntry,
} from "../../domain/score-limits";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { activeOn, resolveScope } from "../access/scope";
import { markStale } from "../assessment/closing.service";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { LessonsService } from "../lessons/lessons.service";
import { activeLimitRules, criterionDto, criterionSelect, limitSettings, scoreSettings } from "./score-config.service";

const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError("CONFLICT", 409, { reason, ...details });
const reasonRequired = () => new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "reason", code: "required" }] });

const lessonSelect = {
  id: true,
  date: true,
  startsAt: true,
  status: true,
  academicYearId: true,
  periodId: true,
  period: { select: { status: true, parent: { select: { status: true, parent: { select: { status: true } } } } } },
  teachingGroupId: true,
  teachingGroup: { select: { name: true } },
  subjectId: true,
  subject: { select: { name: true } },
  teacherId: true,
  substituteTeacherId: true,
  planItem: { select: { topicId: true, topic: { select: { title: true } } } },
} satisfies Prisma.LessonSessionSelect;
type ScoringLesson = Prisma.LessonSessionGetPayload<{ select: typeof lessonSelect }>;

export const entrySelect = {
  id: true,
  studentId: true,
  lessonSessionId: true,
  subjectId: true,
  subject: { select: { name: true } },
  teacherId: true,
  schoolDate: true,
  criterionId: true,
  criterion: { select: { name: true } },
  topic: { select: { title: true } },
  points: true,
  kind: true,
  reversesEntryId: true,
  reversedBy: { select: { id: true } },
  note: true,
  reason: true,
  createdAt: true,
  createdById: true,
} satisfies Prisma.ScoreEntrySelect;
type EntryRow = Prisma.ScoreEntryGetPayload<{ select: typeof entrySelect }>;

export function entryDto(e: EntryRow) {
  return {
    id: e.id,
    studentId: e.studentId,
    lessonSessionId: e.lessonSessionId,
    subjectId: e.subjectId,
    subjectName: e.subject.name,
    teacherId: e.teacherId,
    schoolDate: schoolDateFromDb(e.schoolDate),
    criterionId: e.criterionId,
    criterionName: e.criterion?.name ?? null,
    topicTitle: e.topic?.title ?? null,
    points: e.points.toString(),
    kind: e.kind,
    reversesEntryId: e.reversesEntryId,
    reversed: e.reversedBy !== null,
    note: e.note,
    reason: e.reason,
    createdAt: e.createdAt.toISOString(),
  };
}

const isClosed = (l: ScoringLesson) =>
  [l.period.status, l.period.parent?.status, l.period.parent?.parent?.status].includes("CLOSED");

const lockStudent = (tx: DbTransaction, studentId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scores:${requireTenantId()}:${studentId}`}, 0))`;

export class ScoresService {
  private readonly lessons: LessonsService;

  constructor(private readonly db: Db) {
    this.lessons = new LessonsService(db);
  }

  /** A lesson the caller can see (journal) — and whether they may write to it: its teacher, substitute or school. */
  private async lessonFor(tx: DbTransaction | Db, auth: RequestAuth, id: string) {
    const lesson = await tx.lessonSession.findFirst({
      where: { AND: [{ id }, await this.lessons.scopeWhere(auth)] },
      select: lessonSelect,
    });
    if (!lesson) throw notFound();
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const employeeId = scope.kind === "teacher" ? scope.employeeId : null;
    const canWrite = scope.kind === "school" || (lesson.substituteTeacherId ?? lesson.teacherId) === employeeId;
    return { lesson, canWrite, today };
  }

  /** Why the caller cannot score this lesson now, or null (§3 rules 2–5). */
  private lockReason(auth: RequestAuth, lesson: ScoringLesson, today: SchoolDate, lateEntryDays: number) {
    if (lesson.status === "CANCELLED") return "LESSON_CANCELLED";
    if (lesson.startsAt > new Date()) return "LESSON_IN_FUTURE";
    if (isClosed(lesson) && !auth.permissions.includes("assessment.reopen")) return "PERIOD_CLOSED";
    if (
      diffSchoolDays(schoolDateFromDb(lesson.date), today) > lateEntryDays &&
      !auth.permissions.includes("scores.late_entry")
    )
      return "LATE_ENTRY";
    return null;
  }

  /** Grade of the student on the lesson's day, and that they belong to the lesson's group then. */
  private async studentOnLesson(tx: DbTransaction, lesson: ScoringLesson, studentId: string) {
    const member = await tx.teachingGroupMember.findFirst({
      where: { teachingGroupId: lesson.teachingGroupId, studentId, ...activeOn(schoolDateFromDb(lesson.date)) },
      select: { id: true },
    });
    const enrollment = await tx.studentEnrollment.findFirst({
      where: { studentId, academicYearId: lesson.academicYearId, ...activeOn(schoolDateFromDb(lesson.date)) },
      select: { classGroup: { select: { gradeId: true } } },
    });
    if (!member || !enrollment)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "studentId", code: "not_in_group" }] });
    return enrollment.classGroup.gradeId;
  }

  /** The student's entries that any window of this entry can reach (day, week, month, period). */
  private async entriesAround(tx: DbTransaction | Db, studentIds: string[], date: SchoolDate, periodId: string) {
    const w = weekRange(date);
    const m = monthRange(date);
    const from = w.from < m.from ? w.from : m.from;
    const to = w.to > m.to ? w.to : m.to;
    const rows = await tx.scoreEntry.findMany({
      where: {
        studentId: { in: studentIds },
        OR: [{ schoolDate: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) } }, { periodId }],
      },
      select: {
        studentId: true,
        lessonSessionId: true,
        schoolDate: true,
        periodId: true,
        subjectId: true,
        teacherId: true,
        gradeId: true,
        teachingGroupId: true,
        criterionId: true,
        points: true,
      },
    });
    return rows.map((r) => ({ ...r, schoolDate: schoolDateFromDb(r.schoolDate) }));
  }

  /** One entry (§3). Repeating the idempotency key returns the first result. */
  async create(auth: RequestAuth, input: CreateScoreInput) {
    const replay = await this.replay(input.idempotencyKey, input);
    if (replay) return replay;
    const settings = await scoreSettings(this.db);
    return this.db.$transaction(async (tx) => {
      const { lesson, canWrite, today } = await this.lessonFor(tx, auth, input.lessonSessionId);
      if (!canWrite) throw forbidden();
      const locked = this.lockReason(auth, lesson, today, settings.lateEntryDays);
      if (locked === "LATE_ENTRY" || locked === "PERIOD_CLOSED") throw forbidden({ reason: locked });
      if (locked) throw conflict(locked);
      if (isClosed(lesson) && !input.reason) throw reasonRequired();
      if (input.criterionId) {
        const criterion = await tx.scoreCriterion.findFirst({ where: { id: input.criterionId, isActive: true } });
        if (!criterion)
          throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "criterionId", code: "invalid" }] });
        const outOfBounds = criterionBoundsError(input.points, criterion);
        if (outOfBounds)
          throw new AppError("VALIDATION_ERROR", 400, {
            fields: [
              {
                path: "points",
                code: outOfBounds.bound === "min" ? "below_criterion_min" : "above_criterion_max",
                limit: outOfBounds.value.toString(),
              },
            ],
          });
      }
      const gradeId = await this.studentOnLesson(tx, lesson, input.studentId);

      await lockStudent(tx, input.studentId);
      // A concurrent request with the same key may have won the lock first.
      const again = await this.replay(input.idempotencyKey, input, tx);
      if (again) return again;
      const attendance = await tx.lessonAttendance.findUnique({
        where: { lessonSessionId_studentId: { lessonSessionId: lesson.id, studentId: input.studentId } },
        select: { status: true },
      });
      if (attendance?.status.startsWith("ABSENT") && !settings.allowScoreOnAbsent) throw conflict("STUDENT_ABSENT");

      const date = schoolDateFromDb(lesson.date);
      const scope: EntryScope = {
        lessonSessionId: lesson.id,
        schoolDate: date,
        periodId: lesson.periodId,
        subjectId: lesson.subjectId,
        teacherId: lesson.substituteTeacherId ?? lesson.teacherId,
        gradeId,
        teachingGroupId: lesson.teachingGroupId,
        criterionId: input.criterionId ?? null,
      };
      const existing = await this.entriesAround(tx, [input.studentId], date, lesson.periodId);
      const violation = checkLimits(await activeLimitRules(tx), limitSettings(settings), existing, scope, input.points);
      if (violation)
        throw new AppError("SCORE_LIMIT_EXCEEDED", 409, {
          window: violation.window,
          scopeType: violation.scopeType,
          max: violation.max.toString(),
          used: violation.used.toString(),
          remaining: violation.remaining.toString(),
        });

      const entry = await tx.scoreEntry.create({
        data: {
          tenantId: requireTenantId(),
          studentId: input.studentId,
          teacherId: scope.teacherId,
          subjectId: lesson.subjectId,
          teachingGroupId: lesson.teachingGroupId,
          gradeId,
          lessonSessionId: lesson.id,
          topicId: lesson.planItem?.topicId ?? null,
          academicYearId: lesson.academicYearId,
          periodId: lesson.periodId,
          schoolDate: lesson.date,
          criterionId: input.criterionId ?? null,
          points: input.points,
          note: input.note ?? null,
          reason: input.reason ?? null,
          idempotencyKey: input.idempotencyKey,
          createdById: auth.userId,
        },
        select: entrySelect,
      });
      await this.markHeld(tx, auth, lesson);
      if (isClosed(lesson)) await markStale(tx, lesson.periodId, [input.studentId]);
      await writeAudit(tx, {
        action: "score.create",
        entityType: "ScoreEntry",
        entityId: entry.id,
        after: {
          studentId: input.studentId,
          lessonSessionId: lesson.id,
          points: input.points,
          criterionId: input.criterionId,
        },
        reason: input.reason ?? null,
      });
      return entryDto(entry);
    });
  }

  /** A batch ("everyone N points"): each entry on its own; refused ones come back with their error. */
  async createMany(auth: RequestAuth, inputs: CreateScoreInput[]) {
    const results = [];
    for (const input of inputs) {
      try {
        results.push({ ok: true as const, entry: await this.create(auth, input) });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({
          ok: false as const,
          idempotencyKey: input.idempotencyKey,
          error: { code: err.code, ...(err.details ? { details: err.details } : {}) },
        });
      }
    }
    return results;
  }

  private async replay(
    key: string,
    input: { studentId?: string; lessonSessionId?: string },
    tx: DbTransaction | Db = this.db,
  ) {
    const found = await tx.scoreEntry.findFirst({ where: { idempotencyKey: key }, select: entrySelect });
    if (!found) return null;
    if (
      (input.studentId && found.studentId !== input.studentId) ||
      (input.lessonSessionId && found.lessonSessionId !== input.lessonSessionId)
    )
      throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
    return entryDto(found);
  }

  /** Scoring or attendance makes a scheduled lesson held (§3 rule 8, Q-17). */
  private async markHeld(tx: DbTransaction, auth: RequestAuth, lesson: ScoringLesson) {
    if (lesson.status !== "SCHEDULED") return;
    await tx.lessonSession.update({
      where: { id: lesson.id },
      data: { status: "HELD", heldMarkedAt: new Date(), heldMarkedById: auth.userId },
    });
  }

  /**
   * Reverses one entry (§3.2). The author may within `lateEntryDays` (reason optional); afterwards, or anyone else's
   * entry, needs `scores.correct` and a reason. In a closed period also `assessment.reopen` and a reason.
   */
  async reverse(auth: RequestAuth, id: string, input: z.infer<typeof ReverseScoreSchema>) {
    const replay = await this.replay(input.idempotencyKey, {});
    if (replay) {
      if (replay.reversesEntryId !== id) throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
      return replay;
    }
    const settings = await scoreSettings(this.db);
    return this.db.$transaction(async (tx) => {
      const original = await tx.scoreEntry.findFirst({
        where: { id },
        select: {
          ...entrySelect,
          gradeId: true,
          teachingGroupId: true,
          academicYearId: true,
          periodId: true,
          topicId: true,
        },
      });
      if (!original) throw notFound();
      const { lesson, today } = await this.lessonFor(tx, auth, original.lessonSessionId);
      if (original.kind !== "NORMAL") throw conflict("NOT_REVERSIBLE");
      const own = original.createdById === auth.userId;
      const inTime = diffSchoolDays(schoolDateFromDb(original.schoolDate), today) <= settings.lateEntryDays;
      if (!(own && inTime)) {
        if (!auth.permissions.includes("scores.correct"))
          throw forbidden({ reason: own ? "LATE_ENTRY" : "NOT_OWN_ENTRY" });
        if (!input.reason) throw reasonRequired();
      }
      if (isClosed(lesson)) {
        if (!auth.permissions.includes("assessment.reopen")) throw forbidden({ reason: "PERIOD_CLOSED" });
        if (!input.reason) throw reasonRequired();
      }
      await lockStudent(tx, original.studentId);
      if (await tx.scoreEntry.findFirst({ where: { reversesEntryId: id }, select: { id: true } }))
        throw conflict("ALREADY_REVERSED");
      const reversal = await tx.scoreEntry.create({
        data: {
          tenantId: requireTenantId(),
          studentId: original.studentId,
          teacherId: original.teacherId,
          subjectId: original.subjectId,
          teachingGroupId: original.teachingGroupId,
          gradeId: original.gradeId,
          lessonSessionId: original.lessonSessionId,
          topicId: original.topicId,
          academicYearId: original.academicYearId,
          periodId: original.periodId,
          schoolDate: original.schoolDate,
          criterionId: original.criterionId,
          points: original.points.negated(),
          kind: "REVERSAL",
          reversesEntryId: id,
          reason: input.reason ?? null,
          idempotencyKey: input.idempotencyKey,
          createdById: auth.userId,
        },
        select: entrySelect,
      });
      if (isClosed(lesson)) await markStale(tx, lesson.periodId, [original.studentId]);
      await writeAudit(tx, {
        action: "score.reverse",
        entityType: "ScoreEntry",
        entityId: reversal.id,
        before: { entryId: id, points: original.points.toString() },
        reason: input.reason ?? null,
      });
      return entryDto(reversal);
    });
  }

  /** A student's entries in a date range (gradebook; teachers only their groups' students). */
  async list(auth: RequestAuth, q: z.infer<typeof ScoreQuerySchema>) {
    if (diffSchoolDays(q.from, q.to) < 0 || diffSchoolDays(q.from, q.to) > 366)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "to", code: "range_too_long" }] });
    const rows = await this.db.scoreEntry.findMany({
      where: {
        studentId: q.studentId,
        schoolDate: { gte: schoolDateToDb(q.from), lte: schoolDateToDb(q.to) },
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        lessonSession: await this.lessons.scopeWhere(auth),
      },
      orderBy: [{ schoolDate: "asc" }, { createdAt: "asc" }],
      select: entrySelect,
    });
    return rows.map(entryDto);
  }

  /** Bulk attendance of a lesson (Q-17: makes it held; Q-41: a closed period needs `assessment.reopen`). */
  async setAttendance(auth: RequestAuth, id: string, input: z.infer<typeof SetAttendanceSchema>) {
    return this.db.$transaction(async (tx) => {
      const { lesson, canWrite } = await this.lessonFor(tx, auth, id);
      if (!canWrite) throw forbidden();
      if (lesson.status === "CANCELLED") throw conflict("LESSON_CANCELLED");
      if (lesson.startsAt > new Date()) throw conflict("LESSON_IN_FUTURE");
      if (isClosed(lesson) && !auth.permissions.includes("assessment.reopen"))
        throw forbidden({ reason: "PERIOD_CLOSED" });
      const members = await tx.teachingGroupMember.findMany({
        where: { teachingGroupId: lesson.teachingGroupId, ...activeOn(schoolDateFromDb(lesson.date)) },
        select: { studentId: true },
      });
      const allowed = new Set(members.map((m) => m.studentId));
      const bad = input.marks.findIndex((m) => !allowed.has(m.studentId));
      if (bad >= 0)
        throw new AppError("VALIDATION_ERROR", 400, {
          fields: [{ path: `marks.${bad}.studentId`, code: "not_in_group" }],
        });
      const before = await tx.lessonAttendance.findMany({
        where: { lessonSessionId: id },
        select: { studentId: true, status: true, note: true },
      });
      const prev = new Map(before.map((b) => [b.studentId, b]));
      const changed = input.marks.filter(
        (m) => prev.get(m.studentId)?.status !== m.status || (prev.get(m.studentId)?.note ?? null) !== (m.note ?? null),
      );
      const now = new Date();
      for (const m of changed)
        await tx.lessonAttendance.upsert({
          where: { lessonSessionId_studentId: { lessonSessionId: id, studentId: m.studentId } },
          create: {
            tenantId: requireTenantId(),
            lessonSessionId: id,
            studentId: m.studentId,
            status: m.status,
            note: m.note ?? null,
            markedById: auth.userId,
            markedAt: now,
          },
          update: { status: m.status, note: m.note ?? null, markedById: auth.userId, markedAt: now },
        });
      if (changed.length) {
        await this.markHeld(tx, auth, lesson);
        if (isClosed(lesson))
          await markStale(
            tx,
            lesson.periodId,
            changed.map((m) => m.studentId),
          );
        await writeAudit(tx, {
          action: "lesson.attendance",
          entityType: "LessonSession",
          entityId: id,
          before: changed.map((m) => ({ studentId: m.studentId, status: prev.get(m.studentId)?.status ?? null })),
          after: changed,
        });
      }
      return this.journal(auth, id);
    });
  }

  /** The lesson journal (§8): students, attendance, this lesson's entries and what still fits (Q-43). */
  async journal(auth: RequestAuth, id: string) {
    const settings = await scoreSettings(this.db);
    const { lesson, canWrite, today } = await this.lessonFor(this.db, auth, id);
    const date = schoolDateFromDb(lesson.date);
    const [members, attendance, entries, criteria, rules] = await Promise.all([
      this.db.teachingGroupMember.findMany({
        where: { teachingGroupId: lesson.teachingGroupId, ...activeOn(date) },
        select: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              enrollments: {
                where: { academicYearId: lesson.academicYearId, ...activeOn(date) },
                select: { classGroup: { select: { gradeId: true } } },
                take: 1,
              },
            },
          },
        },
      }),
      this.db.lessonAttendance.findMany({
        where: { lessonSessionId: id },
        select: { studentId: true, status: true, note: true },
      }),
      this.db.scoreEntry.findMany({
        where: { lessonSessionId: id },
        orderBy: { createdAt: "asc" },
        select: entrySelect,
      }),
      this.db.scoreCriterion.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: criterionSelect,
      }),
      activeLimitRules(this.db),
    ]);
    const students = members
      .map((m) => m.student)
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "uz"));
    const around: (ExistingEntry & { studentId: string })[] = await this.entriesAround(
      this.db,
      students.map((s) => s.id),
      date,
      lesson.periodId,
    );
    const limits = limitSettings(settings);
    const scopeFor = (gradeId: string): EntryScope => ({
      lessonSessionId: id,
      schoolDate: date,
      periodId: lesson.periodId,
      subjectId: lesson.subjectId,
      teacherId: lesson.substituteTeacherId ?? lesson.teacherId,
      gradeId,
      teachingGroupId: lesson.teachingGroupId,
      criterionId: null,
    });
    const anyGrade = students.find((s) => s.enrollments[0])?.enrollments[0]?.classGroup.gradeId ?? "";
    const maxPoints = sessionMaxPoints(rules, limits, scopeFor(anyGrade));
    const marks = new Map(attendance.map((a) => [a.studentId, a]));
    const locked = canWrite ? this.lockReason(auth, lesson, today, settings.lateEntryDays) : "READ_ONLY";
    return {
      lessonSessionId: id,
      date,
      status: lesson.status,
      subjectName: lesson.subject.name,
      teachingGroupName: lesson.teachingGroup.name,
      topicTitle: lesson.planItem?.topic.title ?? null,
      maxPoints: maxPoints.toString(),
      locked,
      criteria: criteria.map(criterionDto),
      students: students.map((s) => {
        const mine = entries.filter((e) => e.studentId === s.id);
        const lessonPoints = sum(mine.map((e) => e.points));
        const scope = scopeFor(s.enrollments[0]?.classGroup.gradeId ?? anyGrade);
        const theirs = around.filter((e) => e.studentId === s.id);
        const lessonLeft = D(maxPoints).minus(lessonPoints);
        return {
          studentId: s.id,
          name: `${s.lastName} ${s.firstName}`,
          attendance: marks.get(s.id)?.status ?? null,
          attendanceNote: marks.get(s.id)?.note ?? null,
          entries: mine.map(entryDto),
          lessonPoints: lessonPoints.toString(),
          remainingLesson: (lessonLeft.isNegative() ? D(0) : lessonLeft).toString(),
          remainingToday: remainingToday(rules, limits, theirs, scope).toString(),
        };
      }),
    };
  }
}
