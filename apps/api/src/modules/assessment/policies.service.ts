// Assessment policies (scoring.md §6): versions (a published one never changes), the default preset, bindings of a
// version to a period (and subject), and grade scales (§5.6).
import { createHash } from "node:crypto";
import type { z } from "zod";
import { currentTenantContext, requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import {
  AssessmentConfigSchema,
  DEFAULT_ASSESSMENT_CONFIG,
  type AssessmentConfig,
  type BindPolicySchema,
  type CreatePolicySchema,
  type SaveGradeScaleSchema,
  type SavePolicyDraftSchema,
} from "@idrok/shared";
import { gradeScaleProblems, policyProblems } from "../../domain/scoring";
import { AppError, isConstraintError, notFound } from "../../http/errors";
import { writeAudit } from "../audit/audit.service";

const conflict = (reason: string, details: Record<string, unknown> = {}) =>
  new AppError("CONFLICT", 409, { reason, ...details });

/** Q-13: the 5-point scale the school can switch on (not selected in the default policy). */
const DEFAULT_SCALE = {
  name: "5 ballik",
  bands: [
    { minPercent: "0", maxPercent: "56", label: "2" },
    { minPercent: "56", maxPercent: "71", label: "3" },
    { minPercent: "71", maxPercent: "86", label: "4" },
    { minPercent: "86", maxPercent: "100", label: "5" },
  ],
};
const DEFAULT_POLICY_NAME = "Standart";

export const configHash = (config: AssessmentConfig) =>
  createHash("sha256")
    .update(JSON.stringify(AssessmentConfigSchema.parse(config)))
    .digest("hex");

const versionSelect = {
  id: true,
  policyId: true,
  version: true,
  status: true,
  config: true,
  note: true,
  createdAt: true,
  publishedAt: true,
} satisfies Prisma.AssessmentPolicyVersionSelect;
type VersionRow = Prisma.AssessmentPolicyVersionGetPayload<{ select: typeof versionSelect }>;

export const versionDto = (v: VersionRow) => ({
  id: v.id,
  policyId: v.policyId,
  version: v.version,
  status: v.status,
  config: AssessmentConfigSchema.parse(v.config),
  note: v.note,
  createdAt: v.createdAt.toISOString(),
  publishedAt: v.publishedAt?.toISOString() ?? null,
});

const bindingSelect = {
  id: true,
  periodId: true,
  subjectId: true,
  subject: { select: { name: true } },
  policyVersionId: true,
  policyVersion: { select: { version: true, policy: { select: { name: true } } } },
  boundAt: true,
  supersededAt: true,
  reason: true,
} satisfies Prisma.PolicyBindingSelect;

const bindingDto = (b: Prisma.PolicyBindingGetPayload<{ select: typeof bindingSelect }>) => ({
  id: b.id,
  periodId: b.periodId,
  subjectId: b.subjectId,
  subjectName: b.subject?.name ?? null,
  policyVersionId: b.policyVersionId,
  policyName: b.policyVersion.policy.name,
  version: b.policyVersion.version,
  boundAt: b.boundAt.toISOString(),
  supersededAt: b.supersededAt?.toISOString() ?? null,
  reason: b.reason,
});

/** The default policy with its published preset version, and the 5-point scale — created once per school. */
export async function ensureDefaultPolicy(tx: DbTransaction) {
  const existing = await tx.assessmentPolicy.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  const tenantId = requireTenantId();
  const userId = currentTenantContext()?.userId ?? null;
  if (!(await tx.gradeScale.findFirst({ where: { name: DEFAULT_SCALE.name } })))
    await tx.gradeScale.create({
      data: {
        tenantId,
        name: DEFAULT_SCALE.name,
        bands: { create: DEFAULT_SCALE.bands.map((b, i) => ({ ...b, order: i + 1 })) },
      },
    });
  const policy = await tx.assessmentPolicy.create({ data: { tenantId, name: DEFAULT_POLICY_NAME, isDefault: true } });
  await tx.assessmentPolicyVersion.create({
    data: {
      tenantId,
      policyId: policy.id,
      version: 1,
      status: "PUBLISHED",
      config: DEFAULT_ASSESSMENT_CONFIG,
      configHash: configHash(DEFAULT_ASSESSMENT_CONFIG),
      createdById: userId,
      publishedById: userId,
      publishedAt: new Date(),
    },
  });
  await writeAudit(tx, {
    action: "assessment_policy.default_created",
    entityType: "AssessmentPolicy",
    entityId: policy.id,
  });
  return policy;
}

/** The latest published version of the default policy (the preset is created the first time it is needed). */
export async function defaultVersion(tx: DbTransaction | Db) {
  const find = () =>
    tx.assessmentPolicyVersion.findFirst({
      where: { status: "PUBLISHED", policy: { isDefault: true } },
      orderBy: { version: "desc" },
      select: versionSelect,
    });
  const found = await find();
  if (found || (await tx.assessmentPolicy.findFirst({ where: { isDefault: true }, select: { id: true } })))
    return found;
  if ("$transaction" in tx) await tx.$transaction((inner) => ensureDefaultPolicy(inner));
  else await ensureDefaultPolicy(tx);
  return find();
}

/**
 * The version that rules a period and subject: the subject's binding, else the all-subjects binding, else (a period
 * never activated) the default policy's latest published version.
 */
export async function effectiveVersion(tx: DbTransaction | Db, periodId: string, subjectId: string | null) {
  const bindings = await tx.policyBinding.findMany({
    where: { periodId, supersededAt: null, OR: [{ subjectId }, { subjectId: null }] },
    select: { subjectId: true, policyVersion: { select: versionSelect } },
  });
  const chosen =
    bindings.find((b) => b.subjectId === subjectId && subjectId !== null) ?? bindings.find((b) => !b.subjectId);
  return chosen?.policyVersion ?? (await defaultVersion(tx));
}

/** §6: a period that becomes active is bound to the default version of that moment (once). */
export async function bindDefaultOnActivate(tx: DbTransaction, periodId: string) {
  if (await tx.policyBinding.findFirst({ where: { periodId, subjectId: null, supersededAt: null } })) return;
  await ensureDefaultPolicy(tx);
  const version = await defaultVersion(tx);
  if (!version) return;
  await tx.policyBinding.create({
    data: {
      tenantId: requireTenantId(),
      periodId,
      policyVersionId: version.id,
      boundById: currentTenantContext()?.userId ?? null,
    },
  });
}

export class PoliciesService {
  constructor(private readonly db: Db) {}

  async list() {
    await this.db.$transaction((tx) => ensureDefaultPolicy(tx));
    const policies = await this.db.assessmentPolicy.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        isDefault: true,
        versions: { orderBy: { version: "desc" }, select: versionSelect },
      },
    });
    return policies.map((p) => ({
      ...p,
      versions: p.versions.map((v) => {
        const { config: _config, ...rest } = versionDto(v);
        return rest;
      }),
    }));
  }

  async getVersion(id: string) {
    const v = await this.db.assessmentPolicyVersion.findFirst({ where: { id }, select: versionSelect });
    if (!v) throw notFound();
    return versionDto(v);
  }

  /** A new policy starts with a draft (the given config or the preset). */
  async create(input: z.infer<typeof CreatePolicySchema>, userId: string) {
    return this.db.$transaction(async (tx) => {
      try {
        const policy = await tx.assessmentPolicy.create({ data: { tenantId: requireTenantId(), name: input.name } });
        const config = input.config ?? DEFAULT_ASSESSMENT_CONFIG;
        const draft = await tx.assessmentPolicyVersion.create({
          data: {
            tenantId: requireTenantId(),
            policyId: policy.id,
            version: 1,
            config,
            configHash: configHash(config),
            createdById: userId,
          },
          select: versionSelect,
        });
        await writeAudit(tx, {
          action: "assessment_policy.create",
          entityType: "AssessmentPolicy",
          entityId: policy.id,
          after: input,
        });
        return versionDto(draft);
      } catch (err) {
        if (isConstraintError(err, "AssessmentPolicy_tenantId_name_key")) throw conflict("NAME_TAKEN");
        throw err;
      }
    });
  }

  /** Saves the policy's draft, creating it (next version number) from the given config when there is none. */
  async saveDraft(policyId: string, input: z.infer<typeof SavePolicyDraftSchema>, userId: string) {
    return this.db.$transaction(async (tx) => {
      const policy = await tx.assessmentPolicy.findFirst({ where: { id: policyId }, select: { id: true } });
      if (!policy) throw notFound();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`policy:${policyId}`}, 0))`;
      const draft = await tx.assessmentPolicyVersion.findFirst({ where: { policyId, status: "DRAFT" } });
      const data = { config: input.config, configHash: configHash(input.config), note: input.note ?? null };
      const saved = draft
        ? await tx.assessmentPolicyVersion.update({ where: { id: draft.id }, data, select: versionSelect })
        : await tx.assessmentPolicyVersion.create({
            data: {
              tenantId: requireTenantId(),
              policyId,
              version:
                ((await tx.assessmentPolicyVersion.aggregate({ where: { policyId }, _max: { version: true } }))._max
                  .version ?? 0) + 1,
              createdById: userId,
              ...data,
            },
            select: versionSelect,
          });
      await writeAudit(tx, {
        action: "assessment_policy.draft",
        entityType: "AssessmentPolicyVersion",
        entityId: saved.id,
        after: input,
      });
      return versionDto(saved);
    });
  }

  /** What stops a config from being published (also shown live in the editor). */
  async problems(config: AssessmentConfig, tx: DbTransaction | Db = this.db): Promise<string[]> {
    const problems: string[] = policyProblems(config);
    if (config.gradeScaleId) {
      const scale = await tx.gradeScale.findFirst({
        where: { id: config.gradeScaleId, isActive: true },
        select: { bands: { select: { minPercent: true, maxPercent: true, label: true } } },
      });
      if (!scale) problems.push("GRADE_SCALE_MISSING");
      else
        problems.push(
          ...gradeScaleProblems(
            scale.bands.map((b) => ({
              ...b,
              minPercent: b.minPercent.toString(),
              maxPercent: b.maxPercent.toString(),
            })),
          ),
        );
    }
    const periodIds = [
      ...config.higherPeriods.map((h) => h.periodId),
      ...config.higherPeriods.flatMap((h) => Object.keys(h.weights ?? {})),
    ];
    if (
      periodIds.length &&
      (await tx.academicPeriod.count({ where: { id: { in: [...new Set(periodIds)] } } })) !== new Set(periodIds).size
    )
      problems.push("PERIOD_MISSING");
    return problems;
  }

  /** Publishes the draft (validated, §5.1/§5.6); earlier published versions of the policy retire. */
  async publish(versionId: string, userId: string) {
    return this.db.$transaction(async (tx) => {
      const version = await tx.assessmentPolicyVersion.findFirst({ where: { id: versionId }, select: versionSelect });
      if (!version) throw notFound();
      if (version.status !== "DRAFT") throw conflict("NOT_DRAFT");
      const config = AssessmentConfigSchema.parse(version.config);
      const problems = await this.problems(config, tx);
      if (problems.length) throw new AppError("VALIDATION_ERROR", 400, { reason: "POLICY_INVALID", problems });
      await tx.assessmentPolicyVersion.updateMany({
        where: { policyId: version.policyId, status: "PUBLISHED" },
        data: { status: "RETIRED" },
      });
      const published = await tx.assessmentPolicyVersion.update({
        where: { id: versionId },
        data: { status: "PUBLISHED", publishedById: userId, publishedAt: new Date() },
        select: versionSelect,
      });
      await writeAudit(tx, {
        action: "assessment_policy.publish",
        entityType: "AssessmentPolicyVersion",
        entityId: versionId,
      });
      return versionDto(published);
    });
  }

  async makeDefault(policyId: string) {
    return this.db.$transaction(async (tx) => {
      const policy = await tx.assessmentPolicy.findFirst({ where: { id: policyId } });
      if (!policy) throw notFound();
      if (!(await tx.assessmentPolicyVersion.findFirst({ where: { policyId, status: "PUBLISHED" } })))
        throw conflict("NOT_PUBLISHED");
      await tx.assessmentPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.assessmentPolicy.update({ where: { id: policyId }, data: { isDefault: true } });
      await writeAudit(tx, { action: "assessment_policy.default", entityType: "AssessmentPolicy", entityId: policyId });
    });
  }

  async bindings(periodId: string) {
    const rows = await this.db.policyBinding.findMany({
      where: { periodId },
      orderBy: [{ supersededAt: { sort: "desc", nulls: "first" } }, { boundAt: "desc" }],
      select: bindingSelect,
    });
    return rows.map(bindingDto);
  }

  /**
   * Binds a published version to a period (and subject). On an active period this is "apply to the current period":
   * a reason is required and the old binding is closed. A closed period keeps its binding.
   */
  async bind(periodId: string, input: z.infer<typeof BindPolicySchema>, userId: string) {
    return this.db.$transaction(async (tx) => {
      const period = await tx.academicPeriod.findFirst({ where: { id: periodId }, select: { status: true } });
      if (!period) throw notFound();
      if (period.status === "CLOSED") throw conflict("PERIOD_CLOSED");
      const version = await tx.assessmentPolicyVersion.findFirst({
        where: { id: input.policyVersionId, status: "PUBLISHED" },
        select: { id: true },
      });
      if (!version)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "policyVersionId", code: "invalid" }] });
      if (input.subjectId && !(await tx.subject.findFirst({ where: { id: input.subjectId } }))) throw notFound();
      const current = await tx.policyBinding.findFirst({
        where: { periodId, subjectId: input.subjectId, supersededAt: null },
        select: bindingSelect,
      });
      if (period.status === "ACTIVE" && current && !input.reason)
        throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "reason", code: "required" }] });
      if (current) await tx.policyBinding.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
      const created = await tx.policyBinding.create({
        data: {
          tenantId: requireTenantId(),
          periodId,
          subjectId: input.subjectId,
          policyVersionId: input.policyVersionId,
          boundById: userId,
          reason: input.reason ?? null,
        },
        select: bindingSelect,
      });
      await writeAudit(tx, {
        action: "assessment_policy.bind",
        entityType: "AcademicPeriod",
        entityId: periodId,
        before: current ? bindingDto(current) : null,
        after: input,
        reason: input.reason ?? null,
      });
      return bindingDto(created);
    });
  }

  // ---------------------------------------------------------------- grade scales

  async scales(tx: DbTransaction | Db = this.db) {
    const [scales, versions] = await Promise.all([
      tx.gradeScale.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true, bands: { orderBy: { order: "asc" } } },
      }),
      tx.assessmentPolicyVersion.findMany({ where: { status: { not: "DRAFT" } }, select: { config: true } }),
    ]);
    const used = new Set(versions.map((v) => AssessmentConfigSchema.parse(v.config).gradeScaleId).filter(Boolean));
    return scales.map((s) => ({
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      inUse: used.has(s.id),
      bands: s.bands.map((b) => ({
        minPercent: b.minPercent.toString(),
        maxPercent: b.maxPercent.toString(),
        label: b.label,
      })),
    }));
  }

  /** Creates or replaces a scale. A scale a published policy uses keeps its bands (make a new scale instead). */
  async saveScale(id: string | null, input: z.infer<typeof SaveGradeScaleSchema>) {
    const problems = gradeScaleProblems(input.bands);
    if (problems.length) throw new AppError("VALIDATION_ERROR", 400, { reason: "SCALE_INVALID", problems });
    const sorted = [...input.bands].sort((a, b) => Number(a.minPercent) - Number(b.minPercent));
    return this.db.$transaction(async (tx) => {
      try {
        if (!id) {
          const created = await tx.gradeScale.create({
            data: {
              tenantId: requireTenantId(),
              name: input.name,
              isActive: input.isActive ?? true,
              bands: { create: sorted.map((b, i) => ({ ...b, order: i + 1 })) },
            },
          });
          await writeAudit(tx, {
            action: "grade_scale.create",
            entityType: "GradeScale",
            entityId: created.id,
            after: input,
          });
          return (await this.scales(tx)).find((s) => s.id === created.id)!;
        }
        const before = (await this.scales(tx)).find((s) => s.id === id);
        if (!before) throw notFound();
        const key = (bands: { minPercent: string; maxPercent: string; label: string }[]) =>
          JSON.stringify(bands.map((b) => [Number(b.minPercent), Number(b.maxPercent), b.label]));
        const bandsChanged = key(before.bands) !== key(sorted);
        if (before.inUse && bandsChanged) throw conflict("SCALE_IN_USE");
        await tx.gradeScale.update({
          where: { id },
          data: { name: input.name, isActive: input.isActive ?? before.isActive },
        });
        if (bandsChanged) {
          await tx.gradeScaleBand.deleteMany({ where: { scaleId: id } });
          await tx.gradeScaleBand.createMany({ data: sorted.map((b, i) => ({ ...b, scaleId: id, order: i + 1 })) });
        }
        await writeAudit(tx, {
          action: "grade_scale.update",
          entityType: "GradeScale",
          entityId: id,
          before,
          after: input,
        });
        return (await this.scales(tx)).find((s) => s.id === id)!;
      } catch (err) {
        if (isConstraintError(err, "GradeScale_tenantId_name_key")) throw conflict("NAME_TAKEN");
        throw err;
      }
    });
  }
}
