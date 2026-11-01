// Lesson sessions from the calendar and the timetable (lesson-plan.md §3). Pure: no database access, unit-tested.
//
// generateLessonSessions → the sessions the timetable asks for in a date range.
// diffSessions           → what applying them changes, under the regeneration rules (§3):
//   only SCHEDULED sessions after `today` change; HELD, manual, cancelled-by-hand or otherwise locked sessions never;
//   nothing is deleted (a dropped lesson becomes CANCELLED); the key (group, date, lesson number) makes it idempotent.
// assignSequence         → sequenceNo per group + subject in date / lesson order.
import {
  addSchoolDays,
  atSchoolTime,
  diffSchoolDays,
  eachSchoolDate,
  isoWeekday,
  type SchoolDate,
} from "@idrok/shared/time";

export type WeekType = "ALL" | "ODD" | "EVEN";
export type DayKind = "HOLIDAY" | "VACATION" | "NON_WORKING" | "WORKING_OVERRIDE" | "SHORTENED";

export interface CalendarDayInput {
  date: SchoolDate;
  kind: DayKind;
  followsWeekday: number | null;
  /** null: the whole school. */
  gradeIds: string[] | null;
}

export interface PeriodInput {
  id: string;
  startDate: SchoolDate;
  endDate: SchoolDate;
}

export interface TimetableInput {
  validFrom: SchoolDate;
  /** Inclusive; null = open. */
  validTo: SchoolDate | null;
  entries: {
    id: string;
    teachingGroupId: string;
    subjectId: string;
    teacherId: string;
    weekday: number;
    lessonNumber: number;
    weekType: WeekType;
  }[];
}

export interface BellScheduleInput {
  shiftId: string | null;
  validFrom: SchoolDate;
  slots: { lessonNumber: number; startMinute: number; endMinute: number }[];
}

export interface GroupInput {
  /** The class's grade (parallel); null for cross-class groups. */
  gradeId: string | null;
  shiftId: string | null;
}

export interface GenerationInput {
  yearStart: SchoolDate;
  yearEnd: SchoolDate;
  from: SchoolDate;
  to: SchoolDate;
  workingWeekdays: number[];
  /** ISO weekday the week starts on (odd/even weeks, T-30). */
  weekStartsOn: number;
  timezone: string;
  calendarDays: CalendarDayInput[];
  periods: PeriodInput[];
  timetables: TimetableInput[];
  bellSchedules: BellScheduleInput[];
  groups: Map<string, GroupInput>;
}

export interface DesiredSession {
  teachingGroupId: string;
  subjectId: string;
  teacherId: string;
  date: SchoolDate;
  lessonNumber: number;
  startsAt: Date;
  endsAt: Date;
  periodId: string;
  timetableEntryId: string;
}

export type GenerationWarning =
  | { kind: "NO_PERIOD"; date: SchoolDate }
  | { kind: "NO_BELL_SLOT"; date: SchoolDate; teachingGroupId: string; lessonNumber: number };

export const sessionKey = (s: { teachingGroupId: string; date: string; lessonNumber: number }) =>
  `${s.teachingGroupId}|${s.date}|${s.lessonNumber}`;

/** Week 1 (odd) is the week that contains the first day of the year. */
export function weekParity(date: SchoolDate, yearStart: SchoolDate, weekStartsOn: number): "ODD" | "EVEN" {
  const startOfWeek = (d: SchoolDate) => addSchoolDays(d, -((isoWeekday(d) - weekStartsOn + 7) % 7));
  const weeks = Math.floor(diffSchoolDays(startOfWeek(yearStart), startOfWeek(date)) / 7);
  return weeks % 2 === 0 ? "ODD" : "EVEN";
}

/**
 * Whose weekday's lessons run on `date` for a group of `gradeId` — null when there are no lessons.
 * A day marked for some grades only is an ordinary day for the others.
 */
export function lessonWeekday(
  date: SchoolDate,
  gradeId: string | null,
  workingWeekdays: Set<number>,
  marks: Map<string, CalendarDayInput>,
): number | null {
  const mark = marks.get(date);
  const applies = mark && (mark.gradeIds === null || (gradeId !== null && mark.gradeIds.includes(gradeId)));
  if (applies) {
    if (mark.kind === "HOLIDAY" || mark.kind === "VACATION" || mark.kind === "NON_WORKING") return null;
    if (mark.kind === "WORKING_OVERRIDE") return mark.followsWeekday;
  }
  const weekday = isoWeekday(date);
  return workingWeekdays.has(weekday) ? weekday : null;
}

/** The shortest period containing the date (a quarter before its half year, T-29). */
function periodOf(date: SchoolDate, periods: PeriodInput[]): PeriodInput | undefined {
  return periods
    .filter((p) => p.startDate <= date && date <= p.endDate)
    .sort((a, b) => diffSchoolDays(a.startDate, a.endDate) - diffSchoolDays(b.startDate, b.endDate))[0];
}

/** The newest bell schedule of the shift (else of the whole school) in force on the date (T-32). */
function slotOf(date: SchoolDate, shiftId: string | null, lessonNumber: number, schedules: BellScheduleInput[]) {
  const pick = (shift: string | null) =>
    schedules
      .filter((b) => b.shiftId === shift && b.validFrom <= date)
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
  const schedule = (shiftId ? pick(shiftId) : undefined) ?? pick(null);
  return schedule?.slots.find((s) => s.lessonNumber === lessonNumber);
}

export function generateLessonSessions(input: GenerationInput): {
  sessions: DesiredSession[];
  warnings: GenerationWarning[];
} {
  const working = new Set(input.workingWeekdays);
  const marks = new Map(input.calendarDays.map((d) => [d.date, d]));
  const from = input.from > input.yearStart ? input.from : input.yearStart;
  const to = input.to < input.yearEnd ? input.to : input.yearEnd;
  const sessions: DesiredSession[] = [];
  const warnings: GenerationWarning[] = [];
  if (from > to) return { sessions, warnings };

  for (const date of eachSchoolDate(from, to)) {
    const timetable = input.timetables.find((t) => t.validFrom <= date && (t.validTo === null || date <= t.validTo));
    if (!timetable) continue;
    const parity = weekParity(date, input.yearStart, input.weekStartsOn);
    const period = periodOf(date, input.periods);
    let periodWarned = false;
    for (const entry of timetable.entries) {
      if (entry.weekType !== "ALL" && entry.weekType !== parity) continue;
      const group = input.groups.get(entry.teachingGroupId);
      if (!group) continue;
      if (lessonWeekday(date, group.gradeId, working, marks) !== entry.weekday) continue;
      if (!period) {
        if (!periodWarned) warnings.push({ kind: "NO_PERIOD", date });
        periodWarned = true;
        continue;
      }
      const slot = slotOf(date, group.shiftId, entry.lessonNumber, input.bellSchedules);
      if (!slot) {
        warnings.push({
          kind: "NO_BELL_SLOT",
          date,
          teachingGroupId: entry.teachingGroupId,
          lessonNumber: entry.lessonNumber,
        });
        continue;
      }
      sessions.push({
        teachingGroupId: entry.teachingGroupId,
        subjectId: entry.subjectId,
        teacherId: entry.teacherId,
        date,
        lessonNumber: entry.lessonNumber,
        startsAt: atSchoolTime(date, slot.startMinute, input.timezone),
        endsAt: atSchoolTime(date, slot.endMinute, input.timezone),
        periodId: period.id,
        timetableEntryId: entry.id,
      });
    }
  }
  return { sessions, warnings };
}

// ---------------------------------------------------------------- diff

export interface ExistingSession {
  id: string;
  teachingGroupId: string;
  subjectId: string;
  teacherId: string;
  date: SchoolDate;
  lessonNumber: number;
  startsAt: Date;
  endsAt: Date;
  periodId: string;
  timetableEntryId: string | null;
  status: "SCHEDULED" | "HELD" | "CANCELLED" | "MOVED";
  source: "TIMETABLE" | "MANUAL";
  /** Set when cancelled by hand; cancellations made by regeneration have none and may come back. */
  cancelReason: string | null;
  /** Attendance, scores or anything else hangs on it (M3+): never touched. */
  locked: boolean;
}

export interface SessionDiff {
  add: DesiredSession[];
  /** Existing sessions that get the desired values (and come back to SCHEDULED if auto-cancelled). */
  update: { id: string; to: DesiredSession }[];
  cancel: ExistingSession[];
  /** Desired lessons that cannot be applied because the existing session is held, manual or locked. */
  blocked: { existing: ExistingSession; desired: DesiredSession | null }[];
  unchanged: number;
}

const sameValues = (e: ExistingSession, d: DesiredSession) =>
  e.subjectId === d.subjectId &&
  e.teacherId === d.teacherId &&
  e.periodId === d.periodId &&
  e.timetableEntryId === d.timetableEntryId &&
  e.startsAt.getTime() === d.startsAt.getTime() &&
  e.endsAt.getTime() === d.endsAt.getTime();

/**
 * Compares existing sessions of the window with the desired ones. Only sessions after `today` are considered;
 * callers pass the existing sessions of the same window as the desired ones.
 */
export function diffSessions(existing: ExistingSession[], desired: DesiredSession[], today: SchoolDate): SessionDiff {
  const diff: SessionDiff = { add: [], update: [], cancel: [], blocked: [], unchanged: 0 };
  const future = (date: string) => date > today;
  const byKey = new Map(existing.map((e) => [sessionKey(e), e]));
  const wanted = new Set<string>();
  const frozen = (e: ExistingSession) =>
    e.locked ||
    e.source === "MANUAL" ||
    e.status === "HELD" ||
    e.status === "MOVED" ||
    (e.status === "CANCELLED" && e.cancelReason !== null) ||
    !future(e.date);

  for (const d of desired) {
    if (!future(d.date)) continue;
    const key = sessionKey(d);
    wanted.add(key);
    const e = byKey.get(key);
    if (!e) diff.add.push(d);
    else if (frozen(e)) {
      if (e.status !== "HELD" || !sameValues(e, d)) diff.blocked.push({ existing: e, desired: d });
      else diff.unchanged++;
    } else if (e.status === "CANCELLED" || !sameValues(e, d)) diff.update.push({ id: e.id, to: d });
    else diff.unchanged++;
  }
  for (const e of existing) {
    if (wanted.has(sessionKey(e)) || !future(e.date) || e.status === "CANCELLED") continue;
    if (frozen(e)) {
      if (e.source === "TIMETABLE") diff.blocked.push({ existing: e, desired: null });
    } else diff.cancel.push(e);
  }
  return diff;
}

// ---------------------------------------------------------------- sequence

/** 1, 2, 3 … per group + subject over the non-cancelled sessions in date and lesson order. */
export function assignSequence<
  T extends { teachingGroupId: string; subjectId: string; date: string; lessonNumber: number; cancelled: boolean },
>(sessions: T[]): Map<T, number> {
  const groups = new Map<string, T[]>();
  for (const s of sessions) {
    if (s.cancelled) continue;
    const key = `${s.teachingGroupId}|${s.subjectId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const result = new Map<T, number>();
  for (const list of groups.values()) {
    list
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.lessonNumber - b.lessonNumber))
      .forEach((s, i) => result.set(s, i + 1));
  }
  return result;
}
