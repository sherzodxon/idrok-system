// A student's class in a year. History is kept: a transfer closes the old enrollment and the old whole-class group
// membership the day before, and opens new ones (data-model.md §3). Same-day placement corrections cancel the old row.
import { requireTenantId, type DbTransaction } from "@idrok/db";
import { addSchoolDays, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { AppError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";

export async function enrollStudent(
  tx: DbTransaction,
  input: { studentId: string; classGroupId: string; validFrom: SchoolDate; reason?: string; actorUserId?: string },
) {
  const cls = await tx.classGroup.findUnique({
    where: { id: input.classGroupId },
    select: {
      id: true,
      academicYearId: true,
      academicYear: { select: { startDate: true, endDate: true } },
      teachingGroups: { where: { kind: "CLASS" }, select: { id: true } },
    },
  });
  if (!cls) throw notFound({ classGroupId: input.classGroupId });
  const classGroupTg = cls.teachingGroups[0]?.id;
  if (!classGroupTg) throw new AppError("CONFLICT", 409, { reason: "CLASS_WITHOUT_GROUP" });
  const yearStart = schoolDateFromDb(cls.academicYear.startDate);
  const yearEnd = schoolDateFromDb(cls.academicYear.endDate);
  if (input.validFrom < yearStart || input.validFrom > yearEnd) {
    throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "validFrom", code: "outside_academic_year" }] });
  }

  const current = await tx.studentEnrollment.findFirst({
    where: { studentId: input.studentId, academicYearId: cls.academicYearId, status: "ACTIVE" },
  });
  if (current?.classGroupId === cls.id) throw new AppError("CONFLICT", 409, { reason: "ALREADY_IN_CLASS" });

  if (current) {
    const currentFrom = schoolDateFromDb(current.validFrom);
    if (input.validFrom < currentFrom) {
      throw new AppError("VALIDATION_ERROR", 400, {
        fields: [{ path: "validFrom", code: "before_current_enrollment" }],
      });
    }
    const correction = input.validFrom === currentFrom;
    const closeOn = correction ? currentFrom : addSchoolDays(input.validFrom, -1);
    await tx.studentEnrollment.update({
      where: { id: current.id },
      data: { status: correction ? "CANCELLED" : "TRANSFERRED", validTo: schoolDateToDb(closeOn) },
    });
    // Close the membership of the old whole-class group.
    const oldMembership = await tx.teachingGroupMember.findFirst({
      where: {
        studentId: input.studentId,
        validTo: null,
        teachingGroup: { classGroupId: current.classGroupId, kind: "CLASS" },
      },
    });
    if (oldMembership) {
      if (correction) {
        // Placed in the wrong class from day one: the membership simply moves.
        await tx.teachingGroupMember.update({
          where: { id: oldMembership.id },
          data: { teachingGroupId: classGroupTg },
        });
      } else {
        await tx.teachingGroupMember.update({
          where: { id: oldMembership.id },
          data: { validTo: schoolDateToDb(closeOn) },
        });
      }
    }
    // Subgroups of the old class end too.
    await tx.teachingGroupMember.updateMany({
      where: {
        studentId: input.studentId,
        validTo: null,
        teachingGroup: { classGroupId: current.classGroupId, kind: "SUBGROUP" },
      },
      data: { validTo: schoolDateToDb(correction ? currentFrom : closeOn) },
    });
    if (correction && oldMembership) {
      const enrollment = await createEnrollment(tx, input, cls.academicYearId);
      await audit(tx, input, current, enrollment.id);
      return enrollment;
    }
  }

  const enrollment = await createEnrollment(tx, input, cls.academicYearId);
  await tx.teachingGroupMember.create({
    data: {
      tenantId: requireTenantId(),
      teachingGroupId: classGroupTg,
      studentId: input.studentId,
      validFrom: schoolDateToDb(input.validFrom),
    },
  });
  await audit(tx, input, current, enrollment.id);
  return enrollment;
}

function createEnrollment(
  tx: DbTransaction,
  input: { studentId: string; classGroupId: string; validFrom: SchoolDate; reason?: string; actorUserId?: string },
  academicYearId: string,
) {
  return tx.studentEnrollment.create({
    data: {
      tenantId: requireTenantId(),
      studentId: input.studentId,
      academicYearId,
      classGroupId: input.classGroupId,
      validFrom: schoolDateToDb(input.validFrom),
      reason: input.reason ?? null,
      createdById: input.actorUserId ?? null,
    },
  });
}

function audit(
  tx: DbTransaction,
  input: { studentId: string; classGroupId: string; validFrom: SchoolDate; reason?: string },
  previous: { id: string; classGroupId: string } | null,
  enrollmentId: string,
) {
  return writeAudit(tx, {
    action: previous ? "student.transfer" : "student.enroll",
    entityType: "Student",
    entityId: input.studentId,
    before: previous ? { classGroupId: previous.classGroupId, enrollmentId: previous.id } : null,
    after: { classGroupId: input.classGroupId, validFrom: input.validFrom, enrollmentId },
    reason: input.reason ?? null,
  });
}

/** Ends the student's active enrollments and memberships (left school or graduated). */
export async function closeStudent(
  tx: DbTransaction,
  studentId: string,
  status: "LEFT" | "GRADUATED",
  date: SchoolDate,
) {
  const d = schoolDateToDb(date);
  await tx.studentEnrollment.updateMany({ where: { studentId, status: "ACTIVE" }, data: { status, validTo: d } });
  await tx.teachingGroupMember.updateMany({ where: { studentId, validTo: null }, data: { validTo: d } });
}
