// Loads what the scoring arithmetic needs (scoring.md §4): for each student, every lesson of the groups they belonged
// to on that day, with its attendance mark, its entries and its session maximum. Read-only.
import type { Db, DbTransaction } from "@idrok/db";
import { schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { sessionMaxPoints, type LimitRule, type LimitSettings } from "../../domain/score-limits";
import type { AttendanceStatus, ScoreLine, StudentSession } from "../../domain/scoring";

export interface LoadedSession extends StudentSession {
  sessionId: string;
  date: SchoolDate;
  lessonNumber: number;
  startsAt: Date;
  subjectId: string;
  teachingGroupId: string;
  periodId: string;
  topicTitle: string | null;
  status: string;
}

export interface LoadOptions {
  studentIds: string[];
  from: SchoolDate;
  to: SchoolDate;
  teachingGroupIds?: string[];
  subjectId?: string;
  rules: LimitRule[];
  settings: LimitSettings;
  now?: Date;
}

/** studentId → lessons in date and lesson order. */
export async function loadStudentSessions(
  db: Db | DbTransaction,
  o: LoadOptions,
): Promise<Map<string, LoadedSession[]>> {
  const now = o.now ?? new Date();
  const from = schoolDateToDb(o.from);
  const to = schoolDateToDb(o.to);
  const [memberships, enrollments] = await Promise.all([
    db.teachingGroupMember.findMany({
      where: {
        studentId: { in: o.studentIds },
        ...(o.teachingGroupIds ? { teachingGroupId: { in: o.teachingGroupIds } } : {}),
        validFrom: { lte: to },
        OR: [{ validTo: null }, { validTo: { gte: from } }],
      },
      select: { studentId: true, teachingGroupId: true, validFrom: true, validTo: true },
    }),
    db.studentEnrollment.findMany({
      where: {
        studentId: { in: o.studentIds },
        validFrom: { lte: to },
        OR: [{ validTo: null }, { validTo: { gte: from } }],
      },
      select: { studentId: true, validFrom: true, validTo: true, classGroup: { select: { gradeId: true } } },
    }),
  ]);
  const sessions = await db.lessonSession.findMany({
    where: {
      teachingGroupId: { in: [...new Set(memberships.map((m) => m.teachingGroupId))] },
      date: { gte: from, lte: to },
      ...(o.subjectId ? { subjectId: o.subjectId } : {}),
    },
    orderBy: [{ date: "asc" }, { startsAt: "asc" }, { lessonNumber: "asc" }],
    select: {
      id: true,
      date: true,
      lessonNumber: true,
      startsAt: true,
      status: true,
      subjectId: true,
      teachingGroupId: true,
      teacherId: true,
      substituteTeacherId: true,
      periodId: true,
      planItem: { select: { topic: { select: { title: true } } } },
    },
  });
  const sessionIds = sessions.map((s) => s.id);
  const [attendance, entries] = await Promise.all([
    db.lessonAttendance.findMany({
      where: { lessonSessionId: { in: sessionIds }, studentId: { in: o.studentIds } },
      select: { lessonSessionId: true, studentId: true, status: true },
    }),
    db.scoreEntry.findMany({
      where: { lessonSessionId: { in: sessionIds }, studentId: { in: o.studentIds } },
      select: { id: true, lessonSessionId: true, studentId: true, kind: true, points: true, reversesEntryId: true },
    }),
  ]);
  const key = (sessionId: string, studentId: string) => `${sessionId}|${studentId}`;
  const marks = new Map(attendance.map((a) => [key(a.lessonSessionId, a.studentId), a.status as AttendanceStatus]));
  const lines = new Map<string, ScoreLine[]>();
  for (const e of entries) {
    const k = key(e.lessonSessionId, e.studentId);
    lines.set(k, [
      ...(lines.get(k) ?? []),
      { id: e.id, kind: e.kind, points: e.points, reversesEntryId: e.reversesEntryId },
    ]);
  }
  const within = (d: Date, r: { validFrom: Date; validTo: Date | null }) =>
    r.validFrom <= d && (!r.validTo || r.validTo >= d);

  const result = new Map<string, LoadedSession[]>(o.studentIds.map((id) => [id, []]));
  for (const s of sessions)
    for (const m of memberships) {
      if (m.teachingGroupId !== s.teachingGroupId || !within(s.date, m)) continue;
      const gradeId =
        enrollments.find((e) => e.studentId === m.studentId && within(s.date, e))?.classGroup.gradeId ?? "";
      const date = schoolDateFromDb(s.date);
      result.get(m.studentId)!.push({
        sessionId: s.id,
        date,
        lessonNumber: s.lessonNumber,
        startsAt: s.startsAt,
        subjectId: s.subjectId,
        teachingGroupId: s.teachingGroupId,
        periodId: s.periodId,
        topicTitle: s.planItem?.topic.title ?? null,
        status: s.status,
        cancelled: s.status === "CANCELLED",
        started: s.startsAt <= now,
        maxPoints: sessionMaxPoints(o.rules, o.settings, {
          lessonSessionId: s.id,
          schoolDate: date,
          periodId: s.periodId,
          subjectId: s.subjectId,
          teacherId: s.substituteTeacherId ?? s.teacherId,
          gradeId,
          teachingGroupId: s.teachingGroupId,
        }),
        attendance: marks.get(key(s.id, m.studentId)) ?? null,
        entries: lines.get(key(s.id, m.studentId)) ?? [],
      });
    }
  return result;
}
