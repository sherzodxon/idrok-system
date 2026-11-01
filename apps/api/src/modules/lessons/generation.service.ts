// M2 step 3: lesson sessions from the published timetables and the calendar (lesson-plan.md §3).
// preview → the admin sees what changes (add / update / cancel / blocked); apply → the same diff, if nothing changed in
// between (previewHash), in one transaction under a per-year advisory lock. Applied synchronously: one school's year is
// ~10k rows (T-37).
import { createHash } from "node:crypto";
import { requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import { addSchoolDays, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import {
  assignSequence,
  diffSessions,
  generateLessonSessions,
  sessionKey,
  type DesiredSession,
  type ExistingSession,
  type GenerationInput,
  type SessionDiff,
} from "../../domain/lessons";
import { AppError, notFound } from "../../http/errors";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { DEFAULT_WORKING_WEEKDAYS } from "../calendar/calendar.service";

const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError("CONFLICT", 409, { reason, ...details });

interface Computed {
  diff: SessionDiff;
  hash: string;
  from: SchoolDate;
  to: SchoolDate;
  warnings: { noPeriodDates: string[]; noBellSlot: number };
  groupNames: Map<string, string>;
  subjectNames: Map<string, string>;
  existing: ExistingSession[];
}

export class LessonGenerationService {
  constructor(private readonly db: Db) {}

  /** Everything the pure generator needs, read from the year. */
  private async load(tx: DbTransaction | Db, academicYearId: string, includePast: boolean): Promise<Computed> {
    const year = await tx.academicYear.findUnique({ where: { id: academicYearId } });
    if (!year) throw notFound();
    if (year.status === "ARCHIVED" || year.status === "CLOSED") throw conflict("YEAR_CLOSED");
    const yearStart = schoolDateFromDb(year.startDate);
    const yearEnd = schoolDateFromDb(year.endDate);
    const { timezone, today } = await schoolClock(this.db);

    const existingCount = await tx.lessonSession.count({ where: { academicYearId } });
    if (includePast && existingCount > 0) throw conflict("PAST_ALREADY_GENERATED");
    // Regeneration touches only lessons after today; the first generation may fill the past too.
    const cutoff = includePast ? addSchoolDays(yearStart, -1) : today;

    const [settings, week, days, periods, timetables, bells, groups, sessions] = await Promise.all([
      tx.schoolSettings.findFirst({ select: { weekStartsOn: true } }),
      tx.schoolWeek.findUnique({ where: { academicYearId } }),
      tx.calendarDay.findMany({ where: { academicYearId }, include: { grades: { select: { gradeId: true } } } }),
      tx.academicPeriod.findMany({ where: { academicYearId } }),
      tx.timetable.findMany({ where: { academicYearId, status: "PUBLISHED" }, include: { entries: true } }),
      tx.bellSchedule.findMany({ where: { academicYearId }, include: { slots: true } }),
      tx.teachingGroup.findMany({
        where: { academicYearId },
        select: {
          id: true,
          name: true,
          kind: true,
          classGroup: { select: { name: true, gradeId: true, shiftId: true } },
        },
      }),
      tx.lessonSession.findMany({
        where: { academicYearId },
        select: {
          id: true,
          teachingGroupId: true,
          subjectId: true,
          teacherId: true,
          date: true,
          lessonNumber: true,
          startsAt: true,
          endsAt: true,
          periodId: true,
          timetableEntryId: true,
          status: true,
          source: true,
          cancelReason: true,
        },
      }),
    ]);

    const input: GenerationInput = {
      yearStart,
      yearEnd,
      from: addSchoolDays(cutoff, 1),
      to: yearEnd,
      workingWeekdays: week?.workingWeekdays ?? DEFAULT_WORKING_WEEKDAYS,
      weekStartsOn: settings?.weekStartsOn ?? 1,
      timezone,
      calendarDays: days.map((d) => ({
        date: schoolDateFromDb(d.date),
        kind: d.kind,
        followsWeekday: d.followsWeekday,
        gradeIds: d.appliesToAll ? null : d.grades.map((g) => g.gradeId),
      })),
      periods: periods.map((p) => ({
        id: p.id,
        startDate: schoolDateFromDb(p.startDate),
        endDate: schoolDateFromDb(p.endDate),
      })),
      timetables: timetables
        .filter((t) => t.validFrom)
        .map((t) => ({
          validFrom: schoolDateFromDb(t.validFrom!),
          validTo: t.validTo ? schoolDateFromDb(t.validTo) : null,
          entries: t.entries,
        })),
      bellSchedules: bells.map((b) => ({
        shiftId: b.shiftId,
        validFrom: schoolDateFromDb(b.validFrom),
        slots: b.slots,
      })),
      groups: new Map(
        groups.map((g) => [g.id, { gradeId: g.classGroup?.gradeId ?? null, shiftId: g.classGroup?.shiftId ?? null }]),
      ),
    };
    const generated = generateLessonSessions(input);
    // Attendance and scores arrive in M3; until then no lesson is locked by them.
    const existing: ExistingSession[] = sessions.map((s) => ({
      ...s,
      date: schoolDateFromDb(s.date),
      locked: false,
    }));
    const diff = diffSessions(existing, generated.sessions, cutoff);

    const subjects = await tx.subject.findMany({ select: { id: true, name: true } });

    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          add: diff.add.map((d) => [sessionKey(d), d.subjectId, d.teacherId, d.periodId, d.startsAt.getTime()]),
          update: diff.update.map((u) => [
            u.id,
            u.to.subjectId,
            u.to.teacherId,
            u.to.periodId,
            u.to.startsAt.getTime(),
          ]),
          cancel: diff.cancel.map((c) => c.id),
        }),
      )
      .digest("hex");
    return {
      diff,
      hash,
      from: input.from,
      to: input.to,
      warnings: {
        noPeriodDates: generated.warnings.flatMap((w) => (w.kind === "NO_PERIOD" ? [w.date] : [])).slice(0, 50),
        noBellSlot: generated.warnings.filter((w) => w.kind === "NO_BELL_SLOT").length,
      },
      groupNames: new Map(
        groups.map((g) => [g.id, g.kind === "SUBGROUP" && g.classGroup ? `${g.classGroup.name} · ${g.name}` : g.name]),
      ),
      subjectNames: new Map(subjects.map((s) => [s.id, s.name])),
      existing,
    };
  }

  private ref(
    c: Computed,
    s: { date: string; lessonNumber: number; teachingGroupId: string; subjectId: string; status?: string },
  ) {
    return {
      date: s.date,
      lessonNumber: s.lessonNumber,
      teachingGroupId: s.teachingGroupId,
      teachingGroupName: c.groupNames.get(s.teachingGroupId) ?? "",
      subjectName: c.subjectNames.get(s.subjectId) ?? "",
      ...(s.status ? { status: s.status } : {}),
    };
  }

  async preview(academicYearId: string, includePast: boolean) {
    const c = await this.load(this.db, academicYearId, includePast);
    return {
      previewHash: c.hash,
      from: c.from,
      to: c.to,
      add: c.diff.add.length,
      update: c.diff.update.length,
      cancel: c.diff.cancel.length,
      unchanged: c.diff.unchanged,
      cancelSample: c.diff.cancel.slice(0, 50).map((s) => this.ref(c, s)),
      blocked: c.diff.blocked.slice(0, 50).map((b) => this.ref(c, b.existing)),
      warnings: c.warnings,
    };
  }

  async apply(academicYearId: string, includePast: boolean, previewHash: string) {
    return this.db.$transaction(
      async (tx) => {
        const tenantId = requireTenantId();
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lessons:${tenantId}:${academicYearId}`}, 0))`;
        const c = await this.load(tx, academicYearId, includePast);
        if (c.hash !== previewHash) throw conflict("PREVIEW_STALE");
        const { diff } = c;

        // Sequence numbers over the result: kept existing lessons + revived/updated + new, minus cancelled.
        type Row = {
          key: string;
          teachingGroupId: string;
          subjectId: string;
          date: string;
          lessonNumber: number;
          cancelled: boolean;
        };
        const cancelled = new Set(diff.cancel.map((s) => s.id));
        const updated = new Map(diff.update.map((u) => [u.id, u.to]));
        const touchedPairs = new Set(
          [...diff.add, ...diff.update.map((u) => u.to), ...diff.cancel].map(
            (s) => `${s.teachingGroupId}|${s.subjectId}`,
          ),
        );
        const rows: (Row & { id?: string; desired?: DesiredSession })[] = [];
        for (const e of c.existing) {
          const to = updated.get(e.id);
          const s = to ?? e;
          if (
            !touchedPairs.has(`${s.teachingGroupId}|${s.subjectId}`) &&
            !touchedPairs.has(`${e.teachingGroupId}|${e.subjectId}`)
          )
            continue;
          rows.push({
            key: e.id,
            id: e.id,
            desired: to,
            teachingGroupId: s.teachingGroupId,
            subjectId: s.subjectId,
            date: e.date,
            lessonNumber: e.lessonNumber,
            cancelled: cancelled.has(e.id) || (e.status === "CANCELLED" && !to),
          });
        }
        for (const d of diff.add) rows.push({ key: sessionKey(d), desired: d, ...d, cancelled: false });
        const seq = assignSequence(rows);
        const seqOf = (r: Row) => seq.get(r as never) ?? 0;

        if (diff.add.length) {
          await tx.lessonSession.createMany({
            data: rows
              .filter((r) => !r.id && r.desired)
              .map((r) => ({
                tenantId,
                academicYearId,
                periodId: r.desired!.periodId,
                teachingGroupId: r.desired!.teachingGroupId,
                subjectId: r.desired!.subjectId,
                teacherId: r.desired!.teacherId,
                date: schoolDateToDb(r.desired!.date),
                lessonNumber: r.desired!.lessonNumber,
                startsAt: r.desired!.startsAt,
                endsAt: r.desired!.endsAt,
                sequenceNo: seqOf(r),
                timetableEntryId: r.desired!.timetableEntryId,
              })),
          });
        }
        const rowById = new Map(rows.filter((r) => r.id).map((r) => [r.id!, r]));
        for (const u of diff.update) {
          const row = rowById.get(u.id)!;
          await tx.lessonSession.update({
            where: { id: u.id },
            data: {
              status: "SCHEDULED",
              cancelReason: null,
              periodId: u.to.periodId,
              subjectId: u.to.subjectId,
              teacherId: u.to.teacherId,
              startsAt: u.to.startsAt,
              endsAt: u.to.endsAt,
              timetableEntryId: u.to.timetableEntryId,
              sequenceNo: seqOf(row),
            },
          });
        }
        if (diff.cancel.length) {
          await tx.lessonSession.updateMany({
            where: { id: { in: diff.cancel.map((s) => s.id) }, status: "SCHEDULED" },
            data: { status: "CANCELLED", cancelReason: null },
          });
        }
        // Renumber kept scheduled lessons whose place moved (a lesson before them appeared or went away).
        const current = await tx.lessonSession.findMany({
          where: {
            id: { in: rows.filter((r) => r.id && !r.desired && !r.cancelled).map((r) => r.id!) },
            status: "SCHEDULED",
          },
          select: { id: true, sequenceNo: true },
        });
        const currentSeq = new Map(current.map((s) => [s.id, s.sequenceNo]));
        for (const r of rows) {
          if (!r.id || r.desired || r.cancelled || !currentSeq.has(r.id)) continue;
          if (currentSeq.get(r.id) !== seqOf(r))
            await tx.lessonSession.update({ where: { id: r.id }, data: { sequenceNo: seqOf(r) } });
        }

        const result = { added: diff.add.length, updated: diff.update.length, cancelled: diff.cancel.length };
        await writeAudit(tx, {
          action: "lessons.generate",
          entityType: "AcademicYear",
          entityId: academicYearId,
          after: { ...result, includePast, from: c.from, to: c.to, blocked: diff.blocked.length },
        });
        return result;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
