// Lesson lists within the caller's data scope, and the substitute teacher of a lesson (Q-40, T-33).
import type { z } from "zod";
import type { Db, Prisma } from "@idrok/db";
import type { LessonSessionQuerySchema, SetSubstituteSchema } from "@idrok/shared";
import { diffSchoolDays, schoolDateFromDb, schoolDateToDb } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { AppError, notFound } from "../../http/errors";
import { schoolClock } from "../access/school-clock";
import { resolveScope } from "../access/scope";
import { writeAudit } from "../audit/audit.service";

const MAX_RANGE_DAYS = 62;

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
      orderBy: [{ date: "asc" }, { lessonNumber: "asc" }],
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
}
