import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type {
  ArchiveStudentSchema,
  CreateStudentSchema,
  EnrollStudentSchema,
  LinkGuardianSchema,
  StudentDetail,
  StudentListQuerySchema,
  StudentSummary,
  UpdateStudentSchema,
} from "@idrok/shared";
import { cleanName, normalizeUzPhone } from "@idrok/shared";
import { schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import type { z } from "zod";
import type { RequestAuth } from "../../http/auth";
import { AppError, notFound } from "../../http/errors";
import { orderBy, page, skipTake } from "../../http/pagination";
import { resolveScope, studentWhere } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { closeStudent, enrollStudent } from "./enrollment.service";
import { nextStudentCode } from "./student-code";

const day = (d: Date | null) => (d ? schoolDateFromDb(d) : null);

const summarySelect = {
  id: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  middleName: true,
  status: true,
  userId: true,
  enrollments: {
    where: { status: "ACTIVE" as const },
    select: { classGroup: { select: { id: true, name: true } } },
    take: 1,
  },
} satisfies Prisma.StudentSelect;

type SummaryRow = Prisma.StudentGetPayload<{ select: typeof summarySelect }>;

const toSummary = (s: SummaryRow): StudentSummary => ({
  id: s.id,
  studentCode: s.studentCode,
  firstName: s.firstName,
  lastName: s.lastName,
  middleName: s.middleName,
  status: s.status,
  classGroup: s.enrollments[0]?.classGroup ?? null,
  hasAccount: !!s.userId,
});

export function normalizePhoneOrThrow(phone: string, path: string): string {
  const normalized = normalizeUzPhone(phone);
  if (!normalized) throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code: "invalid_phone" }] });
  return normalized;
}

export class StudentsService {
  constructor(private readonly db: Db) {}

  private async scope(auth: RequestAuth) {
    const { timezone, today } = await schoolClock(this.db);
    return { scope: await resolveScope(this.db, auth, timezone), today };
  }

  async list(auth: RequestAuth, q: z.infer<typeof StudentListQuerySchema>) {
    const { scope, today } = await this.scope(auth);
    const search = q.q?.trim();
    const where: Prisma.StudentWhereInput = {
      AND: [
        studentWhere(scope, today),
        q.status ? { status: q.status } : {},
        q.classGroupId ? { enrollments: { some: { classGroupId: q.classGroupId, status: "ACTIVE" } } } : {},
        search
          ? {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
                { studentCode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.db.student.findMany({
        where,
        select: summarySelect,
        orderBy: orderBy(q.sort, ["lastName", "firstName", "studentCode", "createdAt"] as const, [
          { lastName: "asc" },
          { firstName: "asc" },
        ]),
        ...skipTake(q),
      }),
      this.db.student.count({ where }),
    ]);
    return page(items.map(toSummary), total, q);
  }

  /** Detail within the caller's scope; outside it the student "does not exist" (404). */
  async get(auth: RequestAuth, id: string): Promise<StudentDetail> {
    const { scope, today } = await this.scope(auth);
    const s = await this.db.student.findFirst({
      where: { AND: [{ id }, studentWhere(scope, today)] },
      select: {
        ...summarySelect,
        dateOfBirth: true,
        gender: true,
        phone: true,
        address: true,
        notes: true,
        guardians: {
          where: { revokedAt: null },
          select: {
            relation: true,
            isPrimary: true,
            receivesNotifications: true,
            guardian: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        },
      },
    });
    if (!s) throw notFound();
    const enrollments = await this.db.studentEnrollment.findMany({
      where: { studentId: id },
      orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        academicYearId: true,
        classGroupId: true,
        classGroup: { select: { name: true } },
        status: true,
        validFrom: true,
        validTo: true,
        reason: true,
      },
    });
    // Guardian contacts are visible to school-wide roles, class teachers of the student and the guardians themselves.
    const showGuardians =
      scope.kind === "school" ||
      scope.kind === "guardian" ||
      (scope.kind === "teacher" && auth.roles.includes("CLASS_TEACHER"));
    return {
      ...toSummary(s),
      dateOfBirth: day(s.dateOfBirth),
      gender: s.gender,
      phone: s.phone,
      address: s.address,
      notes: scope.kind === "school" || scope.kind === "teacher" ? s.notes : null,
      guardians: showGuardians
        ? s.guardians.map((g) => ({
            guardianId: g.guardian.id,
            firstName: g.guardian.firstName,
            lastName: g.guardian.lastName,
            phone: g.guardian.phone,
            relation: g.relation,
            isPrimary: g.isPrimary,
            receivesNotifications: g.receivesNotifications,
          }))
        : [],
      enrollments: enrollments.map((e) => ({
        id: e.id,
        academicYearId: e.academicYearId,
        classGroupId: e.classGroupId,
        classGroupName: e.classGroup.name,
        status: e.status,
        validFrom: day(e.validFrom)!,
        validTo: day(e.validTo),
        reason: e.reason,
      })),
    };
  }

  async create(auth: RequestAuth, input: z.infer<typeof CreateStudentSchema>) {
    const id = await this.db.$transaction(async (tx) => {
      const settings = await tx.schoolSettings.findFirst({ select: { studentCodePrefix: true } });
      const tenantId = requireTenantId();
      const studentCode = await nextStudentCode(tx, tenantId, settings?.studentCodePrefix ?? "STD");
      const student = await tx.student.create({
        data: {
          tenantId,
          studentCode,
          firstName: cleanName(input.firstName),
          lastName: cleanName(input.lastName),
          middleName: input.middleName ? cleanName(input.middleName) : null,
          dateOfBirth: input.dateOfBirth ? schoolDateToDb(input.dateOfBirth) : null,
          gender: input.gender ?? null,
          phone: input.phone ? normalizePhoneOrThrow(input.phone, "phone") : null,
          address: input.address ?? null,
          notes: input.notes ?? null,
        },
      });
      await writeAudit(tx, {
        action: "student.create",
        entityType: "Student",
        entityId: student.id,
        after: { studentCode },
      });
      if (input.enrollment) {
        await enrollStudent(tx, { studentId: student.id, ...input.enrollment, actorUserId: auth.userId });
      }
      return student.id;
    });
    return this.get(auth, id);
  }

  async update(auth: RequestAuth, id: string, input: z.infer<typeof UpdateStudentSchema>) {
    await this.db.$transaction(async (tx) => {
      const before = await tx.student.findUnique({ where: { id } });
      if (!before) throw notFound();
      const data: Prisma.StudentUpdateInput = {
        ...(input.firstName !== undefined ? { firstName: cleanName(input.firstName) } : {}),
        ...(input.lastName !== undefined ? { lastName: cleanName(input.lastName) } : {}),
        ...(input.middleName !== undefined
          ? { middleName: input.middleName ? cleanName(input.middleName) : null }
          : {}),
        ...(input.dateOfBirth !== undefined
          ? { dateOfBirth: input.dateOfBirth ? schoolDateToDb(input.dateOfBirth) : null }
          : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.phone !== undefined
          ? { phone: input.phone ? normalizePhoneOrThrow(input.phone, "phone") : null }
          : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      await tx.student.update({ where: { id }, data });
      await writeAudit(tx, { action: "student.update", entityType: "Student", entityId: id, before, after: input });
    });
    return this.get(auth, id);
  }

  async enroll(auth: RequestAuth, id: string, input: z.infer<typeof EnrollStudentSchema>) {
    await this.db.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id }, select: { status: true } });
      if (!student) throw notFound();
      if (student.status !== "ACTIVE") throw new AppError("CONFLICT", 409, { reason: "STUDENT_NOT_ACTIVE" });
      await enrollStudent(tx, {
        studentId: id,
        classGroupId: input.classGroupId,
        validFrom: input.validFrom,
        ...(input.reason ? { reason: input.reason } : {}),
        actorUserId: auth.userId,
      });
    });
    return this.get(auth, id);
  }

  async archive(auth: RequestAuth, id: string, input: z.infer<typeof ArchiveStudentSchema>) {
    await this.db.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id },
        select: { status: true, enrollments: { where: { status: "ACTIVE" }, select: { validFrom: true } } },
      });
      if (!student) throw notFound();
      if (student.status !== "ACTIVE") throw new AppError("CONFLICT", 409, { reason: "STUDENT_NOT_ACTIVE" });
      if (student.enrollments.some((e) => schoolDateFromDb(e.validFrom) > input.date)) {
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "date", code: "before_current_enrollment" }] });
      }
      await closeStudent(tx, id, input.status, input.date as SchoolDate);
      await tx.student.update({ where: { id }, data: { status: input.status } });
      await writeAudit(tx, {
        action: "student.archive",
        entityType: "Student",
        entityId: id,
        after: input,
        reason: input.reason ?? null,
      });
    });
    return this.get(auth, id);
  }

  async linkGuardian(auth: RequestAuth, id: string, input: z.infer<typeof LinkGuardianSchema>) {
    await this.db.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id }, select: { id: true } });
      if (!student) throw notFound();
      let guardianId = input.guardianId;
      if (!guardianId && input.newGuardian) {
        const g = input.newGuardian;
        const created = await tx.guardian.create({
          data: {
            tenantId: requireTenantId(),
            firstName: cleanName(g.firstName),
            lastName: cleanName(g.lastName),
            middleName: g.middleName ? cleanName(g.middleName) : null,
            phone: normalizePhoneOrThrow(g.phone, "newGuardian.phone"),
            notes: g.notes ?? null,
          },
        });
        guardianId = created.id;
        await writeAudit(tx, { action: "guardian.create", entityType: "Guardian", entityId: created.id });
      } else if (!guardianId || !(await tx.guardian.findUnique({ where: { id: guardianId } }))) {
        throw notFound({ guardianId });
      }
      if (input.isPrimary) {
        await tx.studentGuardian.updateMany({ where: { studentId: id, isPrimary: true }, data: { isPrimary: false } });
      }
      const existing = await tx.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId: id, guardianId: guardianId! } },
      });
      const link = {
        relation: input.relation,
        isPrimary: input.isPrimary,
        receivesNotifications: input.receivesNotifications,
        revokedAt: null,
      };
      if (existing) await tx.studentGuardian.update({ where: { id: existing.id }, data: link });
      else
        await tx.studentGuardian.create({
          data: { tenantId: requireTenantId(), studentId: id, guardianId: guardianId!, ...link },
        });
      await writeAudit(tx, {
        action: "student.guardian_link",
        entityType: "Student",
        entityId: id,
        after: { guardianId, ...link },
      });
    });
    return this.get(auth, id);
  }

  async unlinkGuardian(id: string, guardianId: string) {
    await this.db.$transaction(async (tx) => {
      const link = await tx.studentGuardian.findFirst({ where: { studentId: id, guardianId, revokedAt: null } });
      if (!link) throw notFound();
      await tx.studentGuardian.update({ where: { id: link.id }, data: { revokedAt: new Date(), isPrimary: false } });
      await writeAudit(tx, {
        action: "student.guardian_unlink",
        entityType: "Student",
        entityId: id,
        after: { guardianId },
      });
    });
  }

  /** Portal: a guardian's children. */
  async myChildren(auth: RequestAuth) {
    const { scope, today } = await this.scope(auth);
    if (scope.kind !== "guardian") return [];
    const items = await this.db.student.findMany({
      where: studentWhere(scope, today),
      select: summarySelect,
      orderBy: { firstName: "asc" },
    });
    return items.map(toSummary);
  }
}
