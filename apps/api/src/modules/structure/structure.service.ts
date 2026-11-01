import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type { z } from "zod";
import type {
  ClassGroupListQuerySchema,
  CreateAcademicYearSchema,
  CreateClassGroupSchema,
  CreateGradeSchema,
  CreateSubgroupSchema,
  CreateSubjectSchema,
  CreateTeacherAssignmentSchema,
  TeacherAssignmentListQuerySchema,
  UpdateAcademicYearSchema,
  UpdateClassGroupSchema,
  UpdateMembersSchema,
  UpdateSubjectSchema,
} from "@idrok/shared";
import { schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { AppError, notFound } from "../../http/errors";
import { orderBy, page, skipTake } from "../../http/pagination";
import type { RequestAuth } from "../../http/auth";
import { writeAudit } from "../audit/audit.service";
import { classGroupWhere, resolveScope, activeOn } from "../access/scope";
import { schoolClock } from "../access/school-clock";

const day = (d: Date | null) => (d ? schoolDateFromDb(d) : null);

export class StructureService {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------- academic years

  async listYears() {
    const years = await this.db.academicYear.findMany({ orderBy: { startDate: "desc" } });
    return years.map((y) => ({
      id: y.id,
      name: y.name,
      startDate: day(y.startDate)!,
      endDate: day(y.endDate)!,
      status: y.status,
    }));
  }

  async createYear(input: z.infer<typeof CreateAcademicYearSchema>) {
    return this.db.$transaction(async (tx) => {
      const year = await tx.academicYear.create({
        data: {
          tenantId: requireTenantId(),
          name: input.name,
          startDate: schoolDateToDb(input.startDate),
          endDate: schoolDateToDb(input.endDate),
        },
      });
      await writeAudit(tx, {
        action: "academic_year.create",
        entityType: "AcademicYear",
        entityId: year.id,
        after: input,
      });
      return { id: year.id, name: year.name, startDate: input.startDate, endDate: input.endDate, status: year.status };
    });
  }

  async updateYear(id: string, input: z.infer<typeof UpdateAcademicYearSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.academicYear.findUnique({ where: { id } });
      if (!before) throw notFound();
      const start = input.startDate ?? schoolDateFromDb(before.startDate);
      const end = input.endDate ?? schoolDateFromDb(before.endDate);
      if (start > end)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "endDate", code: "end_before_start" }] });
      const year = await tx.academicYear.update({
        where: { id },
        data: { startDate: schoolDateToDb(start), endDate: schoolDateToDb(end) },
      });
      await writeAudit(tx, {
        action: "academic_year.update",
        entityType: "AcademicYear",
        entityId: id,
        before,
        after: input,
      });
      return { id, name: year.name, startDate: start, endDate: end, status: year.status };
    });
  }

  /** Makes this year the current one; the previous ACTIVE year is CLOSED (one ACTIVE per tenant, SQL-enforced). */
  async activateYear(id: string) {
    return this.db.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw notFound();
      if (year.status === "ACTIVE") return { id, status: year.status };
      if (year.status === "ARCHIVED") throw new AppError("CONFLICT", 409, { reason: "YEAR_ARCHIVED" });
      const previous = await tx.academicYear.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
      if (previous) await tx.academicYear.update({ where: { id: previous.id }, data: { status: "CLOSED" } });
      await tx.academicYear.update({ where: { id }, data: { status: "ACTIVE" } });
      await writeAudit(tx, {
        action: "academic_year.activate",
        entityType: "AcademicYear",
        entityId: id,
        before: { activeYearId: previous?.id ?? null },
        after: { activeYearId: id },
      });
      return { id, status: "ACTIVE" as const };
    });
  }

  // ---------------------------------------------------------------- grades

  async listGrades() {
    const grades = await this.db.grade.findMany({ where: { archivedAt: null }, orderBy: { level: "asc" } });
    return grades.map((g) => ({ id: g.id, level: g.level, name: g.name }));
  }

  async createGrade(input: z.infer<typeof CreateGradeSchema>) {
    return this.db.$transaction(async (tx) => {
      const g = await tx.grade.create({ data: { tenantId: requireTenantId(), ...input } });
      await writeAudit(tx, { action: "grade.create", entityType: "Grade", entityId: g.id, after: input });
      return { id: g.id, level: g.level, name: g.name };
    });
  }

  // ---------------------------------------------------------------- class groups

  private classSelect = {
    id: true,
    academicYearId: true,
    gradeId: true,
    grade: { select: { level: true } },
    section: true,
    name: true,
    homeroomTeacherId: true,
    capacity: true,
    shiftId: true,
    teachingGroups: { where: { kind: "CLASS" as const }, select: { id: true } },
    _count: { select: { enrollments: { where: { status: "ACTIVE" as const } } } },
  } satisfies Prisma.ClassGroupSelect;

  private toClassDto(c: Prisma.ClassGroupGetPayload<{ select: StructureService["classSelect"] }>) {
    return {
      id: c.id,
      academicYearId: c.academicYearId,
      gradeId: c.gradeId,
      gradeLevel: c.grade.level,
      section: c.section,
      name: c.name,
      homeroomTeacherId: c.homeroomTeacherId,
      capacity: c.capacity,
      shiftId: c.shiftId,
      studentCount: c._count.enrollments,
      classTeachingGroupId: c.teachingGroups[0]?.id ?? null,
    };
  }

  async listClassGroups(auth: RequestAuth, q: z.infer<typeof ClassGroupListQuerySchema>) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const where: Prisma.ClassGroupWhereInput = {
      AND: [
        classGroupWhere(scope),
        { archivedAt: null },
        q.academicYearId ? { academicYearId: q.academicYearId } : {},
        q.gradeId ? { gradeId: q.gradeId } : {},
        q.q ? { name: { contains: q.q, mode: "insensitive" } } : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.db.classGroup.findMany({
        where,
        select: this.classSelect,
        orderBy: orderBy(q.sort, ["name", "createdAt"] as const, [{ name: "asc" }]),
        ...skipTake(q),
      }),
      this.db.classGroup.count({ where }),
    ]);
    return page(
      items.map((c) => this.toClassDto(c)),
      total,
      q,
    );
  }

  async getClassGroup(auth: RequestAuth, id: string) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const c = await this.db.classGroup.findFirst({
      where: { AND: [{ id }, classGroupWhere(scope)] },
      select: this.classSelect,
    });
    if (!c) throw notFound();
    return this.toClassDto(c);
  }

  async createClassGroup(input: z.infer<typeof CreateClassGroupSchema>) {
    return this.db.$transaction(async (tx) => {
      const [year, grade] = await Promise.all([
        tx.academicYear.findUnique({ where: { id: input.academicYearId } }),
        tx.grade.findUnique({ where: { id: input.gradeId } }),
      ]);
      if (!year || !grade) throw notFound();
      if (input.homeroomTeacherId && !(await tx.employee.findUnique({ where: { id: input.homeroomTeacherId } })))
        throw notFound();
      if (input.shiftId && !(await tx.shift.findFirst({ where: { id: input.shiftId, archivedAt: null } })))
        throw notFound();
      const name = `${grade.level}-${input.section}`;
      const cls = await tx.classGroup.create({
        data: {
          tenantId: requireTenantId(),
          academicYearId: year.id,
          gradeId: grade.id,
          section: input.section,
          name,
          homeroomTeacherId: input.homeroomTeacherId ?? null,
          capacity: input.capacity ?? null,
          shiftId: input.shiftId ?? null,
        },
        select: { id: true },
      });
      // Every class has exactly one whole-class teaching group (SQL-enforced).
      await tx.teachingGroup.create({
        data: { tenantId: requireTenantId(), academicYearId: year.id, classGroupId: cls.id, kind: "CLASS", name },
      });
      await writeAudit(tx, {
        action: "class_group.create",
        entityType: "ClassGroup",
        entityId: cls.id,
        after: { ...input, name },
      });
      return this.toClassDto(
        await tx.classGroup.findUniqueOrThrow({ where: { id: cls.id }, select: this.classSelect }),
      );
    });
  }

  async updateClassGroup(id: string, input: z.infer<typeof UpdateClassGroupSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.classGroup.findUnique({ where: { id } });
      if (!before) throw notFound();
      if (input.homeroomTeacherId && !(await tx.employee.findUnique({ where: { id: input.homeroomTeacherId } })))
        throw notFound();
      if (input.shiftId && !(await tx.shift.findFirst({ where: { id: input.shiftId, archivedAt: null } })))
        throw notFound();
      await tx.classGroup.update({ where: { id }, data: input });
      await writeAudit(tx, {
        action: "class_group.update",
        entityType: "ClassGroup",
        entityId: id,
        before,
        after: input,
      });
      return this.toClassDto(await tx.classGroup.findUniqueOrThrow({ where: { id }, select: this.classSelect }));
    });
  }

  // ---------------------------------------------------------------- teaching groups

  async listTeachingGroups(auth: RequestAuth, classGroupId?: string) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const scopeWhere: Prisma.TeachingGroupWhereInput =
      scope.kind === "school"
        ? {}
        : scope.kind === "teacher"
          ? { OR: [{ id: { in: scope.teachingGroupIds } }, { classGroupId: { in: scope.homeroomClassIds } }] }
          : { id: { in: [] } };
    const groups = await this.db.teachingGroup.findMany({
      where: { AND: [scopeWhere, { archivedAt: null }, classGroupId ? { classGroupId } : {}] },
      orderBy: [{ name: "asc" }],
    });
    return groups.map((g) => ({
      id: g.id,
      academicYearId: g.academicYearId,
      classGroupId: g.classGroupId,
      kind: g.kind,
      name: g.name,
      subjectId: g.subjectId,
    }));
  }

  async createSubgroup(input: z.infer<typeof CreateSubgroupSchema>) {
    return this.db.$transaction(async (tx) => {
      const cls = await tx.classGroup.findUnique({ where: { id: input.classGroupId } });
      if (!cls) throw notFound();
      if (input.subjectId && !(await tx.subject.findUnique({ where: { id: input.subjectId } }))) throw notFound();
      const g = await tx.teachingGroup.create({
        data: {
          tenantId: requireTenantId(),
          academicYearId: cls.academicYearId,
          classGroupId: cls.id,
          kind: "SUBGROUP",
          name: input.name,
          subjectId: input.subjectId ?? null,
        },
      });
      await writeAudit(tx, {
        action: "teaching_group.create",
        entityType: "TeachingGroup",
        entityId: g.id,
        after: input,
      });
      return {
        id: g.id,
        academicYearId: g.academicYearId,
        classGroupId: g.classGroupId,
        kind: g.kind,
        name: g.name,
        subjectId: g.subjectId,
      };
    });
  }

  /** Subgroup membership; whole-class groups follow enrollments and cannot be edited here. */
  async updateMembers(groupId: string, input: z.infer<typeof UpdateMembersSchema>) {
    return this.db.$transaction(async (tx) => {
      const group = await tx.teachingGroup.findUnique({ where: { id: groupId } });
      if (!group) throw notFound();
      if (group.kind === "CLASS") throw new AppError("CONFLICT", 409, { reason: "CLASS_GROUP_FOLLOWS_ENROLLMENT" });
      for (const r of input.remove) {
        const open = await tx.teachingGroupMember.findFirst({
          where: { teachingGroupId: groupId, studentId: r.studentId, validTo: null },
        });
        if (!open) throw notFound({ studentId: r.studentId });
        if (schoolDateFromDb(open.validFrom) > r.validTo) {
          throw new AppError("VALIDATION_ERROR", 400, {
            fields: [{ path: "remove.validTo", code: "before_valid_from" }],
          });
        }
        await tx.teachingGroupMember.update({ where: { id: open.id }, data: { validTo: schoolDateToDb(r.validTo) } });
      }
      for (const a of input.add) {
        // The student must be enrolled in the subgroup's class.
        const enrolled = await tx.studentEnrollment.findFirst({
          where: { studentId: a.studentId, classGroupId: group.classGroupId ?? undefined, status: "ACTIVE" },
        });
        if (!enrolled) throw new AppError("CONFLICT", 409, { reason: "NOT_IN_CLASS", studentId: a.studentId });
        await tx.teachingGroupMember.create({
          data: {
            tenantId: requireTenantId(),
            teachingGroupId: groupId,
            studentId: a.studentId,
            validFrom: schoolDateToDb(a.validFrom),
          },
        });
      }
      await writeAudit(tx, {
        action: "teaching_group.members",
        entityType: "TeachingGroup",
        entityId: groupId,
        after: input,
      });
      const members = await tx.teachingGroupMember.findMany({
        where: { teachingGroupId: groupId, validTo: null },
        select: { studentId: true },
      });
      return { members: members.map((m) => m.studentId) };
    });
  }

  // ---------------------------------------------------------------- subjects

  private subjectDto(s: {
    id: string;
    name: string;
    shortName: string | null;
    code: string | null;
    colorKey: string | null;
    order: number;
    archivedAt: Date | null;
  }) {
    return {
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      code: s.code,
      colorKey: s.colorKey,
      order: s.order,
      archived: !!s.archivedAt,
    };
  }

  async listSubjects(includeArchived: boolean) {
    const items = await this.db.subject.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return items.map((s) => this.subjectDto(s));
  }

  async createSubject(input: z.infer<typeof CreateSubjectSchema>) {
    return this.db.$transaction(async (tx) => {
      const s = await tx.subject.create({ data: { tenantId: requireTenantId(), ...input } });
      await writeAudit(tx, { action: "subject.create", entityType: "Subject", entityId: s.id, after: input });
      return this.subjectDto(s);
    });
  }

  async updateSubject(id: string, input: z.infer<typeof UpdateSubjectSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.subject.findUnique({ where: { id } });
      if (!before) throw notFound();
      const { archived, ...rest } = input;
      const s = await tx.subject.update({
        where: { id },
        data: {
          ...rest,
          ...(archived === undefined ? {} : { archivedAt: archived ? (before.archivedAt ?? new Date()) : null }),
        },
      });
      await writeAudit(tx, { action: "subject.update", entityType: "Subject", entityId: id, before, after: input });
      return this.subjectDto(s);
    });
  }

  // ---------------------------------------------------------------- teacher assignments

  private assignmentSelect = {
    id: true,
    academicYearId: true,
    teacherId: true,
    teacher: { select: { firstName: true, lastName: true } },
    teachingGroupId: true,
    teachingGroup: { select: { name: true } },
    subjectId: true,
    subject: { select: { name: true } },
    weeklyHours: true,
    validFrom: true,
    validTo: true,
  } satisfies Prisma.TeacherAssignmentSelect;

  private assignmentDto(a: Prisma.TeacherAssignmentGetPayload<{ select: StructureService["assignmentSelect"] }>) {
    return {
      id: a.id,
      academicYearId: a.academicYearId,
      teacherId: a.teacherId,
      teacherName: `${a.teacher.lastName} ${a.teacher.firstName}`,
      teachingGroupId: a.teachingGroupId,
      teachingGroupName: a.teachingGroup.name,
      subjectId: a.subjectId,
      subjectName: a.subject.name,
      weeklyHours: a.weeklyHours?.toString() ?? null,
      validFrom: day(a.validFrom)!,
      validTo: day(a.validTo),
    };
  }

  async listAssignments(auth: RequestAuth, q: z.infer<typeof TeacherAssignmentListQuerySchema>) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    // Teachers see their own assignments only.
    const scopeWhere: Prisma.TeacherAssignmentWhereInput =
      scope.kind === "school" ? {} : scope.kind === "teacher" ? { teacherId: scope.employeeId } : { id: { in: [] } };
    const where: Prisma.TeacherAssignmentWhereInput = {
      AND: [
        scopeWhere,
        q.academicYearId ? { academicYearId: q.academicYearId } : {},
        q.teacherId ? { teacherId: q.teacherId } : {},
        q.teachingGroupId ? { teachingGroupId: q.teachingGroupId } : {},
        q.subjectId ? { subjectId: q.subjectId } : {},
        q.activeOn ? activeOn(q.activeOn) : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.db.teacherAssignment.findMany({
        where,
        select: this.assignmentSelect,
        orderBy: [{ validFrom: "desc" }],
        ...skipTake(q),
      }),
      this.db.teacherAssignment.count({ where }),
    ]);
    return page(
      items.map((a) => this.assignmentDto(a)),
      total,
      q,
    );
  }

  async createAssignment(input: z.infer<typeof CreateTeacherAssignmentSchema>) {
    return this.db.$transaction(async (tx) => {
      const [teacher, group, subject] = await Promise.all([
        tx.employee.findUnique({ where: { id: input.teacherId } }),
        tx.teachingGroup.findUnique({ where: { id: input.teachingGroupId } }),
        tx.subject.findUnique({ where: { id: input.subjectId } }),
      ]);
      if (!teacher || !group || !subject) throw notFound();
      const a = await tx.teacherAssignment.create({
        data: {
          tenantId: requireTenantId(),
          academicYearId: group.academicYearId,
          teacherId: teacher.id,
          teachingGroupId: group.id,
          subjectId: subject.id,
          weeklyHours: input.weeklyHours ?? null,
          validFrom: schoolDateToDb(input.validFrom),
        },
        select: this.assignmentSelect,
      });
      await writeAudit(tx, {
        action: "teacher_assignment.create",
        entityType: "TeacherAssignment",
        entityId: a.id,
        after: input,
      });
      return this.assignmentDto(a);
    });
  }

  async endAssignment(id: string, validTo: SchoolDate) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.teacherAssignment.findUnique({ where: { id } });
      if (!before) throw notFound();
      if (schoolDateFromDb(before.validFrom) > validTo) {
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "validTo", code: "before_valid_from" }] });
      }
      const a = await tx.teacherAssignment.update({
        where: { id },
        data: { validTo: schoolDateToDb(validTo) },
        select: this.assignmentSelect,
      });
      await writeAudit(tx, {
        action: "teacher_assignment.end",
        entityType: "TeacherAssignment",
        entityId: id,
        before,
        after: { validTo },
      });
      return this.assignmentDto(a);
    });
  }
}
