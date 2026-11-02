// Score criteria, the school's score settings (caps, session maximum, late entry) and limit rules (scoring.md §2).
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type {
  CreateScoreLimitRuleSchema,
  UpdateScoreLimitRuleSchema,
  UpdateScoreSettingsSchema,
  UpsertScoreCriterionSchema,
} from "@idrok/shared";
import { AppError, isConstraintError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";
import type { LimitRule, LimitSettings } from "../../domain/score-limits";

const criterionSelect = { id: true, name: true, description: true, isActive: true, order: true } as const;

const ruleSelect = {
  id: true,
  window: true,
  scopeType: true,
  subjectId: true,
  subject: { select: { name: true } },
  gradeId: true,
  grade: { select: { name: true } },
  teacherId: true,
  teacher: { select: { firstName: true, lastName: true } },
  teachingGroupId: true,
  teachingGroup: { select: { name: true } },
  maxPoints: true,
  isActive: true,
} satisfies Prisma.ScoreLimitRuleSelect;
type RuleRow = Prisma.ScoreLimitRuleGetPayload<{ select: typeof ruleSelect }>;

const scopeIdOf = (r: Pick<RuleRow, "subjectId" | "gradeId" | "teacherId" | "teachingGroupId">) =>
  r.subjectId ?? r.gradeId ?? r.teacherId ?? r.teachingGroupId;

function ruleDto(r: RuleRow) {
  const scopeName =
    r.subject?.name ??
    r.grade?.name ??
    (r.teacher ? `${r.teacher.lastName} ${r.teacher.firstName}` : null) ??
    r.teachingGroup?.name ??
    null;
  return {
    id: r.id,
    window: r.window,
    scopeType: r.scopeType,
    scopeId: scopeIdOf(r),
    scopeName,
    maxPoints: r.maxPoints.toString(),
    isActive: r.isActive,
  };
}

/** The domain shape of the active rules (limits are checked against these). */
export async function activeLimitRules(tx: DbTransaction | Db): Promise<LimitRule[]> {
  const rows = await tx.scoreLimitRule.findMany({ where: { isActive: true }, select: ruleSelect });
  return rows.map((r) => ({ window: r.window, scopeType: r.scopeType, scopeId: scopeIdOf(r), maxPoints: r.maxPoints }));
}

/** The settings row, created with the defaults (Q-06, Q-07) the first time it is needed. */
export async function scoreSettings(tx: DbTransaction | Db) {
  const existing = await tx.scoreSettings.findFirst();
  return existing ?? tx.scoreSettings.create({ data: { tenantId: requireTenantId() } });
}

export const limitSettings = (s: Awaited<ReturnType<typeof scoreSettings>>): LimitSettings => ({
  hardCapPerLesson: s.hardCapPerLesson,
  hardCapPerDay: s.hardCapPerDay,
  lessonMaxPoints: s.lessonMaxPoints,
});

export const settingsDto = (s: Awaited<ReturnType<typeof scoreSettings>>) => ({
  hardCapPerLesson: s.hardCapPerLesson.toString(),
  hardCapPerDay: s.hardCapPerDay.toString(),
  lessonMaxPoints: s.lessonMaxPoints.toString(),
  allowScoreOnAbsent: s.allowScoreOnAbsent,
  lateEntryDays: s.lateEntryDays,
});

export class ScoreConfigService {
  constructor(private readonly db: Db) {}

  listCriteria(activeOnly: boolean) {
    return this.db.scoreCriterion.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: criterionSelect,
    });
  }

  async createCriterion(input: z.infer<typeof UpsertScoreCriterionSchema>) {
    return this.db.$transaction(async (tx) => {
      const created = await tx.scoreCriterion.create({
        data: { tenantId: requireTenantId(), ...input, description: input.description ?? null },
        select: criterionSelect,
      });
      await writeAudit(tx, {
        action: "score_criterion.create",
        entityType: "ScoreCriterion",
        entityId: created.id,
        after: input,
      });
      return created;
    });
  }

  async updateCriterion(id: string, input: z.infer<typeof UpsertScoreCriterionSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.scoreCriterion.findUnique({ where: { id }, select: criterionSelect });
      if (!before) throw notFound();
      const updated = await tx.scoreCriterion.update({ where: { id }, data: input, select: criterionSelect });
      await writeAudit(tx, {
        action: "score_criterion.update",
        entityType: "ScoreCriterion",
        entityId: id,
        before,
        after: input,
      });
      return updated;
    });
  }

  async getSettings() {
    return settingsDto(await scoreSettings(this.db));
  }

  async updateSettings(input: z.infer<typeof UpdateScoreSettingsSchema>, userId: string) {
    return this.db.$transaction(async (tx) => {
      const before = await scoreSettings(tx);
      const updated = await tx.scoreSettings.update({
        where: { id: before.id },
        data: { ...input, updatedById: userId },
      });
      await writeAudit(tx, {
        action: "score_settings.update",
        entityType: "ScoreSettings",
        entityId: before.id,
        before: settingsDto(before),
        after: input,
      });
      return settingsDto(updated);
    });
  }

  async listRules() {
    const rows = await this.db.scoreLimitRule.findMany({
      orderBy: [{ isActive: "desc" }, { window: "asc" }, { scopeType: "asc" }, { createdAt: "asc" }],
      select: ruleSelect,
    });
    return rows.map(ruleDto);
  }

  async createRule(input: z.infer<typeof CreateScoreLimitRuleSchema>) {
    const column = {
      GLOBAL: null,
      SUBJECT: "subjectId",
      GRADE: "gradeId",
      TEACHER: "teacherId",
      TEACHING_GROUP: "teachingGroupId",
    }[input.scopeType];
    return this.db.$transaction(async (tx) => {
      // The scope row must belong to this school (a foreign key alone would accept another tenant's id).
      if (input.scopeId) {
        const where = { where: { id: input.scopeId }, select: { id: true } };
        const found =
          input.scopeType === "SUBJECT"
            ? await tx.subject.findFirst(where)
            : input.scopeType === "GRADE"
              ? await tx.grade.findFirst(where)
              : input.scopeType === "TEACHER"
                ? await tx.employee.findFirst(where)
                : await tx.teachingGroup.findFirst(where);
        if (!found) throw notFound();
      }
      try {
        const created = await tx.scoreLimitRule.create({
          data: {
            tenantId: requireTenantId(),
            window: input.window,
            scopeType: input.scopeType,
            maxPoints: input.maxPoints,
            ...(column && input.scopeId ? { [column]: input.scopeId } : {}),
          },
          select: ruleSelect,
        });
        await writeAudit(tx, {
          action: "score_limit.create",
          entityType: "ScoreLimitRule",
          entityId: created.id,
          after: input,
        });
        return ruleDto(created);
      } catch (err) {
        if (isConstraintError(err, "ScoreLimitRule_one_active"))
          throw new AppError("CONFLICT", 409, { reason: "RULE_EXISTS" });
        throw err;
      }
    });
  }

  async updateRule(id: string, input: z.infer<typeof UpdateScoreLimitRuleSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.scoreLimitRule.findUnique({ where: { id }, select: ruleSelect });
      if (!before) throw notFound();
      try {
        const updated = await tx.scoreLimitRule.update({ where: { id }, data: input, select: ruleSelect });
        await writeAudit(tx, {
          action: "score_limit.update",
          entityType: "ScoreLimitRule",
          entityId: id,
          before: ruleDto(before),
          after: input,
        });
        return ruleDto(updated);
      } catch (err) {
        if (isConstraintError(err, "ScoreLimitRule_one_active"))
          throw new AppError("CONFLICT", 409, { reason: "RULE_EXISTS" });
        throw err;
      }
    });
  }
}
