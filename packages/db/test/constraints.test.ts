// Behaviour of the SQL-only invariants, including under concurrency.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { atSchoolTime, parseSchoolDate, schoolDateToDb } from "@idrok/shared/time";
import { clients } from "./helpers";

const { root } = clients();
const day = (s: string) => schoolDateToDb(parseSchoolDate(s));
let tenantId: string;

beforeAll(async () => {
  tenantId = (await root.tenant.create({ data: { slug: `c-${crypto.randomUUID()}`, name: "Demo C" } })).id;
});
afterAll(() => root.$disconnect());

async function yearAndClass() {
  const year = await root.academicYear.create({
    data: { tenantId, name: `Y-${crypto.randomUUID()}`, startDate: day("2026-09-01"), endDate: day("2027-06-30") },
  });
  const grade = await root.grade.upsert({
    where: { tenantId_level: { tenantId, level: 7 } },
    create: { tenantId, level: 7, name: "7-sinf" },
    update: {},
  });
  const cls = await root.classGroup.create({
    data: { tenantId, academicYearId: year.id, gradeId: grade.id, section: "A", name: "7-A" },
  });
  const student = await root.student.create({
    data: { tenantId, studentCode: `DEMO-${crypto.randomUUID()}`, firstName: "Demo", lastName: "Oquvchi" },
  });
  return { year, cls, student };
}

describe("academic year", () => {
  it("allows only one ACTIVE year per tenant", async () => {
    const { year } = await yearAndClass();
    await root.academicYear.update({ where: { id: year.id }, data: { status: "ACTIVE" } });
    const other = await yearAndClass();
    await expect(
      root.academicYear.update({ where: { id: other.year.id }, data: { status: "ACTIVE" } }),
    ).rejects.toThrow();
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      root.academicYear.create({
        data: { tenantId, name: "bad", startDate: day("2027-06-30"), endDate: day("2026-09-01") },
      }),
    ).rejects.toThrow();
  });
});

describe("enrollment", () => {
  it("keeps one ACTIVE enrollment per student and year, even for concurrent inserts", async () => {
    const { year, cls, student } = await yearAndClass();
    const insert = () =>
      root.studentEnrollment.create({
        data: {
          tenantId,
          studentId: student.id,
          academicYearId: year.id,
          classGroupId: cls.id,
          validFrom: day("2026-09-01"),
        },
      });
    const results = await Promise.allSettled([insert(), insert(), insert()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // History rows are unlimited.
    await root.studentEnrollment.create({
      data: {
        tenantId,
        studentId: student.id,
        academicYearId: year.id,
        classGroupId: cls.id,
        validFrom: day("2026-09-01"),
        validTo: day("2026-09-10"),
        status: "TRANSFERRED",
      },
    });
  });
});

describe("teaching groups", () => {
  it("one CLASS group per class; membership periods do not overlap", async () => {
    const { year, cls, student } = await yearAndClass();
    const group = await root.teachingGroup.create({
      data: { tenantId, academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name: "7-A" },
    });
    await expect(
      root.teachingGroup.create({
        data: { tenantId, academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name: "7-A dup" },
      }),
    ).rejects.toThrow();

    await root.teachingGroupMember.create({
      data: {
        tenantId,
        teachingGroupId: group.id,
        studentId: student.id,
        validFrom: day("2026-09-01"),
        validTo: day("2026-12-31"),
      },
    });
    await expect(
      root.teachingGroupMember.create({
        data: { tenantId, teachingGroupId: group.id, studentId: student.id, validFrom: day("2026-12-31") },
      }),
    ).rejects.toThrow();
    await root.teachingGroupMember.create({
      data: { tenantId, teachingGroupId: group.id, studentId: student.id, validFrom: day("2027-01-01") },
    });
  });

  it("a subgroup must belong to a class", async () => {
    const { year } = await yearAndClass();
    await expect(
      root.teachingGroup.create({ data: { tenantId, academicYearId: year.id, kind: "SUBGROUP", name: "x" } }),
    ).rejects.toThrow();
  });
});

describe("audit log", () => {
  it("is append-only", async () => {
    const row = await root.auditLog.create({ data: { tenantId, action: "demo.test", entityType: "Demo" } });
    await expect(root.auditLog.update({ where: { id: row.id }, data: { action: "changed" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(root.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe("branding", () => {
  it("only accepts #RRGGBB colours", async () => {
    await expect(
      root.schoolBranding.create({ data: { tenantId, schoolName: "Demo", primaryColor: "red; background:url(x)" } }),
    ).rejects.toThrow();
  });
});

describe("grade", () => {
  it("level is 0..11", async () => {
    await expect(root.grade.create({ data: { tenantId, level: 12, name: "12" } })).rejects.toThrow();
  });
});

describe("calendar (M2)", () => {
  it("periods of one type do not overlap; different types may nest", async () => {
    const { year } = await yearAndClass();
    const base = { tenantId, academicYearId: year.id };
    await root.academicPeriod.create({
      data: { ...base, type: "QUARTER", name: "1", order: 1, startDate: day("2026-09-01"), endDate: day("2026-10-31") },
    });
    await expect(
      root.academicPeriod.create({
        data: {
          ...base,
          type: "QUARTER",
          name: "2",
          order: 2,
          startDate: day("2026-10-31"),
          endDate: day("2026-12-28"),
        },
      }),
    ).rejects.toThrow();
    await root.academicPeriod.create({
      data: { ...base, type: "HALF", name: "1", order: 1, startDate: day("2026-09-01"), endDate: day("2026-12-28") },
    });
    await expect(
      root.academicPeriod.create({
        data: { ...base, type: "YEAR", name: "Y", order: 1, startDate: day("2027-06-30"), endDate: day("2026-09-01") },
      }),
    ).rejects.toThrow();
  });

  it("working weekdays and override days are well-formed", async () => {
    const { year } = await yearAndClass();
    await expect(
      root.schoolWeek.create({ data: { tenantId, academicYearId: year.id, workingWeekdays: [1, 8] } }),
    ).rejects.toThrow();
    await expect(
      root.schoolWeek.create({ data: { tenantId, academicYearId: year.id, workingWeekdays: [] } }),
    ).rejects.toThrow();
    const base = { tenantId, academicYearId: year.id, title: "Demo" };
    await expect(
      root.calendarDay.create({ data: { ...base, date: day("2026-10-10"), kind: "WORKING_OVERRIDE" } }),
    ).rejects.toThrow();
    await expect(
      root.calendarDay.create({ data: { ...base, date: day("2026-10-11"), kind: "HOLIDAY", followsWeekday: 1 } }),
    ).rejects.toThrow();
    await root.calendarDay.create({
      data: { ...base, date: day("2026-10-10"), kind: "WORKING_OVERRIDE", followsWeekday: 1 },
    });
  });

  it("shift and bell times stay inside the day", async () => {
    await expect(
      root.shift.create({ data: { tenantId, name: `S-${crypto.randomUUID()}`, startMinute: 600, endMinute: 500 } }),
    ).rejects.toThrow();
    const { year } = await yearAndClass();
    const schedule = await root.bellSchedule.create({
      data: { tenantId, academicYearId: year.id, name: "Demo", validFrom: day("2026-09-01") },
    });
    await expect(
      root.bellSlot.create({
        data: { bellScheduleId: schedule.id, lessonNumber: 1, startMinute: 530, endMinute: 520 },
      }),
    ).rejects.toThrow();
  });
});

describe("timetable (M2)", () => {
  async function timetableFixture() {
    const { year, cls } = await yearAndClass();
    const group = await root.teachingGroup.create({
      data: { tenantId, academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name: cls.name },
    });
    const subject = await root.subject.create({ data: { tenantId, name: `Demo fan ${crypto.randomUUID()}` } });
    const teacher = await root.employee.create({ data: { tenantId, firstName: "Demo", lastName: "Ustoz" } });
    const createdById = crypto.randomUUID();
    const draft = (version: number) =>
      root.timetable.create({ data: { tenantId, academicYearId: year.id, version, createdById } });
    const entry = (timetableId: string) => ({
      tenantId,
      timetableId,
      teachingGroupId: group.id,
      subjectId: subject.id,
      teacherId: teacher.id,
      weekday: 1,
      lessonNumber: 1,
    });
    return { year, draft, entry };
  }

  it("published versions of a year never cover the same date", async () => {
    const { draft } = await timetableFixture();
    const v1 = await draft(1);
    const v2 = await draft(2);
    const publish = (id: string, from: string, to: string | null) =>
      root.timetable.update({
        where: { id },
        data: { status: "PUBLISHED", validFrom: day(from), validTo: to ? day(to) : null, publishedAt: new Date() },
      });
    await publish(v1.id, "2026-09-01", null);
    await expect(publish(v2.id, "2026-11-01", null)).rejects.toThrow();
    await publish(v1.id, "2026-09-01", "2026-10-31");
    await publish(v2.id, "2026-11-01", null);
    await expect(
      root.timetable.update({ where: { id: (await draft(3)).id }, data: { status: "PUBLISHED" } }),
    ).rejects.toThrow();
  });

  it("entries of a published timetable are frozen; draft entries are free", async () => {
    const { draft, entry } = await timetableFixture();
    const tt = await draft(1);
    const e = await root.timetableEntry.create({ data: entry(tt.id) });
    await root.timetableEntry.update({ where: { id: e.id }, data: { lessonNumber: 2 } });
    await root.timetable.update({
      where: { id: tt.id },
      data: { status: "PUBLISHED", validFrom: day("2026-09-01"), publishedAt: new Date() },
    });
    await expect(root.timetableEntry.update({ where: { id: e.id }, data: { lessonNumber: 3 } })).rejects.toThrow();
    await expect(root.timetableEntry.create({ data: entry(tt.id) })).rejects.toThrow();
    await expect(root.timetableEntry.delete({ where: { id: e.id } })).rejects.toThrow();
    await expect(root.timetable.delete({ where: { id: tt.id } })).rejects.toThrow();
    await expect(root.timetableEntry.create({ data: { ...entry((await draft(2)).id), weekday: 8 } })).rejects.toThrow();
  });
});

describe("lesson sessions (M2)", () => {
  const at = (minute: number) => atSchoolTime(parseSchoolDate("2026-09-07"), minute);

  it("are never deleted and hold their times in order", async () => {
    const { year, cls } = await yearAndClass();
    const group = await root.teachingGroup.create({
      data: { tenantId, academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name: cls.name },
    });
    const subject = await root.subject.create({ data: { tenantId, name: `Demo fan ${crypto.randomUUID()}` } });
    const teacher = await root.employee.create({ data: { tenantId, firstName: "Demo", lastName: "Ustoz" } });
    const period = await root.academicPeriod.create({
      data: {
        tenantId,
        academicYearId: year.id,
        type: "YEAR",
        name: "Y",
        order: 1,
        startDate: day("2026-09-01"),
        endDate: day("2027-06-30"),
      },
    });
    const base = {
      tenantId,
      academicYearId: year.id,
      periodId: period.id,
      teachingGroupId: group.id,
      subjectId: subject.id,
      teacherId: teacher.id,
      date: day("2026-09-07"),
      lessonNumber: 1,
      sequenceNo: 1,
    };
    const lesson = await root.lessonSession.create({
      data: { ...base, startsAt: at(480), endsAt: at(525) },
    });
    await expect(root.lessonSession.delete({ where: { id: lesson.id } })).rejects.toThrow();
    await expect(
      root.lessonSession.create({
        data: {
          ...base,
          lessonNumber: 2,
          startsAt: at(540),
          endsAt: at(530),
        },
      }),
    ).rejects.toThrow();
    await expect(root.lessonSession.update({ where: { id: lesson.id }, data: { status: "HELD" } })).rejects.toThrow();
    await root.lessonSession.update({ where: { id: lesson.id }, data: { status: "HELD", heldMarkedAt: new Date() } });
  });
});

describe("curriculum plans (M2)", () => {
  it("one open and one approved version per lineage; approved items are frozen", async () => {
    const { year } = await yearAndClass();
    const grade = await root.grade.findFirstOrThrow({ where: { tenantId, level: 7 } });
    const subject = await root.subject.create({ data: { tenantId, name: `Demo fan ${crypto.randomUUID()}` } });
    const topic = await root.topic.create({
      data: { tenantId, subjectId: subject.id, gradeId: grade.id, title: "Demo mavzu", normalizedTitle: "demo mavzu" },
    });
    const lineageId = crypto.randomUUID();
    const plan = (version: number, status: "DRAFT" | "APPROVED" = "DRAFT") =>
      root.curriculumPlan.create({
        data: {
          tenantId,
          lineageId,
          version,
          status,
          academicYearId: year.id,
          subjectId: subject.id,
          gradeId: grade.id,
          createdById: crypto.randomUUID(),
          title: "Demo reja",
        },
      });
    const v1 = await plan(1);
    await expect(plan(2)).rejects.toThrow();
    const item = await root.planItem.create({
      data: { tenantId, planId: v1.id, order: 1, topicId: topic.id, hours: 2 },
    });
    await expect(
      root.planItem.create({ data: { tenantId, planId: v1.id, order: 2, topicId: topic.id, hours: 0 } }),
    ).rejects.toThrow();
    await root.curriculumPlan.update({ where: { id: v1.id }, data: { status: "APPROVED" } });
    await expect(root.planItem.update({ where: { id: item.id }, data: { hours: 3 } })).rejects.toThrow();
    await expect(plan(2, "APPROVED")).rejects.toThrow();
    await plan(2); // a new open version next to the approved one is fine
  });
});

describe("score ledger (M3)", () => {
  it("is insert-only; reversals match their entry exactly, once", async () => {
    const { year, cls, student } = await yearAndClass();
    const grade = await root.grade.findFirstOrThrow({ where: { tenantId, level: 7 } });
    const group = await root.teachingGroup.create({
      data: { tenantId, academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name: cls.name },
    });
    const subject = await root.subject.create({ data: { tenantId, name: `Demo fan ${crypto.randomUUID()}` } });
    const teacher = await root.employee.create({ data: { tenantId, firstName: "Demo", lastName: "Ustoz" } });
    const period = await root.academicPeriod.create({
      data: {
        tenantId,
        academicYearId: year.id,
        type: "YEAR",
        name: "Y",
        order: 1,
        startDate: day("2026-09-01"),
        endDate: day("2027-06-30"),
      },
    });
    const at = (minute: number) => atSchoolTime(parseSchoolDate("2026-09-08"), minute);
    const lesson = await root.lessonSession.create({
      data: {
        tenantId,
        academicYearId: year.id,
        periodId: period.id,
        teachingGroupId: group.id,
        subjectId: subject.id,
        teacherId: teacher.id,
        date: day("2026-09-08"),
        lessonNumber: 1,
        sequenceNo: 1,
        startsAt: at(480),
        endsAt: at(525),
      },
    });
    const base = {
      tenantId,
      studentId: student.id,
      teacherId: teacher.id,
      subjectId: subject.id,
      teachingGroupId: group.id,
      gradeId: grade.id,
      lessonSessionId: lesson.id,
      academicYearId: year.id,
      periodId: period.id,
      schoolDate: day("2026-09-08"),
      createdById: crypto.randomUUID(),
    };
    const key = () => crypto.randomUUID();
    const entry = await root.scoreEntry.create({ data: { ...base, points: 5, idempotencyKey: key() } });
    await expect(root.scoreEntry.create({ data: { ...base, points: 0, idempotencyKey: key() } })).rejects.toThrow();
    await expect(root.scoreEntry.update({ where: { id: entry.id }, data: { note: "x" } })).rejects.toThrow();
    await expect(root.scoreEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
    const reversal = (points: number) =>
      root.scoreEntry.create({
        data: { ...base, kind: "REVERSAL", points, reversesEntryId: entry.id, idempotencyKey: key() },
      });
    await expect(reversal(-4)).rejects.toThrow();
    await expect(reversal(5)).rejects.toThrow();
    await reversal(-5);
    await expect(reversal(-5)).rejects.toThrow();
    // Same idempotency key twice in one tenant.
    const k = key();
    await root.scoreEntry.create({ data: { ...base, points: 1, idempotencyKey: k } });
    await expect(root.scoreEntry.create({ data: { ...base, points: 1, idempotencyKey: k } })).rejects.toThrow();
  });

  it("limit rules: one column per scope type, one active rule per scope", async () => {
    const subject = await root.subject.create({ data: { tenantId, name: `Demo fan ${crypto.randomUUID()}` } });
    const rule = (data: { scopeType: "GLOBAL" | "SUBJECT"; subjectId?: string; maxPoints?: number }) =>
      root.scoreLimitRule.create({ data: { tenantId, window: "WEEK", maxPoints: 30, ...data } });
    await expect(rule({ scopeType: "GLOBAL", subjectId: subject.id })).rejects.toThrow();
    await expect(rule({ scopeType: "SUBJECT", subjectId: subject.id, maxPoints: 0 })).rejects.toThrow();
    await rule({ scopeType: "SUBJECT", subjectId: subject.id });
    await expect(rule({ scopeType: "SUBJECT", subjectId: subject.id })).rejects.toThrow();
    await rule({ scopeType: "SUBJECT" });
    await expect(rule({ scopeType: "SUBJECT" })).rejects.toThrow();
  });
});

describe("assessment (M3)", () => {
  it("published policy versions and final results are frozen", async () => {
    const policy = await root.assessmentPolicy.create({ data: { tenantId, name: `P-${crypto.randomUUID()}` } });
    const draft = await root.assessmentPolicyVersion.create({
      data: { tenantId, policyId: policy.id, version: 1, config: { a: 1 }, configHash: "h1" },
    });
    await expect(
      root.assessmentPolicyVersion.create({
        data: { tenantId, policyId: policy.id, version: 2, config: {}, configHash: "h2" },
      }),
    ).rejects.toThrow();
    await root.assessmentPolicyVersion.update({ where: { id: draft.id }, data: { config: { a: 2 } } });
    await root.assessmentPolicyVersion.update({
      where: { id: draft.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await expect(
      root.assessmentPolicyVersion.update({ where: { id: draft.id }, data: { config: { a: 3 } } }),
    ).rejects.toThrow();
    await expect(root.assessmentPolicyVersion.delete({ where: { id: draft.id } })).rejects.toThrow();
    await root.assessmentPolicyVersion.update({ where: { id: draft.id }, data: { status: "RETIRED" } });
    await expect(
      root.assessmentPolicyVersion.update({ where: { id: draft.id }, data: { status: "PUBLISHED" } }),
    ).rejects.toThrow();

    const { year, student } = await yearAndClass();
    const period = await root.academicPeriod.create({
      data: {
        tenantId,
        academicYearId: year.id,
        type: "YEAR",
        name: "Y",
        order: 1,
        startDate: day("2026-09-01"),
        endDate: day("2027-06-30"),
      },
    });
    const result = (version: number) =>
      root.periodResult.create({
        data: {
          tenantId,
          studentId: student.id,
          periodId: period.id,
          policyVersionId: draft.id,
          version,
          components: [],
          maxPoints: 100,
          inputsHash: "x",
          computedAt: new Date(),
          status: "FINAL",
        },
      });
    const final = await result(1);
    await expect(result(2)).rejects.toThrow();
    await expect(root.periodResult.update({ where: { id: final.id }, data: { gradeLabel: "5" } })).rejects.toThrow();
    await expect(root.periodResult.delete({ where: { id: final.id } })).rejects.toThrow();
    await root.periodResult.update({ where: { id: final.id }, data: { isStale: true } });
    await root.periodResult.update({ where: { id: final.id }, data: { isCurrent: false } });
    await expect(root.periodResult.update({ where: { id: final.id }, data: { isCurrent: true } })).rejects.toThrow();
    await result(2);
  });

  it("manual scores stay within their maximum; grade bands within 0–100", async () => {
    const scale = await root.gradeScale.create({ data: { tenantId, name: `S-${crypto.randomUUID()}` } });
    await expect(
      root.gradeScaleBand.create({
        data: { scaleId: scale.id, minPercent: 90, maxPercent: 101, label: "5", order: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      root.gradeScaleBand.create({ data: { scaleId: scale.id, minPercent: 50, maxPercent: 50, label: "5", order: 1 } }),
    ).rejects.toThrow();
    const { year, student } = await yearAndClass();
    const period = await root.academicPeriod.create({
      data: {
        tenantId,
        academicYearId: year.id,
        type: "YEAR",
        name: "Y",
        order: 1,
        startDate: day("2026-09-01"),
        endDate: day("2027-06-30"),
      },
    });
    const subject = await root.subject.create({ data: { tenantId, name: `Demo fan ${crypto.randomUUID()}` } });
    const manual = (points: number) =>
      root.manualAssessmentScore.create({
        data: {
          tenantId,
          periodId: period.id,
          subjectId: subject.id,
          studentId: student.id,
          componentKey: "oral",
          points,
          maxPoints: 20,
          enteredById: crypto.randomUUID(),
        },
      });
    await expect(manual(21)).rejects.toThrow();
    await manual(15);
    await expect(manual(16)).rejects.toThrow();
  });
});
