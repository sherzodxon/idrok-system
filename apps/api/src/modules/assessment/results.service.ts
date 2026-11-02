// Period results (scoring.md §5): computed from the lessons, attendance, entries and manual scores under the policy
// bound to the period and subject. Closed periods are not recomputed: their FINAL rows are the snapshot (§7).
import { createHash } from "node:crypto";
import type { Db, DbTransaction } from "@idrok/db";
import { AssessmentConfigSchema, type AssessmentConfig, type GradeBand } from "@idrok/shared";
import { D, roundTo, type Decimal } from "@idrok/shared/decimal";
import { schoolDateFromDb } from "@idrok/shared/time";
import {
  gradeLabel,
  higherPeriodPercent,
  periodResult,
  sessionOutcome,
  tally,
  testsPercent,
  weightedAverage,
  type ComponentResult,
} from "../../domain/scoring";
import { activeLimitRules, limitSettings, scoreSettings } from "../scores/score-config.service";
import { effectiveVersion } from "./policies.service";
import { loadTestInputs, testKey, testsForMode, type LoadedTest } from "./test-inputs";
import { loadStudentSessions, type LoadedSession } from "./scoring-data";

export interface ComputedResult {
  studentId: string;
  subjectId: string | null;
  periodId: string;
  policyVersionId: string;
  complete: boolean;
  components: { key: string; type: string; maxPoints: string; percent: string | null; points: string | null }[];
  totalPoints: Decimal | null;
  maxPoints: Decimal;
  percent: Decimal | null;
  displayPercent: Decimal | null;
  gradeLabel: string | null;
  inputsHash: string;
  /** Lessons still waiting for a score (PENDING), for the completeness report. */
  pendingSessions: number;
}

interface PeriodNode {
  id: string;
  status: string;
  startDate: Date;
  endDate: Date;
  parentId: string | null;
}

type Version = { id: string; config: AssessmentConfig };

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const str = (d: Decimal | null) => d?.toString() ?? null;

export class ResultsService {
  constructor(private readonly db: Db | DbTransaction) {}

  private versions = new Map<string, Version | null>();
  private scales = new Map<string, GradeBand[]>();

  private async version(periodId: string, subjectId: string | null): Promise<Version | null> {
    const k = `${periodId}|${subjectId}`;
    if (!this.versions.has(k)) {
      const v = await effectiveVersion(this.db, periodId, subjectId);
      this.versions.set(k, v ? { id: v.id, config: AssessmentConfigSchema.parse(v.config) } : null);
    }
    return this.versions.get(k)!;
  }

  private async bands(scaleId: string | null): Promise<GradeBand[]> {
    if (!scaleId) return [];
    if (!this.scales.has(scaleId)) {
      const rows = await this.db.gradeScaleBand.findMany({ where: { scale: { id: scaleId } } });
      this.scales.set(
        scaleId,
        rows.map((b) => ({ minPercent: b.minPercent.toString(), maxPercent: b.maxPercent.toString(), label: b.label })),
      );
    }
    return this.scales.get(scaleId)!;
  }

  /** Rounded percent and grade for display (§5.6). T-42: the grade follows the rounded percent the user sees. */
  async display(config: AssessmentConfig, percent: Decimal | null) {
    if (percent === null) return { displayPercent: null, gradeLabel: null };
    const shown = roundTo(percent, config.rounding);
    return { displayPercent: shown, gradeLabel: gradeLabel(await this.bands(config.gradeScaleId), shown) };
  }

  /** Every result of the period for these students: one per subject they had lessons in, plus the overall one. */
  async compute(periodId: string, studentIds: string[], subjectId?: string): Promise<ComputedResult[]> {
    const period = await this.db.academicPeriod.findFirst({
      where: { id: periodId },
      select: { academicYearId: true },
    });
    if (!period || !studentIds.length) return [];
    const periods = await this.db.academicPeriod.findMany({
      where: { academicYearId: period.academicYearId },
      select: { id: true, status: true, startDate: true, endDate: true, parentId: true },
    });
    const settings = await scoreSettings(this.db);
    const ctx = { periods, rules: await activeLimitRules(this.db), settings: limitSettings(settings) };
    const results = await this.forPeriod(ctx, periodId, studentIds, subjectId);
    if (subjectId) return results;
    return [...results, ...(await this.overall(periodId, studentIds, results))];
  }

  private async forPeriod(
    ctx: {
      periods: PeriodNode[];
      rules: Awaited<ReturnType<typeof activeLimitRules>>;
      settings: ReturnType<typeof limitSettings>;
    },
    periodId: string,
    studentIds: string[],
    subjectId?: string,
  ): Promise<ComputedResult[]> {
    const node = ctx.periods.find((p) => p.id === periodId)!;
    const children = ctx.periods.filter((p) => p.parentId === periodId);
    const anyVersion = await this.version(periodId, subjectId ?? null);
    if (!anyVersion) return [];
    const rule = (config: AssessmentConfig) =>
      config.higherPeriods.find((h) => h.periodId === periodId) ?? config.higherDefault;

    // A higher period from its parts (unless INDEPENDENT).
    if (children.length && rule(anyVersion.config).aggregation !== "INDEPENDENT") {
      const parts = new Map<string, ComputedResult[]>();
      for (const child of children) parts.set(child.id, await this.childResults(ctx, child, studentIds, subjectId));
      const keys = new Set([...parts.values()].flat().map((r) => `${r.studentId}|${r.subjectId}`));
      const out: ComputedResult[] = [];
      for (const k of keys) {
        const [studentId, subject] = k.split("|") as [string, string];
        const version = (await this.version(periodId, subject))!;
        const r = rule(version.config);
        const childPercents = children.map((c) => ({
          periodId: c.id,
          percent: parts.get(c.id)!.find((x) => x.studentId === studentId && x.subjectId === subject)?.percent ?? null,
        }));
        const final = r.finalComponent
          ? await this.manualPercent(periodId, subject, studentId, r.finalComponent.key)
          : null;
        const percent = higherPeriodPercent(r, childPercents, final);
        const maxPoints = D(version.config.periodMaxPoints);
        out.push({
          studentId,
          subjectId: subject,
          periodId,
          policyVersionId: version.id,
          complete: percent !== null,
          components: childPercents.map((c) => ({
            key: c.periodId,
            type: "PERIOD",
            maxPoints: maxPoints.toString(),
            percent: str(c.percent),
            points: null,
          })),
          totalPoints: percent?.times(maxPoints).div(100) ?? null,
          maxPoints,
          percent,
          ...(await this.display(version.config, percent)),
          inputsHash: hash({
            v: version.id,
            parts: childPercents.map((c) => [c.periodId, str(c.percent)]),
            final: str(final),
          }),
          pendingSessions: [...parts.values()]
            .flat()
            .filter((x) => x.studentId === studentId && x.subjectId === subject)
            .reduce((n, x) => n + x.pendingSessions, 0),
        });
      }
      return out;
    }

    // A period computed from its own components.
    const sessions = await loadStudentSessions(this.db, {
      studentIds,
      from: schoolDateFromDb(node.startDate),
      to: schoolDateFromDb(node.endDate),
      subjectId,
      rules: ctx.rules,
      settings: ctx.settings,
    });
    const manual = await this.db.manualAssessmentScore.findMany({
      where: { periodId, studentId: { in: studentIds }, supersededById: null, ...(subjectId ? { subjectId } : {}) },
      select: { studentId: true, subjectId: true, componentKey: true, points: true, maxPoints: true },
    });
    const tests = await loadTestInputs(this.db, { periodId, studentIds, subjectId });
    const out: ComputedResult[] = [];
    for (const studentId of studentIds) {
      const mine = sessions.get(studentId) ?? [];
      const subjects = new Set([
        ...mine.map((s) => s.subjectId),
        ...manual.filter((m) => m.studentId === studentId).map((m) => m.subjectId),
        ...[...tests.keys()].filter((k) => k.startsWith(`${studentId}|`)).map((k) => k.split("|")[1]!),
      ]);
      for (const subject of subjects) {
        const version = (await this.version(periodId, subject))!;
        const ofSubject = mine.filter((s) => s.subjectId === subject);
        const ofTests = tests.get(testKey(studentId, subject)) ?? [];
        out.push(await this.componentResult(version, periodId, studentId, subject, ofSubject, manual, ofTests));
      }
    }
    return out;
  }

  private async componentResult(
    version: Version,
    periodId: string,
    studentId: string,
    subjectId: string,
    sessions: LoadedSession[],
    manual: { studentId: string; subjectId: string; componentKey: string; points: Decimal; maxPoints: Decimal }[],
    loadedTests: LoadedTest[] = [],
  ): Promise<ComputedResult> {
    const counted = testsForMode(loadedTests, version.config.testsMode);
    const outcomes = sessions.map((s) => ({ s, o: sessionOutcome(s, version.config) }));
    const daily = tally(outcomes.map((x) => x.o));
    const mine = manual.filter((m) => m.studentId === studentId && m.subjectId === subjectId);
    const computed = periodResult(version.config, {
      daily: daily.percent,
      tests: testsPercent(counted, version.config),
      manual: new Map(mine.map((m) => [m.componentKey, { earned: m.points, max: m.maxPoints }])),
    });
    return {
      studentId,
      subjectId,
      periodId,
      policyVersionId: version.id,
      complete: computed.complete,
      components: computed.components.map((c: ComponentResult) => ({
        key: c.key,
        type: c.type,
        maxPoints: c.maxPoints.toString(),
        percent: str(c.percent),
        points: str(c.points),
      })),
      totalPoints: computed.total,
      maxPoints: computed.maxPoints,
      percent: computed.percent,
      ...(await this.display(version.config, computed.percent)),
      inputsHash: hash({
        v: version.id,
        s: outcomes.map(({ s, o }) => [s.sessionId, o.state, str(o.earned), str(o.max)]),
        m: mine.map((m) => [m.componentKey, m.points.toString(), m.maxPoints.toString()]),
        t: counted.map((x) => [x.testId, x.weight, x.attempts, x.retakePolicy, x.pending]),
      }),
      pendingSessions: outcomes.filter(({ o }) => o.state === "PENDING").length,
    };
  }

  /** A closed child period gives its FINAL snapshot; an open one is computed. */
  private async childResults(
    ctx: Parameters<ResultsService["forPeriod"]>[0],
    child: PeriodNode,
    studentIds: string[],
    subjectId?: string,
  ): Promise<ComputedResult[]> {
    if (child.status !== "CLOSED") return this.forPeriod(ctx, child.id, studentIds, subjectId);
    const rows = await this.db.periodResult.findMany({
      where: {
        periodId: child.id,
        studentId: { in: studentIds },
        isCurrent: true,
        subjectId: subjectId ?? { not: null },
      },
    });
    return rows.map((r) => ({
      studentId: r.studentId,
      subjectId: r.subjectId,
      periodId: r.periodId,
      policyVersionId: r.policyVersionId,
      complete: r.isComplete,
      components: [],
      totalPoints: r.totalPoints,
      maxPoints: r.maxPoints,
      percent: r.percent,
      displayPercent: r.displayPercent,
      gradeLabel: r.gradeLabel,
      inputsHash: r.inputsHash,
      pendingSessions: 0,
    }));
  }

  private async manualPercent(periodId: string, subjectId: string, studentId: string, key: string) {
    const m = await this.db.manualAssessmentScore.findFirst({
      where: { periodId, subjectId, studentId, componentKey: key, supersededById: null },
    });
    return m ? m.points.div(m.maxPoints).times(100) : null;
  }

  /** §5.5: the overall result over subjects (WEIGHTED_SUBJECTS), when the policy asks for it. */
  private async overall(
    periodId: string,
    studentIds: string[],
    bySubject: ComputedResult[],
  ): Promise<ComputedResult[]> {
    const version = await this.version(periodId, null);
    if (!version || version.config.dailyView === "BY_SUBJECT" || !version.config.overallPeriodResult) return [];
    const out: ComputedResult[] = [];
    for (const studentId of studentIds) {
      const mine = bySubject.filter((r) => r.studentId === studentId);
      if (!mine.length) continue;
      const percent = weightedAverage(
        mine.map((r) => ({ value: r.percent, weight: version.config.subjectWeights[r.subjectId!] ?? 1 })),
      );
      const maxPoints = D(version.config.periodMaxPoints);
      out.push({
        studentId,
        subjectId: null,
        periodId,
        policyVersionId: version.id,
        complete: mine.every((r) => r.complete),
        components: mine.map((r) => ({
          key: r.subjectId!,
          type: "SUBJECT",
          maxPoints: maxPoints.toString(),
          percent: str(r.percent),
          points: null,
        })),
        totalPoints: percent?.times(maxPoints).div(100) ?? null,
        maxPoints,
        percent,
        ...(await this.display(version.config, percent)),
        inputsHash: hash({ v: version.id, s: mine.map((r) => [r.subjectId, r.inputsHash]) }),
        pendingSessions: mine.reduce((n, r) => n + r.pendingSessions, 0),
      });
    }
    return out;
  }
}
