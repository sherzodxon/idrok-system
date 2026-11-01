// lesson-plan.md §8 acceptance 1–5 (pure level) and the generation rules of §3.
import { describe, expect, it } from "vitest";
import { parseSchoolDate } from "@idrok/shared/time";
import {
  assignSequence,
  diffSessions,
  generateLessonSessions,
  weekParity,
  type DesiredSession,
  type ExistingSession,
  type GenerationInput,
  type TimetableInput,
} from "./lessons";

const d = (s: string) => parseSchoolDate(s);
const entry = (
  id: string,
  weekday: number,
  lessonNumber: number,
  extra: Partial<TimetableInput["entries"][0]> = {},
) => ({
  id,
  teachingGroupId: "g7a",
  subjectId: "math",
  teacherId: "t1",
  weekday,
  lessonNumber,
  weekType: "ALL" as const,
  ...extra,
});

// 1st quarter: Monday 2026-09-07 … Sunday 2026-11-08 = 9 weeks.
const base = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  yearStart: d("2026-09-07"),
  yearEnd: d("2027-05-31"),
  from: d("2026-09-07"),
  to: d("2026-11-08"),
  workingWeekdays: [1, 2, 3, 4, 5],
  weekStartsOn: 1,
  timezone: "Asia/Tashkent",
  calendarDays: [],
  periods: [
    { id: "q1", startDate: d("2026-09-07"), endDate: d("2026-11-08") },
    { id: "h1", startDate: d("2026-09-07"), endDate: d("2026-12-27") },
  ],
  timetables: [{ validFrom: d("2026-09-07"), validTo: null, entries: [entry("e-mon", 1, 1), entry("e-thu", 4, 2)] }],
  bellSchedules: [
    {
      shiftId: null,
      validFrom: d("2026-09-01"),
      slots: [
        { lessonNumber: 1, startMinute: 480, endMinute: 525 },
        { lessonNumber: 2, startMinute: 535, endMinute: 580 },
      ],
    },
  ],
  groups: new Map([["g7a", { gradeId: "grade7", shiftId: null }]]),
  ...over,
});

const asExisting = (s: DesiredSession, i: number, over: Partial<ExistingSession> = {}): ExistingSession => ({
  id: `s${i}`,
  ...s,
  timetableEntryId: s.timetableEntryId,
  status: "SCHEDULED",
  source: "TIMETABLE",
  cancelReason: null,
  locked: false,
  ...over,
});

describe("generateLessonSessions", () => {
  it("acceptance 1: 2 lessons a week, 9 weeks, a holiday on a lesson day → 17 sessions", () => {
    const { sessions, warnings } = generateLessonSessions(
      base({ calendarDays: [{ date: d("2026-10-01"), kind: "HOLIDAY", followsWeekday: null, gradeIds: null }] }),
    );
    expect(sessions).toHaveLength(17);
    expect(sessions.some((s) => s.date === "2026-10-01")).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("puts each lesson in the shortest period and at the bell time in Tashkent", () => {
    const { sessions } = generateLessonSessions(base());
    expect(new Set(sessions.map((s) => s.periodId))).toEqual(new Set(["q1"]));
    expect(sessions[0]).toMatchObject({ date: "2026-09-07", lessonNumber: 1, timetableEntryId: "e-mon" });
    // 08:00 in Tashkent (UTC+5) is 03:00 UTC.
    expect(sessions[0]!.startsAt.toISOString()).toBe("2026-09-07T03:00:00.000Z");
    expect(sessions[0]!.endsAt.toISOString()).toBe("2026-09-07T03:45:00.000Z");
  });

  it("acceptance 2: a working Saturday following Monday gets Monday's lessons", () => {
    const { sessions } = generateLessonSessions(
      base({
        from: d("2026-09-12"),
        to: d("2026-09-12"),
        calendarDays: [{ date: d("2026-09-12"), kind: "WORKING_OVERRIDE", followsWeekday: 1, gradeIds: null }],
      }),
    );
    expect(sessions.map((s) => [s.date, s.timetableEntryId])).toEqual([["2026-09-12", "e-mon"]]);
  });

  it("acceptance 3: a new version from a date changes nothing before it", () => {
    const timetables: TimetableInput[] = [
      { validFrom: d("2026-09-07"), validTo: d("2026-10-04"), entries: [entry("v1-mon", 1, 1)] },
      { validFrom: d("2026-10-05"), validTo: null, entries: [entry("v2-tue", 2, 1)] },
    ];
    const { sessions } = generateLessonSessions(base({ timetables }));
    expect(sessions.filter((s) => s.date < "2026-10-05").every((s) => s.timetableEntryId === "v1-mon")).toBe(true);
    expect(sessions.filter((s) => s.date >= "2026-10-05").every((s) => s.timetableEntryId === "v2-tue")).toBe(true);
  });

  it("a day off for some grades only is an ordinary day for the others", () => {
    const groups = new Map([
      ["g7a", { gradeId: "grade7", shiftId: null }],
      ["g5a", { gradeId: "grade5", shiftId: null }],
    ]);
    const { sessions } = generateLessonSessions(
      base({
        from: d("2026-09-14"),
        to: d("2026-09-14"),
        groups,
        timetables: [
          {
            validFrom: d("2026-09-07"),
            validTo: null,
            entries: [entry("a", 1, 1), entry("b", 1, 1, { teachingGroupId: "g5a" })],
          },
        ],
        calendarDays: [{ date: d("2026-09-14"), kind: "NON_WORKING", followsWeekday: null, gradeIds: ["grade7"] }],
      }),
    );
    expect(sessions.map((s) => s.teachingGroupId)).toEqual(["g5a"]);
  });

  it("odd/even weeks alternate from the week the year starts", () => {
    expect(weekParity(d("2026-09-07"), d("2026-09-07"), 1)).toBe("ODD");
    expect(weekParity(d("2026-09-13"), d("2026-09-07"), 1)).toBe("ODD");
    expect(weekParity(d("2026-09-14"), d("2026-09-07"), 1)).toBe("EVEN");
    const { sessions } = generateLessonSessions(
      base({
        to: d("2026-09-20"),
        timetables: [{ validFrom: d("2026-09-07"), validTo: null, entries: [entry("odd", 1, 1, { weekType: "ODD" })] }],
      }),
    );
    expect(sessions.map((s) => s.date)).toEqual(["2026-09-07"]);
  });

  it("uses the shift's bells, the newest schedule in force, and warns about gaps", () => {
    const { sessions, warnings } = generateLessonSessions(
      base({
        from: d("2026-09-07"),
        to: d("2026-09-14"),
        timetables: [{ validFrom: d("2026-09-07"), validTo: null, entries: [entry("a", 1, 1), entry("b", 1, 3)] }],
        groups: new Map([["g7a", { gradeId: "grade7", shiftId: "second" }]]),
        bellSchedules: [
          { shiftId: null, validFrom: d("2026-09-01"), slots: [{ lessonNumber: 1, startMinute: 480, endMinute: 525 }] },
          {
            shiftId: "second",
            validFrom: d("2026-09-01"),
            slots: [{ lessonNumber: 1, startMinute: 810, endMinute: 855 }],
          },
          {
            shiftId: "second",
            validFrom: d("2026-09-10"),
            slots: [{ lessonNumber: 1, startMinute: 820, endMinute: 865 }],
          },
        ],
      }),
    );
    expect(sessions.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-09-07T08:30:00.000Z",
      "2026-09-14T08:40:00.000Z",
    ]);
    expect(warnings.filter((w) => w.kind === "NO_BELL_SLOT")).toHaveLength(2);
  });

  it("no lessons on days outside every period (with a warning)", () => {
    const { sessions, warnings } = generateLessonSessions(
      base({ from: d("2026-12-28"), to: d("2027-01-04"), periods: [] }),
    );
    expect(sessions).toEqual([]);
    // Mon 28.12, Thu 31.12, Mon 04.01 are lesson days without a period.
    expect(warnings).toEqual(["2026-12-28", "2026-12-31", "2027-01-04"].map((date) => ({ kind: "NO_PERIOD", date })));
  });
});

describe("diffSessions", () => {
  const all = generateLessonSessions(base()).sessions;
  const today = d("2026-10-04");

  it("acceptance 5: applying twice changes nothing", () => {
    const existing = all.map((s, i) => asExisting(s, i));
    const diff = diffSessions(existing, all, today);
    expect(diff).toMatchObject({ add: [], update: [], cancel: [], blocked: [] });
    expect(diff.unchanged).toBe(all.filter((s) => s.date > today).length);
  });

  it("first generation adds only future lessons", () => {
    const diff = diffSessions([], all, today);
    expect(diff.add.every((s) => s.date > today)).toBe(true);
    expect(diff.add.length).toBe(all.filter((s) => s.date > today).length);
  });

  it("acceptance 3: a new version cancels and adds only after its start, the past stays", () => {
    const existing = all.map((s, i) => asExisting(s, i));
    const next = generateLessonSessions(
      base({
        timetables: [
          {
            validFrom: d("2026-09-07"),
            validTo: d("2026-10-11"),
            entries: [entry("e-mon", 1, 1), entry("e-thu", 4, 2)],
          },
          { validFrom: d("2026-10-12"), validTo: null, entries: [entry("v2-tue", 2, 1)] },
        ],
      }),
    ).sessions;
    const diff = diffSessions(existing, next, today);
    expect(diff.cancel.every((s) => s.date >= "2026-10-12")).toBe(true);
    expect(diff.cancel).toHaveLength(8); // 4 weeks × 2 old lessons
    expect(diff.add.every((s) => s.date >= "2026-10-12" && s.timetableEntryId === "v2-tue")).toBe(true);
    expect(diff.update).toEqual([]);
  });

  it("acceptance 4: held and locked lessons are never cancelled or changed", () => {
    const future = all.filter((s) => s.date > today);
    const existing = all.map((s, i) =>
      asExisting(s, i, s === future[0] ? { status: "HELD" } : s === future[1] ? { locked: true } : {}),
    );
    // The timetable now drops every lesson.
    const diff = diffSessions(existing, [], today);
    expect(diff.cancel.map((s) => s.date)).not.toContain(future[0]!.date);
    expect(diff.blocked.map((b) => b.existing.id).sort()).toEqual(
      existing
        .filter((e) => e.status === "HELD" || e.locked)
        .map((e) => e.id)
        .sort(),
    );
    // A changed teacher does not reach them either.
    const changed = all.map((s) => ({ ...s, teacherId: "t2" }));
    const diff2 = diffSessions(existing, changed, today);
    expect(diff2.update.map((u) => u.id)).not.toContain(existing.find((e) => e.status === "HELD")!.id);
    expect(diff2.blocked).toHaveLength(2);
  });

  it("auto-cancelled lessons come back; cancelled by hand stay cancelled", () => {
    const future = all.filter((s) => s.date > today);
    const existing = all.map((s, i) =>
      asExisting(
        s,
        i,
        s === future[0]
          ? { status: "CANCELLED" }
          : s === future[1]
            ? { status: "CANCELLED", cancelReason: "Sayohat" }
            : {},
      ),
    );
    const diff = diffSessions(existing, all, today);
    expect(diff.update.map((u) => u.to.date)).toEqual([future[0]!.date]);
    expect(diff.blocked.map((b) => b.existing.date)).toEqual([future[1]!.date]);
  });
});

describe("assignSequence", () => {
  it("numbers lessons per group and subject in order, skipping cancelled ones", () => {
    const rows = [
      { teachingGroupId: "g", subjectId: "m", date: "2026-09-08", lessonNumber: 1, cancelled: false },
      { teachingGroupId: "g", subjectId: "m", date: "2026-09-07", lessonNumber: 3, cancelled: false },
      { teachingGroupId: "g", subjectId: "m", date: "2026-09-07", lessonNumber: 2, cancelled: true },
      { teachingGroupId: "g", subjectId: "e", date: "2026-09-07", lessonNumber: 1, cancelled: false },
    ];
    const seq = assignSequence(rows);
    expect(rows.map((r) => seq.get(r) ?? null)).toEqual([2, 1, null, 1]);
  });
});
