// Lesson lists within the caller's data scope, and the substitute teacher of a lesson (Q-40, T-33).
import type { z } from "zod";
import type { Db, DbTransaction, Prisma } from "@idrok/db";
import type {
  CancelLessonSchema,
  LessonCountQuerySchema,
  LessonSessionQuerySchema,
  MarkHeldSchema,
  PortalWeekQuerySchema,
  SetSubstituteSchema,
} from "@idrok/shared";
import { diffSchoolDays, schoolDateFromDb, schoolDateToDb, weekRange, type IsoWeekday } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { schoolClock } from "../access/school-clock";
import { resolveScope } from "../access/scope";
import { writeAudit } from "../audit/audit.service";

const MAX_RANGE_DAYS = 62;
const conflict = (reason: string) => new AppError("CONFLICT", 409, { reason });

export const lessonSelect = {
  id: true,
  date: true,
  lessonNumber: true,
  startsAt: true,
  endsAt: true,
  teachingGroupId: true,
  teachingGroup: { select: { name: true, kind: true, classGroupId: true, classGroup: { select: { name: true } } } },
  subjectId: true,
  subject: { select: { name: true } },
  teacherId: true,
  teacher: { select: { firstName: true, lastName: true } },
  substituteTeacherId: true,
  substituteTeacher: { select: { firstName: true, lastName: true } },
  periodId: true,
  sequenceNo: true,
  status: true,
  source: true,
  cancelReason: true,
  planItemId: true,
  planItem: { select: { lessonType: true, homework: true, topic: { select: { title: true } } } },
  actualTopicNote: true,
  heldMarkedAt: true,
} satisfies Prisma.LessonSessionSelect;
type LessonRow = Prisma.LessonSessionGetPayload<{ select: typeof lessonSelect }>;

const name = (p: { firstName: string; lastName: string } | null) => (p ? `${p.lastName} ${p.firstName}` : null);

export function lessonDto(l: LessonRow) {
  const g = l.teachingGroup;
  return {
    id: l.id,
    date: schoolDateFromDb(l.date),
    lessonNumber: l.lessonNumber,
    startsAt: l.startsAt.toISOString(),
    endsAt: l.endsAt.toISOString(),
    teachingGroupId: l.teachingGroupId,
    teachingGroupName: g.kind === "SUBGROUP" && g.classGroup ? `${g.classGroup.name} · ${g.name}` : g.name,
    classGroupId: g.classGroupId,
    subjectId: l.subjectId,
    subjectName: l.subject.name,
    teacherId: l.teacherId,
    teacherName: name(l.teacher)!,
    substituteTeacherId: l.substituteTeacherId,
    substituteTeacherName: name(l.substituteTeacher),
    periodId: l.periodId,
    sequenceNo: l.sequenceNo,
    status: l.status,
    source: l.source,
    cancelReason: l.cancelReason,
    planItemId: l.planItemId,
    topicTitle: l.planItem?.topic.title ?? null,
    lessonType: l.planItem?.lessonType ?? null,
    homework: l.planItem?.homework ?? null,
    actualTopicNote: l.actualTopicNote,
    heldMarkedAt: l.heldMarkedAt?.toISOString() ?? null,
  };
}

export class LessonsService {
  constructor(private readonly db: Db) {}

  /** Teachers see their own and substituted lessons, their groups' and (class teachers) their class's. */
  async scopeWhere(auth: RequestAuth): Promise<Prisma.LessonSessionWhereInput> {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind === "school") return {};
    if (scope.kind === "teacher")
      return {
        OR: [
          { teacherId: scope.employeeId },
          { substituteTeacherId: scope.employeeId },
          { teachingGroupId: { in: scope.teachingGroupIds } },
          { teachingGroup: { classGroupId: { in: scope.homeroomClassIds } } },
        ],
      };
    return { id: { in: [] } };
  }

  async list(auth: RequestAuth, q: z.infer<typeof LessonSessionQuerySchema>) {
    const days = diffSchoolDays(q.from, q.to);
    if (days < 0 || days > MAX_RANGE_DAYS)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "to", code: "range_too_long" }] });
    const lessons = await this.db.lessonSession.findMany({
      where: {
        AND: [
          await this.scopeWhere(auth),
          { date: { gte: schoolDateToDb(q.from), lte: schoolDateToDb(q.to) } },
          q.includeCancelled ? {} : { status: { not: "CANCELLED" } },
          q.teachingGroupId ? { teachingGroupId: q.teachingGroupId } : {},
          q.classGroupId ? { teachingGroup: { classGroupId: q.classGroupId } } : {},
          q.subjectId ? { subjectId: q.subjectId } : {},
          q.teacherId ? { OR: [{ teacherId: q.teacherId }, { substituteTeacherId: q.teacherId }] } : {},
        ],
      },
      orderBy: [{ date: "asc" }, { startsAt: "asc" }, { lessonNumber: "asc" }],
      select: lessonSelect,
    });
    return lessons.map(lessonDto);
  }

  async setSubstitute(id: string, input: z.infer<typeof SetSubstituteSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.lessonSession.findUnique({ where: { id }, select: lessonSelect });
      if (!before) throw notFound();
      if (before.status === "CANCELLED") throw new AppError("CONFLICT", 409, { reason: "LESSON_CANCELLED" });
      if (input.substituteTeacherId) {
        if (input.substituteTeacherId === before.teacherId)
          throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "substituteTeacherId", code: "invalid" }] });
        const teacher = await tx.employee.findFirst({ where: { id: input.substituteTeacherId, status: "ACTIVE" } });
        if (!teacher) throw notFound();
      }
      const lesson = await tx.lessonSession.update({
        where: { id },
        data: { substituteTeacherId: input.substituteTeacherId },
        select: lessonSelect,
      });
      await writeAudit(tx, {
        action: "lesson.substitute",
        entityType: "LessonSession",
        entityId: id,
        before: { substituteTeacherId: before.substituteTeacherId },
        after: input,
      });
      return lessonDto(lesson);
    });
  }

  /** A lesson the caller may act on as its teacher: the teacher, the substitute, or a school-wide role. */
  private async ownLesson(tx: DbTransaction | Db, auth: RequestAuth, id: string) {
    const lesson = await tx.lessonSession.findFirst({
      where: { AND: [{ id }, await this.scopeWhere(auth)] },
      select: lessonSelect,
    });
    if (!lesson) throw notFound();
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind !== "school") {
      const employeeId = scope.kind === "teacher" ? scope.employeeId : null;
      if (lesson.substituteTeacherId ? lesson.substituteTeacherId !== employeeId : lesson.teacherId !== employeeId)
        throw forbidden();
    }
    return lesson;
  }

  /**
   * Marks a lesson as held (§4.7), optionally with another topic of the group's plan or a note of what was taught.
   * Only lessons of today or the past; marking again corrects the topic.
   */
  async markHeld(auth: RequestAuth, id: string, input: z.infer<typeof MarkHeldSchema>) {
    const { today } = await schoolClock(this.db);
    return this.db.$transaction(async (tx) => {
      const lesson = await this.ownLesson(tx, auth, id);
      if (lesson.status === "CANCELLED") throw conflict("LESSON_CANCELLED");
      if (schoolDateFromDb(lesson.date) > today) throw conflict("LESSON_IN_FUTURE");
      if (input.planItemId) {
        // The topic must come from the plan in force for this group and subject.
        const assignment = await tx.planAssignment.findFirst({
          where: { teachingGroupId: lesson.teachingGroupId, subjectId: lesson.subjectId, status: "ACTIVE" },
          select: { planId: true },
        });
        const item = await tx.planItem.findUnique({ where: { id: input.planItemId }, select: { planId: true } });
        if (!assignment || !item || item.planId !== assignment.planId)
          throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "planItemId", code: "invalid" }] });
      }
      const updated = await tx.lessonSession.update({
        where: { id },
        data: {
          status: "HELD",
          heldMarkedAt: new Date(),
          heldMarkedById: auth.userId,
          ...(input.planItemId !== undefined ? { planItemId: input.planItemId } : {}),
          ...(input.actualTopicNote !== undefined ? { actualTopicNote: input.actualTopicNote } : {}),
        },
        select: lessonSelect,
      });
      await writeAudit(tx, {
        action: "lesson.held",
        entityType: "LessonSession",
        entityId: id,
        before: { status: lesson.status, planItemId: lesson.planItemId },
        after: input,
      });
      return lessonDto(updated);
    });
  }

  /** Cancels a lesson by hand (with a reason; regeneration never brings it back) and points at the plan to reflow. */
  async cancel(id: string, input: z.infer<typeof CancelLessonSchema>) {
    return this.db.$transaction(async (tx) => {
      const lesson = await tx.lessonSession.findUnique({ where: { id }, select: lessonSelect });
      if (!lesson) throw notFound();
      if (lesson.status !== "SCHEDULED") throw conflict("LESSON_NOT_SCHEDULED");
      const updated = await tx.lessonSession.update({
        where: { id },
        data: { status: "CANCELLED", cancelReason: input.reason, planItemId: null },
        select: lessonSelect,
      });
      const assignment = await tx.planAssignment.findFirst({
        where: { teachingGroupId: lesson.teachingGroupId, subjectId: lesson.subjectId, status: "ACTIVE" },
        select: { id: true },
      });
      await writeAudit(tx, {
        action: "lesson.cancel",
        entityType: "LessonSession",
        entityId: id,
        before: { status: lesson.status, planItemId: lesson.planItemId },
        after: input,
      });
      return { lesson: lessonDto(updated), planAssignmentId: assignment?.id ?? null };
    });
  }

  /** "Bugungi darslarim": today's lessons the caller teaches or substitutes, with their topics. */
  async today(auth: RequestAuth) {
    const { today } = await schoolClock(this.db);
    const employee = await this.db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } });
    if (!employee) return [];
    const lessons = await this.db.lessonSession.findMany({
      where: {
        date: schoolDateToDb(today),
        status: { not: "CANCELLED" },
        OR: [{ teacherId: employee.id, substituteTeacherId: null }, { substituteTeacherId: employee.id }],
      },
      orderBy: [{ startsAt: "asc" }, { lessonNumber: "asc" }],
      select: lessonSelect,
    });
    return lessons.map(lessonDto);
  }

  /** Portal: a student's lessons of one week (their class and subgroups on each day), topic and homework included. */
  async portalWeek(auth: RequestAuth, q: z.infer<typeof PortalWeekQuerySchema>) {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    let studentId: string;
    if (scope.kind === "student") studentId = scope.studentId;
    else if (scope.kind === "guardian") {
      if (!q.studentId)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "studentId", code: "required" }] });
      const link = await this.db.studentGuardian.findFirst({
        where: { guardianId: scope.guardianId, studentId: q.studentId, revokedAt: null, canViewData: true },
      });
      if (!link) throw notFound();
      studentId = q.studentId;
    } else throw forbidden();
    const settings = await this.db.schoolSettings.findFirst({ select: { weekStartsOn: true } });
    const { from, to } = weekRange(q.date ?? today, (settings?.weekStartsOn ?? 1) as IsoWeekday);
    const memberships = await this.db.teachingGroupMember.findMany({
      where: {
        studentId,
        validFrom: { lte: schoolDateToDb(to) },
        OR: [{ validTo: null }, { validTo: { gte: schoolDateToDb(from) } }],
      },
      select: { teachingGroupId: true, validFrom: true, validTo: true },
    });
    const lessons = await this.db.lessonSession.findMany({
      where: {
        teachingGroupId: { in: memberships.map((m) => m.teachingGroupId) },
        date: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) },
      },
      orderBy: [{ date: "asc" }, { startsAt: "asc" }, { lessonNumber: "asc" }],
      select: lessonSelect,
    });
    // Only the days the student belonged to the group (a transfer mid-week).
    const member = (groupId: string, date: Date) =>
      memberships.some(
        (m) => m.teachingGroupId === groupId && m.validFrom <= date && (m.validTo === null || m.validTo >= date),
      );
    return {
      from,
      to,
      studentId,
      lessons: lessons
        .filter((l) => member(l.teachingGroupId, l.date))
        .map((l) => {
          const d = lessonDto(l);
          return {
            id: d.id,
            date: d.date,
            lessonNumber: d.lessonNumber,
            startsAt: d.startsAt,
            endsAt: d.endsAt,
            subjectName: d.subjectName,
            teacherName: d.substituteTeacherName ?? d.teacherName,
            status: d.status,
            topicTitle: d.topicTitle,
            homework: d.homework,
          };
        }),
    };
  }

  /** Planned hours against lessons per group and subject (§3 "darslar soni"), optionally for one period. */
  async lessonCounts(q: z.infer<typeof LessonCountQuerySchema>) {
    const period = q.periodId ? await this.db.academicPeriod.findUnique({ where: { id: q.periodId } }) : null;
    if (q.periodId && (!period || period.academicYearId !== q.academicYearId)) throw notFound();
    const where: Prisma.LessonSessionWhereInput = {
      academicYearId: q.academicYearId,
      status: { not: "CANCELLED" },
      ...(period ? { date: { gte: period.startDate, lte: period.endDate } } : {}),
      ...(q.classGroupId ? { teachingGroup: { classGroupId: q.classGroupId } } : {}),
    };
    const [counts, held] = await Promise.all([
      this.db.lessonSession.groupBy({ by: ["teachingGroupId", "subjectId"], where, _count: { _all: true } }),
      this.db.lessonSession.groupBy({
        by: ["teachingGroupId", "subjectId"],
        where: { ...where, status: "HELD" },
        _count: { _all: true },
      }),
    ]);
    const groupIds = [...new Set(counts.map((c) => c.teachingGroupId))];
    const subjectIds = [...new Set(counts.map((c) => c.subjectId))];
    const [groups, subjects, assignments] = await Promise.all([
      this.db.teachingGroup.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true, kind: true, classGroup: { select: { name: true } } },
      }),
      this.db.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } }),
      this.db.planAssignment.findMany({
        where: { teachingGroupId: { in: groupIds }, status: "ACTIVE" },
        select: {
          teachingGroupId: true,
          subjectId: true,
          plan: { select: { items: { select: { hours: true, periodId: true } } } },
        },
      }),
    ]);
    const groupName = new Map(
      groups.map((g) => [g.id, g.kind === "SUBGROUP" && g.classGroup ? `${g.classGroup.name} · ${g.name}` : g.name]),
    );
    const subjectName = new Map(subjects.map((x) => [x.id, x.name]));
    const heldBy = new Map(held.map((h) => [`${h.teachingGroupId}|${h.subjectId}`, h._count._all]));
    const planned = new Map(
      assignments.map((a) => [
        `${a.teachingGroupId}|${a.subjectId}`,
        // Items bound to the period; with no period chosen, the whole plan.
        a.plan.items.filter((i) => !period || i.periodId === period.id).reduce((sum, i) => sum + i.hours, 0),
      ]),
    );
    return counts
      .map((c) => {
        const key = `${c.teachingGroupId}|${c.subjectId}`;
        return {
          teachingGroupId: c.teachingGroupId,
          teachingGroupName: groupName.get(c.teachingGroupId) ?? "",
          subjectId: c.subjectId,
          subjectName: subjectName.get(c.subjectId) ?? "",
          lessons: c._count._all,
          held: heldBy.get(key) ?? 0,
          plannedHours: planned.has(key) ? planned.get(key)! : null,
        };
      })
      .sort(
        (a, b) => a.teachingGroupName.localeCompare(b.teachingGroupName) || a.subjectName.localeCompare(b.subjectName),
      );
  }
}
