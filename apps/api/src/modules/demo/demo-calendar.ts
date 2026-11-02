// Synthetic demo calendar for the demo school (Q-30): two shifts (Q-35), bells, quarters, holidays and vacations,
// a conflict-free weekly timetable, the year's lessons and approved maths / mother-tongue plans applied to every class.
// Goes through the same services as the admin screens, so the data obeys the same rules.
import { randomUUID } from "node:crypto";
import { requireTenantId, type Db } from "@idrok/db";
import { PERMISSION_CODES } from "@idrok/shared";
import { addSchoolDays, parseSchoolDate, schoolDateToDb, schoolToday } from "@idrok/shared/time";
import type { RequestAuth } from "../../http/auth";
import { CalendarService } from "../calendar/calendar.service";
import { CurriculumService } from "../curriculum/curriculum.service";
import { LessonGenerationService } from "../lessons/generation.service";
import { TimetableService } from "../timetable/timetable.service";
import { DEMO_SUBJECTS } from "./demo-data";

const d = parseSchoolDate;
const WEEKDAYS = [1, 2, 3, 4, 5, 6];
const LESSONS_PER_DAY = 6;

export const DEMO_QUARTERS = [
  { name: "1-chorak", startDate: "2026-09-01", endDate: "2026-10-25" },
  { name: "2-chorak", startDate: "2026-11-02", endDate: "2026-12-27" },
  { name: "3-chorak", startDate: "2027-01-11", endDate: "2027-03-20" },
  { name: "4-chorak", startDate: "2027-03-30", endDate: "2027-05-25" },
] as const;

const VACATIONS = [
  { from: "2026-10-26", to: "2026-11-01", title: "Kuzgi ta'til" },
  { from: "2026-12-28", to: "2027-01-10", title: "Qishki ta'til" },
  { from: "2027-03-21", to: "2027-03-29", title: "Bahorgi ta'til" },
];
const HOLIDAYS = [
  { date: "2026-10-01", title: "O'qituvchilar va murabbiylar kuni" },
  { date: "2026-12-08", title: "Konstitutsiya kuni" },
  { date: "2027-03-08", title: "Xalqaro xotin-qizlar kuni" },
  { date: "2027-05-09", title: "Xotira va qadrlash kuni" },
];

/** Weekly hours per subject: primary grades 1–4 and grades 5–9. */
export function weeklyHours(level: number): Map<string, number> {
  const [math, mother, english, russian, history, biology, physics, chemistry, it, pe] = DEMO_SUBJECTS;
  return level <= 4
    ? new Map([
        [math, 5],
        [mother, 5],
        [english, 2],
        [russian, 2],
        [pe, 2],
        [it, 1],
      ])
    : new Map([
        [math, 5],
        [mother, 4],
        [english, 3],
        [russian, 2],
        [history, 2],
        [biology, 2],
        [physics, 2],
        [chemistry, 2],
        [it, 2],
        [pe, 2],
      ]);
}

export interface DemoClass {
  classGroupId: string;
  teachingGroupId: string;
  level: number;
}

/**
 * Greedy, conflict-free weekly timetable: a subject's hours are spread over the days with the fewest of them (then the
 * class's lightest days), each in the earliest lesson free for the class and the teacher. A teacher is busy in a
 * (day, lesson) slot whatever the shift — simple and safe.
 */
export function buildDemoTimetable(
  classes: DemoClass[],
  subjectIdByName: Map<string, string>,
  teacherOf: (teachingGroupId: string, subjectId: string) => string | undefined,
) {
  const entries: {
    teachingGroupId: string;
    subjectId: string;
    teacherId: string;
    weekday: number;
    lessonNumber: number;
  }[] = [];
  const teacherBusy = new Set<string>();
  let unplaced = 0;
  for (const cls of classes) {
    const classBusy = new Set<string>();
    const perDay = new Map<string, number>();
    for (const [subjectName, hours] of weeklyHours(cls.level)) {
      const subjectId = subjectIdByName.get(subjectName);
      const teacherId = subjectId && teacherOf(cls.teachingGroupId, subjectId);
      if (!subjectId || !teacherId) {
        unplaced += hours;
        continue;
      }
      for (let h = 0; h < hours; h++) {
        // Fewest of this subject first, then the class's lightest day, so the whole week (Saturday too) is used.
        const count = (key: string) => perDay.get(key) ?? 0;
        const days = [...WEEKDAYS].sort(
          (a, b) =>
            count(`${subjectId}|${a}`) - count(`${subjectId}|${b}`) || count(`day|${a}`) - count(`day|${b}`) || a - b,
        );
        let placed = false;
        for (const weekday of days) {
          for (let lessonNumber = 1; lessonNumber <= LESSONS_PER_DAY && !placed; lessonNumber++) {
            const slot = `${weekday}|${lessonNumber}`;
            if (classBusy.has(slot) || teacherBusy.has(`${teacherId}|${slot}`)) continue;
            classBusy.add(slot);
            teacherBusy.add(`${teacherId}|${slot}`);
            perDay.set(`${subjectId}|${weekday}`, count(`${subjectId}|${weekday}`) + 1);
            perDay.set(`day|${weekday}`, count(`day|${weekday}`) + 1);
            entries.push({ teachingGroupId: cls.teachingGroupId, subjectId, teacherId, weekday, lessonNumber });
            placed = true;
          }
          if (placed) break;
        }
        if (!placed) unplaced++;
      }
    }
  }
  return { entries, unplaced };
}

const slots = (start: number) =>
  Array.from({ length: LESSONS_PER_DAY }, (_, i) => {
    const from = start + i * 55;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { lessonNumber: i + 1, startTime: hhmm(from), endTime: hhmm(from + 45) };
  });

export interface DemoCalendarSummary {
  lessons: number;
  timetableEntries: number;
  unplacedHours: number;
  plans: number;
  scores: number;
}

export async function seedDemoCalendar(
  db: Db,
  admin: { userId: string; tenantId: string; username: string },
  yearId: string,
): Promise<DemoCalendarSummary> {
  // The services check permissions through the request auth; the seed acts as the school administrator.
  const auth: RequestAuth = {
    ...admin,
    active: true,
    mustChangePassword: false,
    roles: ["SCHOOL_ADMIN"],
    permissions: [...PERMISSION_CODES],
    sessionId: "seed:demo",
    via: "bearer",
  };
  const calendar = new CalendarService(db);
  await calendar.setSchoolWeek(yearId, { workingWeekdays: WEEKDAYS });
  for (const [i, q] of DEMO_QUARTERS.entries())
    await calendar.createPeriod(yearId, {
      type: "QUARTER",
      order: i + 1,
      name: q.name,
      startDate: d(q.startDate),
      endDate: d(q.endDate),
    });
  for (const v of VACATIONS)
    await calendar.createDays(yearId, { from: d(v.from), to: d(v.to), kind: "VACATION", title: v.title });
  for (const h of HOLIDAYS) {
    const inVacation = VACATIONS.some((v) => v.from <= h.date && h.date <= v.to);
    if (!inVacation) await calendar.createDays(yearId, { date: d(h.date), kind: "HOLIDAY", title: h.title });
  }

  // Q-35: grades 5–9 in the morning, 1–4 in the afternoon.
  const morning = await calendar.createShift({ name: "1-smena", startTime: "08:00", endTime: "13:30" });
  const afternoon = await calendar.createShift({ name: "2-smena", startTime: "13:30", endTime: "19:00" });
  await calendar.createBellSchedule(yearId, {
    name: "1-smena qo'ng'iroqlari",
    shiftId: morning.id,
    validFrom: d("2026-09-01"),
    slots: slots(8 * 60),
  });
  await calendar.createBellSchedule(yearId, {
    name: "2-smena qo'ng'iroqlari",
    shiftId: afternoon.id,
    validFrom: d("2026-09-01"),
    slots: slots(13 * 60 + 30),
  });
  const classRows = await db.classGroup.findMany({
    where: { academicYearId: yearId },
    select: {
      id: true,
      grade: { select: { level: true } },
      teachingGroups: { where: { kind: "CLASS" }, select: { id: true } },
    },
  });
  for (const c of classRows)
    await db.classGroup.update({
      where: { id: c.id },
      data: { shiftId: c.grade.level >= 5 ? morning.id : afternoon.id },
    });

  // Timetable from the teacher assignments of the demo import.
  const [subjects, assignments] = await Promise.all([
    db.subject.findMany({ select: { id: true, name: true } }),
    db.teacherAssignment.findMany({
      where: { academicYearId: yearId },
      select: { teachingGroupId: true, subjectId: true, teacherId: true },
    }),
  ]);
  const teacher = new Map(assignments.map((a) => [`${a.teachingGroupId}|${a.subjectId}`, a.teacherId]));
  const classes = classRows
    .filter((c) => c.teachingGroups[0])
    .map((c) => ({ classGroupId: c.id, teachingGroupId: c.teachingGroups[0]!.id, level: c.grade.level }))
    .sort((a, b) => a.level - b.level);
  const { entries, unplaced } = buildDemoTimetable(
    classes,
    new Map(subjects.map((s) => [s.name, s.id])),
    (groupId, subjectId) => teacher.get(`${groupId}|${subjectId}`),
  );
  const timetables = new TimetableService(db);
  const draft = await timetables.create(yearId, { note: "Demo jadval" }, admin.userId);
  await timetables.replaceEntries(draft.id, { entries: entries.map((e) => ({ ...e, weekType: "ALL" as const })) });
  await timetables.publish(draft.id, { validFrom: d("2026-09-01") }, admin.userId);

  // The whole year's lessons (the first generation may fill the past, T-36).
  const generation = new LessonGenerationService(db);
  const preview = await generation.preview(yearId, true);
  const applied = await generation.apply(yearId, true, preview.previewHash);

  // Maths and mother tongue plans per grade (as many one-hour topics as the grade's first class has lessons).
  const curriculum = new CurriculumService(db);
  const [mathId, motherId] = [
    subjects.find((s) => s.name === DEMO_SUBJECTS[0])?.id,
    subjects.find((s) => s.name === DEMO_SUBJECTS[1])?.id,
  ];
  let plans = 0;
  const grades = [...new Set(classes.map((c) => c.level))];
  for (const level of grades) {
    const gradeClasses = classes.filter((c) => c.level === level);
    const grade = await db.classGroup.findUniqueOrThrow({
      where: { id: gradeClasses[0]!.classGroupId },
      select: { gradeId: true },
    });
    for (const [subjectId, label] of [
      [mathId, "Matematika"],
      [motherId, "Ona tili"],
    ] as const) {
      if (!subjectId) continue;
      const lessons = await db.lessonSession.count({
        where: { teachingGroupId: gradeClasses[0]!.teachingGroupId, subjectId, status: { not: "CANCELLED" } },
      });
      const items = Array.from({ length: lessons }, (_, i) => ({
        topicTitle: `${label} ${level}-sinf: ${i + 1}-mavzu`,
        hours: 1,
        lessonType: (i + 1) % 9 === 0 ? ("CONTROL_WORK" as const) : ("NEW" as const),
        homework: `${i + 1}-mavzu bo'yicha 1–3-mashqlar`,
      }));
      const plan = await curriculum.create(auth, {
        academicYearId: yearId,
        subjectId,
        gradeId: grade.gradeId,
        title: `${label} ${level}-sinf`,
        items,
      });
      await curriculum.submit(auth, plan.id);
      if ((await db.curriculumPlan.findUniqueOrThrow({ where: { id: plan.id } })).status !== "APPROVED")
        await curriculum.approve(auth, plan.id);
      await curriculum.assign(
        auth,
        plan.id,
        gradeClasses.map((c) => c.teachingGroupId),
      );
      plans++;
    }
  }
  // Quarters that have started are active (each binds the default assessment policy).
  const todayDate = schoolToday();
  const periods = await db.academicPeriod.findMany({
    where: { academicYearId: yearId },
    select: { id: true, startDate: true },
  });
  for (const p of periods) if (p.startDate <= schoolDateToDb(todayDate)) await calendar.activatePeriod(p.id);

  const scores = await seedDemoScores(
    db,
    admin.userId,
    [mathId, motherId].filter((x): x is string => !!x),
  );
  return { lessons: applied.added, timetableEntries: entries.length, unplacedHours: unplaced, plans, scores };
}

/**
 * Synthetic scores for the last two weeks of maths and mother tongue (M3): most students 5–10 points a lesson, some
 * not scored yet, a few absent. Inserted directly (thousands of rows) but inside every rule: one entry per student and
 * lesson, at most 10, far under the daily cap.
 */
async function seedDemoScores(db: Db, userId: string, subjectIds: string[]) {
  const today = schoolToday();
  const lessons = await db.lessonSession.findMany({
    where: {
      subjectId: { in: subjectIds },
      status: { not: "CANCELLED" },
      date: { gte: schoolDateToDb(addSchoolDays(today, -14)), lt: schoolDateToDb(today) },
    },
    orderBy: [{ date: "asc" }, { startsAt: "asc" }],
    select: {
      id: true,
      date: true,
      academicYearId: true,
      periodId: true,
      subjectId: true,
      teacherId: true,
      substituteTeacherId: true,
      teachingGroupId: true,
      teachingGroup: { select: { classGroup: { select: { gradeId: true } } } },
      planItem: { select: { topicId: true } },
    },
  });
  const tenantId = requireTenantId();
  let count = 0;
  for (const [n, lesson] of lessons.entries()) {
    const members = await db.teachingGroupMember.findMany({
      where: {
        teachingGroupId: lesson.teachingGroupId,
        validFrom: { lte: lesson.date },
        OR: [{ validTo: null }, { validTo: { gte: lesson.date } }],
      },
      orderBy: { studentId: "asc" },
      select: { studentId: true },
    });
    const gradeId = lesson.teachingGroup.classGroup?.gradeId;
    if (!gradeId) continue;
    const roll = (j: number) => (j * 31 + n * 17) % 20;
    const scored = members.filter((_, j) => roll(j) > 3);
    await db.lessonAttendance.createMany({
      data: members.map((m, j) => ({
        tenantId,
        lessonSessionId: lesson.id,
        studentId: m.studentId,
        status: roll(j) === 0 ? ("ABSENT_UNEXCUSED" as const) : ("PRESENT" as const),
        markedById: userId,
        markedAt: new Date(),
      })),
    });
    await db.scoreEntry.createMany({
      data: scored.map((m) => ({
        tenantId,
        studentId: m.studentId,
        teacherId: lesson.substituteTeacherId ?? lesson.teacherId,
        subjectId: lesson.subjectId,
        teachingGroupId: lesson.teachingGroupId,
        gradeId,
        lessonSessionId: lesson.id,
        topicId: lesson.planItem?.topicId ?? null,
        academicYearId: lesson.academicYearId,
        periodId: lesson.periodId,
        schoolDate: lesson.date,
        points: 5 + (roll(members.indexOf(m)) % 6),
        idempotencyKey: randomUUID(),
        createdById: userId,
      })),
    });
    count += scored.length;
    await db.lessonSession.update({
      where: { id: lesson.id },
      data: { status: "HELD", heldMarkedAt: new Date(), heldMarkedById: userId },
    });
  }
  return count;
}
