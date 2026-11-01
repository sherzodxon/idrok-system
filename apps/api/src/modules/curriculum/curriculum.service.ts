// M2 step 4: topics and versioned curriculum plans with the approval flow (lesson-plan.md §4.1, §4.5).
// Teachers write plans only for the subjects and grades they teach (an active assignment to a group of that grade);
// school-wide roles for any. Only DRAFT/REJECTED versions are edited; an APPROVED one changes through a new version.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import {
  normalizeText,
  type CreateCurriculumPlanSchema,
  type CreateTopicSchema,
  type PlanImportOptions,
  type PlanTemplateQuerySchema,
  type CurriculumPlanListQuerySchema,
  type PlanItemInput,
  type TopicQuerySchema,
  type UpdateCurriculumPlanSchema,
} from "@idrok/shared";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { page, skipTake } from "../../http/pagination";
import { schoolClock } from "../access/school-clock";
import { activeOn, resolveScope } from "../access/scope";
import { writeAudit } from "../audit/audit.service";
import { schoolDateFromDb } from "@idrok/shared/time";
import { clearPlanFromGroup, placePlanOnGroup } from "./placement";
import { buildPlanTemplate } from "./plan-template";

const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError("CONFLICT", 409, { reason, ...details });
const fieldError = (path: string, code: string) => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });

const planInclude = {
  subject: { select: { name: true } },
  grade: { select: { name: true } },
  author: { select: { firstName: true, lastName: true } },
  items: { select: { hours: true } },
} satisfies Prisma.CurriculumPlanInclude;
type PlanRow = Prisma.CurriculumPlanGetPayload<{ include: typeof planInclude }>;

/** Who may write which plans: everything (school roles) or the caller's subject + grade pairs. */
export interface WriteScope {
  school: boolean;
  employeeId: string | null;
  pairs: Set<string>;
}
const pairKey = (subjectId: string, gradeId: string) => `${subjectId}|${gradeId}`;

export class CurriculumService {
  constructor(private readonly db: Db) {}

  async writeScope(auth: RequestAuth): Promise<WriteScope> {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const employee = await this.db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } });
    if (scope.kind === "school") return { school: true, employeeId: employee?.id ?? null, pairs: new Set() };
    if (scope.kind !== "teacher") return { school: false, employeeId: null, pairs: new Set() };
    const assignments = await this.db.teacherAssignment.findMany({
      where: { teacherId: scope.employeeId, ...activeOn(today) },
      select: { subjectId: true, teachingGroup: { select: { classGroup: { select: { gradeId: true } } } } },
    });
    return {
      school: false,
      employeeId: scope.employeeId,
      pairs: new Set(
        assignments.flatMap((a) =>
          a.teachingGroup.classGroup ? [pairKey(a.subjectId, a.teachingGroup.classGroup.gradeId)] : [],
        ),
      ),
    };
  }

  private canWrite(scope: WriteScope, plan: { subjectId: string; gradeId: string; authorId: string | null }) {
    if (scope.school) return true;
    // A teacher edits plans of their own subjects and grades that they wrote themselves.
    return scope.pairs.has(pairKey(plan.subjectId, plan.gradeId)) && plan.authorId === scope.employeeId;
  }

  private summary(p: PlanRow, scope: WriteScope) {
    return {
      id: p.id,
      lineageId: p.lineageId,
      version: p.version,
      academicYearId: p.academicYearId,
      subjectId: p.subjectId,
      subjectName: p.subject.name,
      gradeId: p.gradeId,
      gradeName: p.grade.name,
      title: p.title,
      status: p.status,
      authorId: p.authorId,
      authorName: p.author ? `${p.author.lastName} ${p.author.firstName}` : null,
      itemCount: p.items.length,
      totalHours: p.items.reduce((sum, i) => sum + i.hours, 0),
      submittedAt: p.submittedAt?.toISOString() ?? null,
      approvedAt: p.approvedAt?.toISOString() ?? null,
      rejectionNote: p.rejectionNote,
      updatedAt: p.updatedAt.toISOString(),
      canEdit: this.canWrite(scope, p),
    };
  }

  // ---------------------------------------------------------------- topics

  async listTopics(q: z.infer<typeof TopicQuerySchema>) {
    const search = q.q ? normalizeText(q.q) : undefined;
    const topics = await this.db.topic.findMany({
      where: {
        subjectId: q.subjectId,
        gradeId: q.gradeId,
        archivedAt: null,
        ...(search ? { normalizedTitle: { contains: search } } : {}),
      },
      orderBy: { title: "asc" },
      take: 200,
    });
    return topics.map((t) => ({ id: t.id, subjectId: t.subjectId, gradeId: t.gradeId, title: t.title, code: t.code }));
  }

  async createTopic(auth: RequestAuth, input: z.infer<typeof CreateTopicSchema>) {
    const scope = await this.writeScope(auth);
    if (!scope.school && !scope.pairs.has(pairKey(input.subjectId, input.gradeId))) throw forbidden();
    return this.db.$transaction(async (tx) => {
      const topic = await this.resolveTopic(tx, input.subjectId, input.gradeId, input.title, input.code ?? null);
      return { id: topic.id, subjectId: topic.subjectId, gradeId: topic.gradeId, title: topic.title, code: topic.code };
    });
  }

  /** The topic with this (normalised) title in the subject + grade, created if new. */
  private async resolveTopic(
    tx: DbTransaction,
    subjectId: string,
    gradeId: string,
    title: string,
    code: string | null,
  ) {
    const normalizedTitle = normalizeText(title);
    const existing = await tx.topic.findFirst({ where: { subjectId, gradeId, normalizedTitle } });
    if (existing) return existing;
    return tx.topic.create({
      data: { tenantId: requireTenantId(), subjectId, gradeId, title: title.trim(), normalizedTitle, code },
    });
  }

  // ---------------------------------------------------------------- plans

  async list(auth: RequestAuth, q: z.infer<typeof CurriculumPlanListQuerySchema>) {
    const scope = await this.writeScope(auth);
    const where: Prisma.CurriculumPlanWhereInput = {
      AND: [
        q.academicYearId ? { academicYearId: q.academicYearId } : {},
        q.subjectId ? { subjectId: q.subjectId } : {},
        q.gradeId ? { gradeId: q.gradeId } : {},
        q.status ? { status: q.status } : { status: { not: "ARCHIVED" } },
        q.mine ? { authorId: scope.employeeId ?? "00000000-0000-0000-0000-000000000000" } : {},
        q.q ? { title: { contains: q.q, mode: "insensitive" } } : {},
        q.sourceImportId ? { sourceImportId: q.sourceImportId } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.db.curriculumPlan.findMany({
        where,
        include: planInclude,
        orderBy: [{ updatedAt: "desc" }],
        ...skipTake(q),
      }),
      this.db.curriculumPlan.count({ where }),
    ]);
    return page(
      rows.map((p) => this.summary(p, scope)),
      total,
      q,
    );
  }

  private async detail(tx: DbTransaction | Db, id: string, scope: WriteScope) {
    const plan = await tx.curriculumPlan.findUnique({ where: { id }, include: planInclude });
    if (!plan) throw notFound();
    const [items, versions] = await Promise.all([
      tx.planItem.findMany({
        where: { planId: id },
        orderBy: { order: "asc" },
        include: { topic: { select: { title: true } } },
      }),
      tx.curriculumPlan.findMany({
        where: { lineageId: plan.lineageId },
        orderBy: { version: "desc" },
        select: { id: true, version: true, status: true },
      }),
    ]);
    return {
      ...this.summary(plan, scope),
      items: items.map((i) => ({
        id: i.id,
        order: i.order,
        topicId: i.topicId,
        topicTitle: i.topic.title,
        hours: i.hours,
        lessonType: i.lessonType,
        periodId: i.periodId,
        objectives: i.objectives,
        homework: i.homework,
        resources: i.resources,
        notes: i.notes,
      })),
      versions,
    };
  }

  async get(auth: RequestAuth, id: string) {
    return this.detail(this.db, id, await this.writeScope(auth));
  }

  /** Replaces the items of an editable version; topics are matched or created within the plan's subject + grade. */
  private async writeItems(
    tx: DbTransaction,
    plan: { id: string; academicYearId: string; subjectId: string; gradeId: string },
    items: PlanItemInput[],
  ) {
    const periodIds = [...new Set(items.map((i) => i.periodId).filter((p): p is string => !!p))];
    if (periodIds.length) {
      const found = await tx.academicPeriod.count({
        where: { id: { in: periodIds }, academicYearId: plan.academicYearId },
      });
      if (found !== periodIds.length) throw fieldError("items.periodId", "invalid");
    }
    const tenantId = requireTenantId();
    const rows = [];
    for (const [index, item] of items.entries()) {
      let topicId = item.topicId;
      if (topicId) {
        const topic = await tx.topic.findUnique({ where: { id: topicId } });
        if (!topic || topic.subjectId !== plan.subjectId || topic.gradeId !== plan.gradeId)
          throw fieldError(`items.${index}.topicId`, "invalid");
      } else {
        topicId = (await this.resolveTopic(tx, plan.subjectId, plan.gradeId, item.topicTitle!, null)).id;
      }
      rows.push({
        tenantId,
        planId: plan.id,
        order: index + 1,
        topicId,
        hours: item.hours,
        lessonType: item.lessonType ?? "NEW",
        periodId: item.periodId ?? null,
        objectives: item.objectives ?? null,
        homework: item.homework ?? null,
        resources: item.resources ?? null,
        notes: item.notes ?? null,
      });
    }
    await tx.planItem.deleteMany({ where: { planId: plan.id } });
    if (rows.length) await tx.planItem.createMany({ data: rows });
  }

  async create(auth: RequestAuth, input: z.infer<typeof CreateCurriculumPlanSchema>) {
    const scope = await this.writeScope(auth);
    if (!scope.school && !scope.pairs.has(pairKey(input.subjectId, input.gradeId))) throw forbidden();
    return this.db.$transaction(async (tx) => {
      const [year, subject, grade] = await Promise.all([
        tx.academicYear.findUnique({ where: { id: input.academicYearId } }),
        tx.subject.findUnique({ where: { id: input.subjectId } }),
        tx.grade.findUnique({ where: { id: input.gradeId } }),
      ]);
      if (!year || !subject || !grade) throw notFound();
      if (year.status === "ARCHIVED") throw conflict("YEAR_ARCHIVED");
      const plan = await tx.curriculumPlan.create({
        data: {
          tenantId: requireTenantId(),
          lineageId: randomUUID(),
          version: 1,
          academicYearId: year.id,
          subjectId: subject.id,
          gradeId: grade.id,
          authorId: scope.employeeId,
          createdById: auth.userId,
          title: input.title,
        },
      });
      await this.writeItems(tx, plan, input.items);
      await writeAudit(tx, {
        action: "curriculum_plan.create",
        entityType: "CurriculumPlan",
        entityId: plan.id,
        after: { title: input.title, items: input.items.length },
      });
      return this.detail(tx, plan.id, scope);
    });
  }

  /**
   * A plan from an import (lesson-plan.md §4.3): a new plan, or — with `planId` — a new DRAFT version of that plan's
   * lineage. The previous versions are not touched. Runs in the worker inside the importer's tenant context.
   */
  async createFromImport(
    tx: DbTransaction,
    input: {
      academicYearId: string;
      subjectId: string;
      gradeId: string;
      planId?: string;
      title: string;
      userId: string;
      importJobId: string;
      items: PlanItemInput[];
    },
  ) {
    const employee = await tx.employee.findUnique({ where: { userId: input.userId }, select: { id: true } });
    let lineageId: string = randomUUID();
    let version = 1;
    let title = input.title;
    if (input.planId) {
      const base = await tx.curriculumPlan.findUnique({ where: { id: input.planId } });
      if (!base) throw notFound();
      const open = await tx.curriculumPlan.findFirst({
        where: { lineageId: base.lineageId, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } },
        select: { id: true },
      });
      if (open) throw conflict("PLAN_HAS_OPEN_VERSION", { planId: open.id });
      const last = await tx.curriculumPlan.aggregate({ where: { lineageId: base.lineageId }, _max: { version: true } });
      lineageId = base.lineageId;
      version = (last._max.version ?? base.version) + 1;
      title = base.title;
    }
    const plan = await tx.curriculumPlan.create({
      data: {
        tenantId: requireTenantId(),
        lineageId,
        version,
        academicYearId: input.academicYearId,
        subjectId: input.subjectId,
        gradeId: input.gradeId,
        authorId: employee?.id ?? null,
        createdById: input.userId,
        title,
        sourceImportId: input.importJobId,
      },
    });
    await this.writeItems(tx, plan, input.items);
    await writeAudit(tx, {
      action: "curriculum_plan.import",
      entityType: "CurriculumPlan",
      entityId: plan.id,
      after: { importJobId: input.importJobId, version, items: input.items.length },
    });
    return plan;
  }

  private async editable(tx: DbTransaction, auth: RequestAuth, id: string) {
    const scope = await this.writeScope(auth);
    const plan = await tx.curriculumPlan.findUnique({ where: { id } });
    if (!plan) throw notFound();
    if (!this.canWrite(scope, plan)) throw forbidden();
    return { plan, scope };
  }

  async update(auth: RequestAuth, id: string, input: z.infer<typeof UpdateCurriculumPlanSchema>) {
    return this.db.$transaction(async (tx) => {
      const { plan, scope } = await this.editable(tx, auth, id);
      if (plan.status !== "DRAFT" && plan.status !== "REJECTED") throw conflict("PLAN_NOT_EDITABLE");
      // Editing a rejected version reopens it as a draft (the rejection note stays visible until resubmitted).
      await tx.curriculumPlan.update({ where: { id }, data: { title: input.title, status: "DRAFT" } });
      if (input.items) await this.writeItems(tx, plan, input.items);
      await writeAudit(tx, {
        action: "curriculum_plan.update",
        entityType: "CurriculumPlan",
        entityId: id,
        after: { title: input.title, items: input.items?.length },
      });
      return this.detail(tx, id, scope);
    });
  }

  /**
   * The approved version before this one is archived and its groups move to this version (acceptance 12: until this
   * moment the old version stays in force). Lessons with a fixed topic keep it; the rest are placed anew.
   */
  private async approveIn(tx: DbTransaction, id: string, lineageId: string, approvedById: string | null) {
    const previous = await tx.curriculumPlan.findMany({
      where: { lineageId, status: "APPROVED" },
      select: { id: true },
    });
    const moving = await tx.planAssignment.findMany({
      where: { planId: { in: previous.map((p) => p.id) }, status: "ACTIVE" },
    });
    await tx.planAssignment.updateMany({
      where: { id: { in: moving.map((a) => a.id) } },
      data: { status: "SUPERSEDED", endedAt: new Date() },
    });
    await tx.curriculumPlan.updateMany({ where: { lineageId, status: "APPROVED" }, data: { status: "ARCHIVED" } });
    const plan = await tx.curriculumPlan.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById, rejectionNote: null },
    });
    const { today } = await schoolClock(this.db);
    for (const a of moving) {
      await tx.planAssignment.create({
        data: {
          tenantId: a.tenantId,
          planId: id,
          teachingGroupId: a.teachingGroupId,
          subjectId: a.subjectId,
          appliedById: approvedById ?? a.appliedById,
        },
      });
      await placePlanOnGroup(
        tx,
        {
          planId: id,
          teachingGroupId: a.teachingGroupId,
          subjectId: a.subjectId,
          academicYearId: plan.academicYearId,
          today,
        },
        true,
      );
    }
  }

  async submit(auth: RequestAuth, id: string) {
    return this.db.$transaction(async (tx) => {
      const { plan, scope } = await this.editable(tx, auth, id);
      if (plan.status !== "DRAFT" && plan.status !== "REJECTED") throw conflict("PLAN_NOT_EDITABLE");
      if (!(await tx.planItem.count({ where: { planId: id } }))) throw conflict("PLAN_EMPTY");
      const settings = await tx.schoolSettings.findFirst({ select: { planApprovalRequired: true } });
      await tx.curriculumPlan.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
      const autoApprove = settings?.planApprovalRequired === false;
      if (autoApprove) await this.approveIn(tx, id, plan.lineageId, null);
      await writeAudit(tx, {
        action: autoApprove ? "curriculum_plan.approve" : "curriculum_plan.submit",
        entityType: "CurriculumPlan",
        entityId: id,
        after: { autoApprove },
      });
      return this.detail(tx, id, scope);
    });
  }

  async approve(auth: RequestAuth, id: string) {
    return this.db.$transaction(async (tx) => {
      const plan = await tx.curriculumPlan.findUnique({ where: { id } });
      if (!plan) throw notFound();
      if (plan.status !== "SUBMITTED") throw conflict("PLAN_NOT_SUBMITTED");
      await this.approveIn(tx, id, plan.lineageId, auth.userId);
      await writeAudit(tx, { action: "curriculum_plan.approve", entityType: "CurriculumPlan", entityId: id });
      return this.detail(tx, id, await this.writeScope(auth));
    });
  }

  async reject(auth: RequestAuth, id: string, note: string) {
    return this.db.$transaction(async (tx) => {
      const plan = await tx.curriculumPlan.findUnique({ where: { id } });
      if (!plan) throw notFound();
      if (plan.status !== "SUBMITTED") throw conflict("PLAN_NOT_SUBMITTED");
      await tx.curriculumPlan.update({ where: { id }, data: { status: "REJECTED", rejectionNote: note } });
      await writeAudit(tx, {
        action: "curriculum_plan.reject",
        entityType: "CurriculumPlan",
        entityId: id,
        after: { note },
      });
      return this.detail(tx, id, await this.writeScope(auth));
    });
  }

  /** An approved plan changes through a new DRAFT copy; the approved one stays in force until that is approved. */
  async newVersion(auth: RequestAuth, id: string) {
    return this.db.$transaction(async (tx) => {
      const { plan, scope } = await this.editable(tx, auth, id);
      if (plan.status !== "APPROVED") throw conflict("PLAN_NOT_APPROVED");
      const open = await tx.curriculumPlan.findFirst({
        where: { lineageId: plan.lineageId, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } },
        select: { id: true },
      });
      if (open) throw conflict("PLAN_HAS_OPEN_VERSION", { planId: open.id });
      const last = await tx.curriculumPlan.aggregate({ where: { lineageId: plan.lineageId }, _max: { version: true } });
      const next = await tx.curriculumPlan.create({
        data: {
          tenantId: requireTenantId(),
          lineageId: plan.lineageId,
          version: (last._max.version ?? plan.version) + 1,
          academicYearId: plan.academicYearId,
          subjectId: plan.subjectId,
          gradeId: plan.gradeId,
          authorId: scope.employeeId ?? plan.authorId,
          createdById: auth.userId,
          title: plan.title,
        },
      });
      const items = await tx.planItem.findMany({ where: { planId: id }, orderBy: { order: "asc" } });
      if (items.length)
        await tx.planItem.createMany({
          data: items.map(({ id: _id, planId: _planId, ...rest }) => ({ ...rest, planId: next.id })),
        });
      await writeAudit(tx, {
        action: "curriculum_plan.new_version",
        entityType: "CurriculumPlan",
        entityId: next.id,
        after: { from: id, version: next.version },
      });
      return this.detail(tx, next.id, scope);
    });
  }

  // ---------------------------------------------------------------- applying to groups

  private async assignmentDto(
    tx: DbTransaction | Db,
    a: { id: string; planId: string; teachingGroupId: string; subjectId: string; status: string; appliedAt: Date },
    plan: { academicYearId: string },
  ) {
    const { today } = await schoolClock(this.db);
    const group = await tx.teachingGroup.findUniqueOrThrow({
      where: { id: a.teachingGroupId },
      select: { name: true, kind: true, classGroup: { select: { name: true } } },
    });
    const stats = await placePlanOnGroup(
      tx as DbTransaction,
      {
        planId: a.planId,
        teachingGroupId: a.teachingGroupId,
        subjectId: a.subjectId,
        academicYearId: plan.academicYearId,
        today,
      },
      false,
    );
    return {
      id: a.id,
      planId: a.planId,
      teachingGroupId: a.teachingGroupId,
      teachingGroupName:
        group.kind === "SUBGROUP" && group.classGroup ? `${group.classGroup.name} · ${group.name}` : group.name,
      status: a.status as "ACTIVE" | "SUPERSEDED" | "REMOVED",
      appliedAt: a.appliedAt.toISOString(),
      lessons: stats.lessons,
      plannedHours: stats.plannedHours,
      placed: stats.placed,
      freeLessons: stats.freeLessons,
      warnings: stats.warnings,
    };
  }

  /**
   * Applies an approved plan to groups (acceptance 10: one template, each group its own dates, the same topics).
   * A teacher only to groups where they teach the plan's subject (acceptance 11). Another plan in force for the same
   * group and subject is replaced.
   */
  async assign(auth: RequestAuth, planId: string, groupIds: string[]) {
    const scope = await this.writeScope(auth);
    const { timezone, today } = await schoolClock(this.db);
    const teacherScope = await resolveScope(this.db, auth, timezone);
    return this.db.$transaction(async (tx) => {
      const plan = await tx.curriculumPlan.findUnique({ where: { id: planId } });
      if (!plan) throw notFound();
      if (plan.status !== "APPROVED") throw conflict("PLAN_NOT_APPROVED");
      const groups = await tx.teachingGroup.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, academicYearId: true, archivedAt: true, classGroup: { select: { gradeId: true } } },
      });
      if (groups.length !== new Set(groupIds).size) throw notFound();
      for (const [i, g] of groups.entries()) {
        if (g.academicYearId !== plan.academicYearId || g.archivedAt || g.classGroup?.gradeId !== plan.gradeId)
          throw fieldError(`teachingGroupIds.${i}`, "group_grade_mismatch");
      }
      if (!scope.school) {
        const own =
          teacherScope.kind === "teacher"
            ? await tx.teacherAssignment.findMany({
                where: {
                  teacherId: teacherScope.employeeId,
                  subjectId: plan.subjectId,
                  teachingGroupId: { in: groupIds },
                  ...activeOn(today),
                },
                select: { teachingGroupId: true },
              })
            : [];
        const allowed = new Set(own.map((a) => a.teachingGroupId));
        if (groupIds.some((id) => !allowed.has(id))) throw forbidden();
      }
      const results = [];
      for (const groupId of new Set(groupIds)) {
        const current = await tx.planAssignment.findFirst({
          where: { teachingGroupId: groupId, subjectId: plan.subjectId, status: "ACTIVE" },
        });
        let assignment = current?.planId === planId ? current : null;
        if (!assignment) {
          if (current)
            await tx.planAssignment.update({
              where: { id: current.id },
              data: { status: "SUPERSEDED", endedAt: new Date() },
            });
          assignment = await tx.planAssignment.create({
            data: {
              tenantId: requireTenantId(),
              planId,
              teachingGroupId: groupId,
              subjectId: plan.subjectId,
              appliedById: auth.userId,
            },
          });
        }
        await placePlanOnGroup(
          tx,
          { planId, teachingGroupId: groupId, subjectId: plan.subjectId, academicYearId: plan.academicYearId, today },
          true,
        );
        results.push(await this.assignmentDto(tx, assignment, plan));
      }
      await writeAudit(tx, {
        action: "curriculum_plan.assign",
        entityType: "CurriculumPlan",
        entityId: planId,
        after: { teachingGroupIds: [...new Set(groupIds)] },
      });
      return results;
    });
  }

  async listAssignments(planId: string) {
    const plan = await this.db.curriculumPlan.findUnique({ where: { id: planId } });
    if (!plan) throw notFound();
    const rows = await this.db.planAssignment.findMany({
      where: { planId, status: "ACTIVE" },
      orderBy: { appliedAt: "asc" },
    });
    const result = [];
    for (const a of rows) result.push(await this.assignmentDto(this.db, a, plan));
    return result;
  }

  async removeAssignment(auth: RequestAuth, id: string) {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await this.writeScope(auth);
    const teacherScope = await resolveScope(this.db, auth, timezone);
    await this.db.$transaction(async (tx) => {
      const a = await tx.planAssignment.findUnique({ where: { id }, include: { plan: true } });
      if (!a || a.status !== "ACTIVE") throw notFound();
      if (!scope.school) {
        const own =
          teacherScope.kind === "teacher" &&
          (await tx.teacherAssignment.count({
            where: {
              teacherId: teacherScope.employeeId,
              subjectId: a.subjectId,
              teachingGroupId: a.teachingGroupId,
              ...activeOn(today),
            },
          }));
        if (!own) throw forbidden();
      }
      await tx.planAssignment.update({ where: { id }, data: { status: "REMOVED", endedAt: new Date() } });
      await clearPlanFromGroup(tx, {
        teachingGroupId: a.teachingGroupId,
        subjectId: a.subjectId,
        academicYearId: a.plan.academicYearId,
        today,
      });
      await writeAudit(tx, {
        action: "curriculum_plan.unassign",
        entityType: "PlanAssignment",
        entityId: id,
        before: { planId: a.planId, teachingGroupId: a.teachingGroupId },
      });
    });
  }

  // ---------------------------------------------------------------- Excel

  async template(q: z.infer<typeof PlanTemplateQuerySchema>) {
    if (q.mode === "TOPICS") return buildPlanTemplate(q.locale, null);
    if (!q.teachingGroupId) throw fieldError("teachingGroupId", "required");
    const lessons = await this.db.lessonSession.findMany({
      where: {
        teachingGroupId: q.teachingGroupId,
        subjectId: q.subjectId,
        academicYearId: q.academicYearId,
        status: { not: "CANCELLED" },
      },
      orderBy: [{ sequenceNo: "asc" }, { date: "asc" }],
      select: { date: true, period: { select: { name: true } } },
    });
    return buildPlanTemplate(
      q.locale,
      lessons.map((l) => ({ date: schoolDateFromDb(l.date), periodName: l.period.name })),
    );
  }

  /** The importer may write this plan (subject + grade, and the plan to version if any). */
  async checkImport(auth: RequestAuth, options: PlanImportOptions) {
    const scope = await this.writeScope(auth);
    if (!scope.school && !scope.pairs.has(pairKey(options.subjectId, options.gradeId))) throw forbidden();
    const year = await this.db.academicYear.findUnique({ where: { id: options.academicYearId } });
    if (!year) throw notFound();
    if (options.planId) {
      const plan = await this.db.curriculumPlan.findUnique({ where: { id: options.planId } });
      if (!plan) throw notFound();
      if (plan.subjectId !== options.subjectId || plan.gradeId !== options.gradeId)
        throw fieldError("planId", "invalid");
      if (!this.canWrite(scope, plan)) throw forbidden();
      const open = await this.db.curriculumPlan.findFirst({
        where: { lineageId: plan.lineageId, status: { in: ["DRAFT", "SUBMITTED", "REJECTED"] } },
        select: { id: true },
      });
      if (open) throw conflict("PLAN_HAS_OPEN_VERSION", { planId: open.id });
    }
  }
}
