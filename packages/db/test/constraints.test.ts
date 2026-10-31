// Behaviour of the SQL-only invariants, including under concurrency.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolDateToDb, parseSchoolDate } from "@idrok/shared/time";
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
