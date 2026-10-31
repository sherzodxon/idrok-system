// Applies one preview row. Each row runs in its own transaction and records targetEntityId, so a retried commit job
// skips rows that were already applied. Accounts get temporary passwords that are collected for the one-time
// credentials file; they are never stored (security-baseline.md S3).
import { requireTenantId, type DbTransaction } from "@idrok/db";
import { schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { writeAudit } from "../audit/audit.service";
import { enrollStudent } from "../people/enrollment.service";
import { nextStudentCode } from "../people/student-code";
import type { AccountsService, Actor } from "../users/accounts.service";
import type { ClassRowData, EmployeeRowData, StudentRowData, SubjectRowData } from "./parse";

export interface Credential {
  kind: "STUDENT" | "GUARDIAN" | "EMPLOYEE";
  name: string;
  username: string;
  temporaryPassword: string;
}

export interface CommitContext {
  tx: DbTransaction;
  actor: Actor;
  accounts: AccountsService;
  validFrom: SchoolDate;
  minGrade: number;
  credentials: Credential[];
}

export type RowOutcome = { targetEntityId: string; action: "CREATED" | "UPDATED" | "UNCHANGED" };

export async function commitStudentRow(ctx: CommitContext, d: StudentRowData): Promise<RowOutcome> {
  const { tx } = ctx;
  const tenantId = requireTenantId();
  let studentId = d.matchedStudentId;
  let action: RowOutcome["action"] = "UPDATED";
  const fields = {
    firstName: d.firstName,
    lastName: d.lastName,
    middleName: d.middleName,
    dateOfBirth: d.dateOfBirth ? schoolDateToDb(d.dateOfBirth as SchoolDate) : null,
    gender: d.gender,
    phone: d.phone,
    address: d.address,
  };
  if (studentId) {
    await tx.student.update({ where: { id: studentId }, data: fields });
  } else {
    const settings = await tx.schoolSettings.findFirst({ select: { studentCodePrefix: true } });
    const studentCode = await nextStudentCode(tx, tenantId, settings?.studentCodePrefix ?? "STD");
    studentId = (await tx.student.create({ data: { tenantId, studentCode, ...fields }, select: { id: true } })).id;
    action = "CREATED";
  }

  // Placement: enrol or transfer when the class differs.
  const active = await tx.studentEnrollment.findFirst({
    where: { studentId, status: "ACTIVE", classGroupId: d.classGroupId! },
  });
  if (!active) {
    const anyActive = await tx.studentEnrollment.findFirst({
      where: {
        studentId,
        status: "ACTIVE",
        classGroup: {
          academicYearId: (await tx.classGroup.findUniqueOrThrow({ where: { id: d.classGroupId! } })).academicYearId,
        },
      },
    });
    const from =
      anyActive && schoolDateFromDb(anyActive.validFrom) > ctx.validFrom
        ? schoolDateFromDb(anyActive.validFrom)
        : ctx.validFrom;
    await enrollStudent(tx, {
      studentId,
      classGroupId: d.classGroupId!,
      validFrom: from,
      reason: "import",
      actorUserId: ctx.actor.userId,
    });
  }

  for (const g of d.guardians) {
    const guardian =
      (await tx.guardian.findFirst({ where: { phone: g.phone }, select: { id: true, userId: true } })) ??
      (await tx.guardian.create({
        data: { tenantId, firstName: g.firstName, lastName: g.lastName, phone: g.phone },
        select: { id: true, userId: true },
      }));
    await tx.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
      create: { tenantId, studentId, guardianId: guardian.id, relation: g.relation },
      update: { relation: g.relation, revokedAt: null },
    });
    if (!guardian.userId) {
      const acc = await ctx.accounts.createGuardianAccount(ctx.actor, guardian.id, tx);
      ctx.credentials.push({ kind: "GUARDIAN", name: `${g.lastName} ${g.firstName}`, ...acc });
    }
  }

  const student = await tx.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      userId: true,
      enrollments: {
        where: { status: "ACTIVE" },
        select: { classGroup: { select: { grade: { select: { level: true } } } } },
      },
    },
  });
  const level = student.enrollments[0]?.classGroup.grade.level ?? -1;
  const wantsAccount = d.createAccount ?? level >= ctx.minGrade;
  if (wantsAccount && !student.userId) {
    const acc = await ctx.accounts.createStudentAccount(ctx.actor, studentId, true, tx);
    ctx.credentials.push({ kind: "STUDENT", name: `${d.lastName} ${d.firstName}`, ...acc });
  }
  return { targetEntityId: studentId, action };
}

export async function commitEmployeeRow(ctx: CommitContext, d: EmployeeRowData): Promise<RowOutcome> {
  const { tx } = ctx;
  const tenantId = requireTenantId();
  let employeeId = d.matchedEmployeeId;
  let action: RowOutcome["action"] = "UPDATED";
  const fields = {
    firstName: d.firstName,
    lastName: d.lastName,
    middleName: d.middleName,
    phone: d.phone,
    positionTitle: d.positionTitle,
  };
  if (employeeId) {
    await tx.employee.update({
      where: { id: employeeId },
      data: { ...fields, ...(d.employeeCode ? { employeeCode: d.employeeCode } : {}) },
    });
  } else {
    employeeId = (
      await tx.employee.create({ data: { tenantId, employeeCode: d.employeeCode, ...fields }, select: { id: true } })
    ).id;
    action = "CREATED";
  }
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { userId: true } });
  if (!employee.userId) {
    const roles = await tx.role.findMany({ where: { code: { in: d.roles }, archivedAt: null }, select: { id: true } });
    const acc = await ctx.accounts.createEmployeeAccount(
      ctx.actor,
      employeeId,
      roles.map((r) => r.id),
      tx,
    );
    ctx.credentials.push({ kind: "EMPLOYEE", name: `${d.lastName} ${d.firstName}`, ...acc });
  }
  if (d.homeroomClassId)
    await tx.classGroup.update({ where: { id: d.homeroomClassId }, data: { homeroomTeacherId: employeeId } });
  for (const a of d.assignments) {
    const exists = await tx.teacherAssignment.findFirst({
      where: { teacherId: employeeId, teachingGroupId: a.teachingGroupId, subjectId: a.subjectId, validTo: null },
    });
    if (exists) continue;
    const group = await tx.teachingGroup.findUniqueOrThrow({
      where: { id: a.teachingGroupId },
      select: { academicYearId: true },
    });
    await tx.teacherAssignment.create({
      data: {
        tenantId,
        academicYearId: group.academicYearId,
        teacherId: employeeId,
        teachingGroupId: a.teachingGroupId,
        subjectId: a.subjectId,
        validFrom: schoolDateToDb(ctx.validFrom),
      },
    });
  }
  return { targetEntityId: employeeId, action };
}

export async function commitClassRow(ctx: CommitContext, d: ClassRowData, academicYearId: string): Promise<RowOutcome> {
  const { tx } = ctx;
  const tenantId = requireTenantId();
  const name = `${d.level}-${d.section}`;
  const existing = await tx.classGroup.findFirst({ where: { academicYearId, name }, select: { id: true } });
  if (existing) return { targetEntityId: existing.id, action: "UNCHANGED" };
  const grade =
    (await tx.grade.findFirst({ where: { level: d.level }, select: { id: true } })) ??
    (await tx.grade.create({ data: { tenantId, level: d.level, name: String(d.level) }, select: { id: true } }));
  const cls = await tx.classGroup.create({
    data: {
      tenantId,
      academicYearId,
      gradeId: grade.id,
      section: d.section,
      name,
      capacity: d.capacity,
      homeroomTeacherId: d.homeroomEmployeeId,
    },
    select: { id: true },
  });
  await tx.teachingGroup.create({ data: { tenantId, academicYearId, classGroupId: cls.id, kind: "CLASS", name } });
  return { targetEntityId: cls.id, action: "CREATED" };
}

export async function commitSubjectRow(ctx: CommitContext, d: SubjectRowData): Promise<RowOutcome> {
  const existing = await ctx.tx.subject.findFirst({
    where: { name: { equals: d.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return { targetEntityId: existing.id, action: "UNCHANGED" };
  const s = await ctx.tx.subject.create({
    data: { tenantId: requireTenantId(), name: d.name, shortName: d.shortName, code: d.code },
    select: { id: true },
  });
  return { targetEntityId: s.id, action: "CREATED" };
}

export async function auditCommit(tx: DbTransaction, importJobId: string, summary: Record<string, number>) {
  await writeAudit(tx, { action: "import.commit", entityType: "ImportJob", entityId: importJobId, after: summary });
}
