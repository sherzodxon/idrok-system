// Demo seed (implementation-plan step 8): a full synthetic school with the same invariants as imported data.
import { runWithTenant } from "@idrok/db";
import { parseSchoolDate, schoolDateToDb } from "@idrok/shared/time";
import { findConflicts } from "../src/domain/timetable";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO_CLASSES,
  DEMO_SUBJECTS,
  STUDENTS_PER_CLASS,
  TEACHER_COUNT,
  studentRows,
  teacherRows,
} from "../src/modules/demo/demo-data";
import { DemoAlreadySeededError, seedDemoSchool, type DemoSummary } from "../src/modules/demo/demo-seed";
import { createTestApp } from "./support/app";

let t: Awaited<ReturnType<typeof createTestApp>>;
let tenantId: string;
let actor: { userId: string; roles: string[] };
let summary: DemoSummary;
const day = (v: string) => schoolDateToDb(parseSchoolDate(v));

const seed = () => runWithTenant({ tenantId, userId: actor.userId }, () => seedDemoSchool(t.deps.db, actor));

beforeAll(async () => {
  t = await createTestApp({ ARGON2_MEMORY_KIB: "1024" });
  tenantId = t.defaultTenant.tenant.id;
  const admin = await t.defaultTenant.createUser("SCHOOL_ADMIN");
  actor = { userId: admin.id, roles: ["SCHOOL_ADMIN"] };
  summary = await seed();
}, 300_000);
afterAll(() => t.close());

describe("demo data", () => {
  it("is synthetic: every phone is on the unused +998 00 code and unique", () => {
    const phones = [
      ...studentRows().flatMap((r) => [r.values.guardian1Phone!, r.values.guardian2Phone!]),
      ...teacherRows().map((r) => r.values.phone!),
    ];
    expect(phones.every((p) => /^\+99800\d{7}$/.test(p))).toBe(true);
    expect(new Set(phones).size).toBe(phones.length);
  });
});

describe("seedDemoSchool", () => {
  const where = () => ({ tenantId });

  it("creates the school: year, 10 classes, subjects, 40 teachers, 300 students, 600 guardians", async () => {
    const root = t.deps.root;
    const students = DEMO_CLASSES.length * STUDENTS_PER_CLASS;
    expect(summary).toMatchObject({
      subjects: DEMO_SUBJECTS.length,
      classes: DEMO_CLASSES.length,
      employees: TEACHER_COUNT,
      students,
    });
    expect(await root.academicYear.count({ where: { ...where(), status: "ACTIVE" } })).toBe(1);
    expect(await root.classGroup.count({ where: where() })).toBe(DEMO_CLASSES.length);
    expect(await root.student.count({ where: where() })).toBe(students);
    expect(await root.studentEnrollment.count({ where: { ...where(), status: "ACTIVE" } })).toBe(students);
    expect(await root.guardian.count({ where: where() })).toBe(students * 2);
    expect(await root.employee.count({ where: where() })).toBe(TEACHER_COUNT);
  });

  it("keeps the invariants real data has", async () => {
    const root = t.deps.root;
    // Every class has its whole-class group, a homeroom teacher, and every subject from exactly one teacher.
    const classes = await root.classGroup.findMany({
      where: where(),
      select: {
        homeroomTeacherId: true,
        teachingGroups: { where: { kind: "CLASS" }, select: { id: true } },
      },
    });
    expect(classes.every((c) => c.teachingGroups.length === 1 && c.homeroomTeacherId)).toBe(true);
    const assignments = await root.teacherAssignment.findMany({
      where: where(),
      select: { subjectId: true, teachingGroupId: true },
    });
    const pairs = new Set(assignments.map((a) => `${a.subjectId}|${a.teachingGroupId}`));
    expect(pairs.size).toBe(DEMO_CLASSES.length * DEMO_SUBJECTS.length);
    expect(assignments).toHaveLength(pairs.size);
  });

  it("creates logins by the school's rules: guardians and teachers always, students from grade 5", async () => {
    const studentsWithLogin = DEMO_CLASSES.filter((c) => Number(c.split("-")[0]) >= 5).length * STUDENTS_PER_CLASS;
    const guardians = DEMO_CLASSES.length * STUDENTS_PER_CLASS * 2;
    expect(summary.accounts).toBe(studentsWithLogin + guardians + TEACHER_COUNT);
    expect(
      await t.deps.root.user.count({ where: { ...where(), mustChangePassword: true, roles: { some: {} } } }),
    ).toBeGreaterThanOrEqual(summary.accounts);
  });

  it("adds the demo calendar: two shifts, quarters, a conflict-free timetable, the year's lessons and plans", async () => {
    const root = t.deps.root;
    expect(summary.calendar).toMatchObject({ unplacedHours: 0, plans: 18 });
    expect(summary.calendar!.lessons).toBeGreaterThan(5000);
    // M3: started quarters are active and bound to the default policy; recent lessons carry synthetic scores.
    const active = await root.academicPeriod.findMany({
      where: { ...where(), status: "ACTIVE" },
      select: { id: true },
    });
    expect(await root.policyBinding.count({ where: { periodId: { in: active.map((p) => p.id) } } })).toBe(
      active.length,
    );
    expect(summary.calendar!.scores).toBe(await root.scoreEntry.count({ where: where() }));
    expect(await root.scoreEntry.count({ where: { ...where(), points: { gt: 10 } } })).toBe(0);
    expect(await root.shift.count({ where: where() })).toBe(2);
    expect(await root.classGroup.count({ where: { ...where(), shiftId: null } })).toBe(0);
    expect(await root.academicPeriod.count({ where: { ...where(), type: "QUARTER" } })).toBe(4);
    const tt = await root.timetable.findFirstOrThrow({
      where: { ...where(), status: "PUBLISHED" },
      include: { entries: { include: { teachingGroup: { select: { kind: true, classGroupId: true } } } } },
    });
    const groups = new Map(tt.entries.map((e) => [e.teachingGroupId, { id: e.teachingGroupId, ...e.teachingGroup }]));
    expect(findConflicts(tt.entries, groups)).toEqual([]);
    // No lessons in vacations; every non-cancelled maths lesson after today has a planned topic.
    expect(
      await root.lessonSession.count({
        where: { ...where(), date: { gte: day("2026-12-28"), lte: day("2027-01-10") } },
      }),
    ).toBe(0);
    const maths = await root.subject.findFirstOrThrow({ where: { ...where(), name: DEMO_SUBJECTS[0] } });
    expect(
      await root.lessonSession.count({
        where: {
          ...where(),
          subjectId: maths.id,
          planItemId: null,
          status: "SCHEDULED",
          date: { lte: day("2027-05-25") },
        },
      }),
    ).toBe(0);
    expect(await root.curriculumPlan.count({ where: { ...where(), status: "APPROVED" } })).toBe(18);
  });

  it("only fills an empty school", async () => {
    await expect(seed()).rejects.toBeInstanceOf(DemoAlreadySeededError);
    expect(await t.deps.root.student.count({ where: where() })).toBe(DEMO_CLASSES.length * STUDENTS_PER_CLASS);
  });
});
