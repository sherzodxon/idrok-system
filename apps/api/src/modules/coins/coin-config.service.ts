// Coin settings, criteria (with the teachers allowed to use them), limit rules and automatic rules (MASTER_SPEC §14).
// Configuration rows in use are deactivated, never deleted; every change is audited in the same transaction.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import {
  AttendanceRuleConfigSchema,
  TestResultRuleConfigSchema,
  type CoinAutoRuleDto,
  type SetCriterionTeachersSchema,
  type UpdateCoinSettingsSchema,
  type UpsertCoinAutoRuleSchema,
  type UpsertCoinCriterionSchema,
  type UpsertCoinLimitRuleSchema,
} from "@idrok/shared";
import type { CoinLimit } from "../../domain/coins";
import { AppError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";
import { coinSettings } from "./ledger";

const invalid = (path: string, code = "invalid") => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });

const criterionSelect = {
  id: true,
  name: true,
  description: true,
  type: true,
  minAmount: true,
  maxAmount: true,
  subjectId: true,
  subject: { select: { name: true } },
  eligibility: true,
  isAutomatic: true,
  isActive: true,
  teachers: { select: { teacherId: true } },
  _count: { select: { transactions: true } },
} satisfies Prisma.CoinCriterionSelect;
type CriterionRow = Prisma.CoinCriterionGetPayload<{ select: typeof criterionSelect }>;

const criterionDto = (c: CriterionRow) => ({
  id: c.id,
  name: c.name,
  description: c.description,
  type: c.type,
  minAmount: c.minAmount,
  maxAmount: c.maxAmount,
  subjectId: c.subjectId,
  subjectName: c.subject?.name ?? null,
  eligibility: c.eligibility,
  isAutomatic: c.isAutomatic,
  isActive: c.isActive,
  teacherIds: c.teachers.map((t) => t.teacherId),
  transactionCount: c._count.transactions,
});

const limitSelect = {
  id: true,
  scope: true,
  criterionId: true,
  criterion: { select: { name: true } },
  teacherId: true,
  teacher: { select: { firstName: true, lastName: true } },
  type: true,
  period: true,
  durationMinutes: true,
  maxAmount: true,
  maxCount: true,
  countTypesSeparately: true,
  isActive: true,
} satisfies Prisma.CoinLimitRuleSelect;
type LimitRow = Prisma.CoinLimitRuleGetPayload<{ select: typeof limitSelect }>;

const limitDto = (r: LimitRow) => ({
  id: r.id,
  scope: r.scope,
  criterionId: r.criterionId,
  criterionName: r.criterion?.name ?? null,
  teacherId: r.teacherId,
  teacherName: r.teacher ? `${r.teacher.lastName} ${r.teacher.firstName}` : null,
  type: r.type,
  period: r.period,
  durationMinutes: r.durationMinutes,
  maxAmount: r.maxAmount,
  maxCount: r.maxCount,
  countTypesSeparately: r.countTypesSeparately,
  isActive: r.isActive,
});

/** The domain shape of the active limit rules. */
export async function activeCoinLimits(tx: DbTransaction | Db): Promise<CoinLimit[]> {
  const rows = await tx.coinLimitRule.findMany({ where: { isActive: true }, select: limitSelect });
  return rows.map(({ criterion: _c, teacher: _t, isActive: _a, ...r }) => r);
}

const autoRuleSelect = {
  id: true,
  source: true,
  criterionId: true,
  criterion: { select: { name: true } },
  config: true,
  isActive: true,
} satisfies Prisma.CoinAutoRuleSelect;
type AutoRuleRow = Prisma.CoinAutoRuleGetPayload<{ select: typeof autoRuleSelect }>;

const autoRuleDto = (r: AutoRuleRow): CoinAutoRuleDto => {
  const base = { id: r.id, criterionId: r.criterionId, criterionName: r.criterion.name, isActive: r.isActive };
  return r.source === "ATTENDANCE"
    ? { ...base, source: "ATTENDANCE", config: AttendanceRuleConfigSchema.parse(r.config) }
    : { ...base, source: "TEST_RESULT", config: TestResultRuleConfigSchema.parse(r.config) };
};

export class CoinConfigService {
  constructor(private readonly db: Db) {}

  // ---- settings

  getSettings() {
    return coinSettings(this.db);
  }

  async updateSettings(userId: string, input: z.infer<typeof UpdateCoinSettingsSchema>) {
    if (!input.allowNegativeBalance && input.maxDebt !== null) throw invalid("maxDebt", "debt_disabled");
    return this.db.$transaction(async (tx) => {
      const before = await coinSettings(tx);
      await tx.coinSettings.upsert({
        where: { tenantId: requireTenantId() },
        create: { tenantId: requireTenantId(), ...input, updatedById: userId },
        update: { ...input, updatedById: userId },
      });
      await writeAudit(tx, { action: "coins.settings.update", entityType: "CoinSettings", before, after: input });
      return coinSettings(tx);
    });
  }

  // ---- criteria

  async listCriteria(activeOnly: boolean) {
    const rows = await this.db.coinCriterion.findMany({
      where: activeOnly ? { isActive: true } : {},
      select: criterionSelect,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return rows.map(criterionDto);
  }

  private async checkSubject(tx: DbTransaction, subjectId: string | null | undefined) {
    if (subjectId && !(await tx.subject.findFirst({ where: { id: subjectId }, select: { id: true } })))
      throw invalid("subjectId");
  }

  async createCriterion(input: z.infer<typeof UpsertCoinCriterionSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.checkSubject(tx, input.subjectId);
      const c = await tx.coinCriterion.create({
        data: { tenantId: requireTenantId(), ...input, description: input.description ?? null },
        select: criterionSelect,
      });
      await writeAudit(tx, {
        action: "coins.criterion.create",
        entityType: "CoinCriterion",
        entityId: c.id,
        after: input,
      });
      return criterionDto(c);
    });
  }

  async updateCriterion(id: string, input: z.infer<typeof UpsertCoinCriterionSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.coinCriterion.findFirst({ where: { id }, select: criterionSelect });
      if (!before) throw notFound();
      await this.checkSubject(tx, input.subjectId);
      const c = await tx.coinCriterion.update({
        where: { id },
        data: { ...input, description: input.description ?? null },
        select: criterionSelect,
      });
      await writeAudit(tx, {
        action: "coins.criterion.update",
        entityType: "CoinCriterion",
        entityId: id,
        before: criterionDto(before),
        after: input,
      });
      return criterionDto(c);
    });
  }

  /** Unused criteria are deleted; a criterion with transactions, limits or automatic rules is deactivated. */
  async deleteCriterion(id: string) {
    return this.db.$transaction(async (tx) => {
      const c = await tx.coinCriterion.findFirst({
        where: { id },
        select: { ...criterionSelect, _count: { select: { transactions: true, limitRules: true, autoRules: true } } },
      });
      if (!c) throw notFound();
      const used = c._count.transactions + c._count.limitRules + c._count.autoRules > 0;
      if (used) await tx.coinCriterion.update({ where: { id }, data: { isActive: false } });
      else await tx.coinCriterion.delete({ where: { id } });
      await writeAudit(tx, {
        action: used ? "coins.criterion.deactivate" : "coins.criterion.delete",
        entityType: "CoinCriterion",
        entityId: id,
        before: { name: c.name },
      });
      return { deleted: !used };
    });
  }

  async setCriterionTeachers(id: string, input: z.infer<typeof SetCriterionTeachersSchema>) {
    const teacherIds = [...new Set(input.teacherIds)];
    return this.db.$transaction(async (tx) => {
      const c = await tx.coinCriterion.findFirst({ where: { id }, select: criterionSelect });
      if (!c) throw notFound();
      const found = await tx.employee.count({ where: { id: { in: teacherIds } } });
      if (found !== teacherIds.length) throw invalid("teacherIds");
      await tx.coinCriterionTeacher.deleteMany({ where: { criterionId: id } });
      if (teacherIds.length)
        await tx.coinCriterionTeacher.createMany({
          data: teacherIds.map((teacherId) => ({ tenantId: requireTenantId(), criterionId: id, teacherId })),
        });
      await writeAudit(tx, {
        action: "coins.criterion.teachers",
        entityType: "CoinCriterion",
        entityId: id,
        before: { teacherIds: c.teachers.map((t) => t.teacherId) },
        after: { teacherIds },
      });
      return criterionDto({ ...c, teachers: teacherIds.map((teacherId) => ({ teacherId })) });
    });
  }

  // ---- limits

  async listLimits() {
    const rows = await this.db.coinLimitRule.findMany({
      select: limitSelect,
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(limitDto);
  }

  private async limitData(tx: DbTransaction, input: z.infer<typeof UpsertCoinLimitRuleSchema>) {
    if (input.criterionId && !(await tx.coinCriterion.findFirst({ where: { id: input.criterionId } })))
      throw invalid("criterionId");
    if (input.teacherId && !(await tx.employee.findFirst({ where: { id: input.teacherId } })))
      throw invalid("teacherId");
    return {
      scope: input.scope,
      criterionId: input.criterionId ?? null,
      teacherId: input.teacherId ?? null,
      type: input.type ?? null,
      period: input.period,
      durationMinutes: input.period === "ROLLING" ? (input.durationMinutes ?? null) : null,
      maxAmount: input.maxAmount ?? null,
      maxCount: input.maxCount ?? null,
      // A typed rule counts one type anyway.
      countTypesSeparately: input.type ? false : (input.countTypesSeparately ?? false),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };
  }

  async createLimit(input: z.infer<typeof UpsertCoinLimitRuleSchema>) {
    return this.db.$transaction(async (tx) => {
      const data = await this.limitData(tx, input);
      const r = await tx.coinLimitRule.create({ data: { tenantId: requireTenantId(), ...data }, select: limitSelect });
      await writeAudit(tx, { action: "coins.limit.create", entityType: "CoinLimitRule", entityId: r.id, after: data });
      return limitDto(r);
    });
  }

  async updateLimit(id: string, input: z.infer<typeof UpsertCoinLimitRuleSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.coinLimitRule.findFirst({ where: { id }, select: limitSelect });
      if (!before) throw notFound();
      const data = await this.limitData(tx, input);
      const r = await tx.coinLimitRule.update({ where: { id }, data, select: limitSelect });
      await writeAudit(tx, {
        action: "coins.limit.update",
        entityType: "CoinLimitRule",
        entityId: id,
        before: limitDto(before),
        after: data,
      });
      return limitDto(r);
    });
  }

  async deactivateLimit(id: string) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.coinLimitRule.findFirst({ where: { id }, select: limitSelect });
      if (!before) throw notFound();
      const r = await tx.coinLimitRule.update({ where: { id }, data: { isActive: false }, select: limitSelect });
      await writeAudit(tx, { action: "coins.limit.deactivate", entityType: "CoinLimitRule", entityId: id });
      return limitDto(r);
    });
  }

  // ---- automatic rules

  async listAutoRules() {
    const rows = await this.db.coinAutoRule.findMany({
      select: autoRuleSelect,
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(autoRuleDto);
  }

  /** Automatic coins are credits: the criterion must be an active reward criterion. */
  /**
   * Test results only reward. Attendance: on time needs a criterion that rewards, a lateness band one that takes; the
   * band must be active, and each outcome has at most one active rule.
   */
  private async checkAutoRule(tx: DbTransaction, input: z.infer<typeof UpsertCoinAutoRuleSchema>, exceptId?: string) {
    const c = await tx.coinCriterion.findFirst({
      where: { id: input.criterionId, isActive: true },
      select: { type: true },
    });
    if (!c) throw invalid("criterionId");
    if (input.source === "TEST_RESULT") {
      if (c.type === "PENALTY") throw invalid("criterionId");
      return;
    }
    const band = input.config.latenessBandId;
    if (band === null ? c.type === "PENALTY" : c.type === "REWARD") throw invalid("criterionId", "direction");
    // A rule of an archived band can still be switched off.
    if (input.isActive === false) return;
    if (band && !(await tx.latenessBand.findFirst({ where: { id: band, archivedAt: null }, select: { id: true } }))) {
      throw invalid("config.latenessBandId");
    }
    const same = await tx.coinAutoRule.findMany({
      where: { source: "ATTENDANCE", isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { config: true },
    });
    if (same.some((r) => AttendanceRuleConfigSchema.parse(r.config).latenessBandId === band)) {
      throw new AppError("CONFLICT", 409, { reason: "DUPLICATE" });
    }
  }

  async createAutoRule(input: z.infer<typeof UpsertCoinAutoRuleSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.checkAutoRule(tx, input);
      const r = await tx.coinAutoRule.create({
        data: { tenantId: requireTenantId(), ...input },
        select: autoRuleSelect,
      });
      await writeAudit(tx, {
        action: "coins.auto_rule.create",
        entityType: "CoinAutoRule",
        entityId: r.id,
        after: input,
      });
      return autoRuleDto(r);
    });
  }

  async updateAutoRule(id: string, input: z.infer<typeof UpsertCoinAutoRuleSchema>) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.coinAutoRule.findFirst({ where: { id }, select: autoRuleSelect });
      if (!before) throw notFound();
      if (before.source !== input.source) throw invalid("source");
      await this.checkAutoRule(tx, input, id);
      const r = await tx.coinAutoRule.update({ where: { id }, data: input, select: autoRuleSelect });
      await writeAudit(tx, {
        action: "coins.auto_rule.update",
        entityType: "CoinAutoRule",
        entityId: id,
        before: autoRuleDto(before),
        after: input,
      });
      return autoRuleDto(r);
    });
  }
}
