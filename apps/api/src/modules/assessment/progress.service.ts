// Read side of scoring (scoring.md §4, §8, §9): a student's progress (portal and staff), the gradebook grid of a group
// and subject, and period results. Every number comes from the backend; the UI only shows it.
import type { z } from "zod";
import type { Db } from "@idrok/db";
import {
  AssessmentConfigSchema,
  type GradebookQuerySchema,
  type PeriodResultQuerySchema,
  type ProgressQuerySchema,
  type ProgressView,
} from "@idrok/shared";
import { roundTo } from "@idrok/shared/decimal";
import {
  eachSchoolDate,
  monthRange,
  schoolDateFromDb,
  schoolDateToDb,
  weekRange,
  type IsoWeekday,
  type SchoolDate,
} from "@idrok/shared/time";
import { overallPercent, sessionOutcome, tally, type Tally } from "../../domain/scoring";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { resolveScope, studentWhere } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { activeLimitRules, limitSettings, scoreSettings } from "../scores/score-config.service";
import { defaultVersion, effectiveVersion } from "./policies.service";
import { ResultsService, type ComputedResult } from "./results.service";
import { loadStudentSessions } from "./scoring-data";

const str = (d: { toString(): string } | null) => (d === null ? null : d.toString());

export function resultDto(
  r: ComputedResult & { status?: "LIVE" | "DRAFT" | "FINAL"; isStale?: boolean; version?: number | null },
  names: { student?: Map<string, string>; subject: Map<string, string> },
) {
  return {
    studentId: r.studentId,
    ...(names.student ? { studentName: names.student.get(r.studentId) ?? "" } : {}),
    subjectId: r.subjectId,
    subjectName: r.subjectId ? (names.subject.get(r.subjectId) ?? null) : null,
    periodId: r.periodId,
    policyVersionId: r.policyVersionId,
    status: r.status ?? "LIVE",
    complete: r.complete,
    isStale: r.isStale ?? false,
    components: r.components,
    totalPoints: str(r.totalPoints),
    maxPoints: r.maxPoints.toString(),
    percent: str(r.percent),
    displayPercent: str(r.displayPercent),
    gradeLabel: r.gradeLabel,
    version: r.version ?? null,
  };
}

export class ProgressService {
  constructor(private readonly db: Db) {}

  /** Who may see this student's numbers: school roles, their teachers, their guardians (canViewData), themselves. */
  private async assertStudent(auth: RequestAuth, studentId: string) {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const ok =
      scope.kind === "student"
        ? scope.studentId === studentId
        : scope.kind === "guardian"
          ? !!(await this.db.studentGuardian.findFirst({
              where: { guardianId: scope.guardianId, studentId, revokedAt: null, canViewData: true },
            }))
          : scope.kind === "none"
            ? false
            : !!(await this.db.student.findFirst({ where: { AND: [{ id: studentId }, studentWhere(scope, today)] } }));
    if (!ok) throw notFound();
    return today;
  }

  /** The smallest period containing the date (T-29), if any. */
  private async periodOn(date: SchoolDate) {
    const d = schoolDateToDb(date);
    const periods = await this.db.academicPeriod.findMany({
      where: { startDate: { lte: d }, endDate: { gte: d } },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    });
    return (
      periods.sort(
        (a, b) => a.endDate.getTime() - a.startDate.getTime() - (b.endDate.getTime() - b.startDate.getTime()),
      )[0] ?? null
    );
  }

  async progress(auth: RequestAuth, studentId: string, q: z.infer<typeof ProgressQuerySchema>) {
    const today = await this.assertStudent(auth, studentId);
    const date = q.date ?? today;
    const period = await this.periodOn(date);
    const version = period ? await effectiveVersion(this.db, period.id, null) : await defaultVersion(this.db);
    if (!version) throw notFound();
    const config = AssessmentConfigSchema.parse(version.config);
    if (!config.enabledViews.includes(q.view))
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "view", code: "view_disabled" }] });
    const settingsRow = await this.db.schoolSettings.findFirst({ select: { weekStartsOn: true } });
    const range = this.range(q.view, date, period, (settingsRow?.weekStartsOn ?? 1) as IsoWeekday);

    const settings = await scoreSettings(this.db);
    const sessions =
      (
        await loadStudentSessions(this.db, {
          studentIds: [studentId],
          ...range,
          rules: await activeLimitRules(this.db),
          settings: limitSettings(settings),
        })
      ).get(studentId) ?? [];
    const outcomes = sessions.map((s) => ({ s, o: sessionOutcome(s, config) }));
    const subjectIds = [...new Set(sessions.map((s) => s.subjectId))];
    const subjects = await this.db.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true },
    });
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const bySubject = new Map<string, Tally>(
      subjectIds.map((id) => [id, tally(outcomes.filter((x) => x.s.subjectId === id).map((x) => x.o))]),
    );
    const overall = overallPercent(config, bySubject);
    const shown = (p: { toString(): string } | null) =>
      p === null ? null : roundTo(p.toString(), config.rounding).toString();

    const results = new ResultsService(this.db);
    let periodResults: ReturnType<typeof resultDto>[] = [];
    if (q.view === "PERIOD" && period) {
      const computed =
        period.status === "CLOSED"
          ? await this.storedResults(period.id, [studentId])
          : await results.compute(period.id, [studentId]);
      periodResults = computed.map((r) => resultDto(r, { subject: subjectName }));
    }
    const entries = await this.db.scoreEntry.findMany({
      where: { studentId, schoolDate: { gte: schoolDateToDb(range.from), lte: schoolDateToDb(range.to) } },
      orderBy: [{ schoolDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        schoolDate: true,
        subject: { select: { name: true } },
        topic: { select: { title: true } },
        criterion: { select: { name: true } },
        points: true,
        kind: true,
      },
    });
    return {
      studentId,
      view: q.view,
      enabledViews: config.enabledViews,
      from: range.from,
      to: range.to,
      periodId: period?.id ?? null,
      periodName: period?.name ?? null,
      subjects: subjectIds
        .map((id) => {
          const t = bySubject.get(id)!;
          const mine = outcomes.filter((x) => x.s.subjectId === id);
          return {
            subjectId: id,
            subjectName: subjectName.get(id) ?? "",
            earned: t.earned.toString(),
            max: t.max.toString(),
            percent: str(t.percent),
            displayPercent: shown(t.percent),
            scoredSessions: mine.filter((x) => x.o.state === "SCORED").length,
            pendingSessions: mine.filter((x) => x.o.state === "PENDING").length,
          };
        })
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "uz")),
      ...(overall === undefined ? {} : { overall: { percent: str(overall), displayPercent: shown(overall) } }),
      series:
        config.dailyView === "BY_SUBJECT"
          ? []
          : [...eachSchoolDate(range.from, range.to)].map((d) => {
              const ofDay = outcomes.filter((x) => x.s.date === d);
              const daySubjects = new Map<string, Tally>(
                [...new Set(ofDay.map((x) => x.s.subjectId))].map((id) => [
                  id,
                  tally(ofDay.filter((x) => x.s.subjectId === id).map((x) => x.o)),
                ]),
              );
              return { date: d, percent: str(overallPercent(config, daySubjects) ?? null) };
            }),
      periodResults,
      entries: entries.map((e) => ({
        id: e.id,
        schoolDate: schoolDateFromDb(e.schoolDate),
        subjectName: e.subject.name,
        topicTitle: e.topic?.title ?? null,
        criterionName: e.criterion?.name ?? null,
        points: e.points.toString(),
        kind: e.kind,
      })),
    };
  }

  private range(
    view: ProgressView,
    date: SchoolDate,
    period: { startDate: Date; endDate: Date } | null,
    weekStartsOn: IsoWeekday,
  ): { from: SchoolDate; to: SchoolDate } {
    if (view === "DAY") return { from: date, to: date };
    if (view === "WEEK") return weekRange(date, weekStartsOn);
    if (view === "MONTH" || !period) return monthRange(date);
    return { from: schoolDateFromDb(period.startDate), to: schoolDateFromDb(period.endDate) };
  }

  /** Current stored rows of a closed period (the snapshot). */
  async storedResults(periodId: string, studentIds: string[], subjectId?: string) {
    const rows = await this.db.periodResult.findMany({
      where: { periodId, studentId: { in: studentIds }, isCurrent: true, ...(subjectId ? { subjectId } : {}) },
    });
    return rows.map((r) => ({
      studentId: r.studentId,
      subjectId: r.subjectId,
      periodId: r.periodId,
      policyVersionId: r.policyVersionId,
      complete: r.isComplete,
      components: r.components as ComputedResult["components"],
      totalPoints: r.totalPoints,
      maxPoints: r.maxPoints,
      percent: r.percent,
      displayPercent: r.displayPercent,
      gradeLabel: r.gradeLabel,
      inputsHash: r.inputsHash,
      pendingSessions: 0,
      status: r.status,
      isStale: r.isStale,
      version: r.version,
    }));
  }

  /** A teacher sees the gradebook of their groups (and their homeroom class's groups); school roles see all. */
  private async assertGroup(auth: RequestAuth, teachingGroupId: string) {
    const { timezone } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    const group = await this.db.teachingGroup.findFirst({
      where: { id: teachingGroupId },
      select: { classGroupId: true, name: true },
    });
    if (!group) throw notFound();
    if (scope.kind === "school") return group;
    if (
      scope.kind === "teacher" &&
      (scope.teachingGroupIds.includes(teachingGroupId) ||
        (group.classGroupId !== null && scope.homeroomClassIds.includes(group.classGroupId)))
    )
      return group;
    throw forbidden();
  }

  private async groupStudents(teachingGroupId: string, from: Date, to: Date) {
    const members = await this.db.teachingGroupMember.findMany({
      where: { teachingGroupId, validFrom: { lte: to }, OR: [{ validTo: null }, { validTo: { gte: from } }] },
      select: { student: { select: { id: true, firstName: true, lastName: true } } },
    });
    const unique = new Map(members.map((m) => [m.student.id, `${m.student.lastName} ${m.student.firstName}`]));
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1], "uz"));
  }

  /** §8 gradebook: students × lessons of one group, subject and period, with each student's period percent. */
  async gradebook(auth: RequestAuth, q: z.infer<typeof GradebookQuerySchema>) {
    await this.assertGroup(auth, q.teachingGroupId);
    const period = await this.db.academicPeriod.findFirst({ where: { id: q.periodId } });
    if (!period) throw notFound();
    const students = await this.groupStudents(q.teachingGroupId, period.startDate, period.endDate);
    const version = await effectiveVersion(this.db, period.id, q.subjectId);
    if (!version) throw notFound();
    const config = AssessmentConfigSchema.parse(version.config);
    const settings = await scoreSettings(this.db);
    const loaded = await loadStudentSessions(this.db, {
      studentIds: students.map(([id]) => id),
      from: schoolDateFromDb(period.startDate),
      to: schoolDateFromDb(period.endDate),
      teachingGroupIds: [q.teachingGroupId],
      subjectId: q.subjectId,
      rules: await activeLimitRules(this.db),
      settings: limitSettings(settings),
    });
    const sessions = await this.db.lessonSession.findMany({
      where: {
        teachingGroupId: q.teachingGroupId,
        subjectId: q.subjectId,
        date: { gte: period.startDate, lte: period.endDate },
        status: { not: "CANCELLED" },
      },
      orderBy: [{ date: "asc" }, { startsAt: "asc" }],
      select: {
        id: true,
        date: true,
        lessonNumber: true,
        status: true,
        planItem: { select: { topic: { select: { title: true } } } },
      },
    });
    const rule = config.higherPeriods.find((h) => h.periodId === period.id) ?? config.higherDefault;
    const manualComponents = [
      ...config.components
        .filter((c) => c.type === "MANUAL" && c.enabled)
        .map((c) => ({ key: c.key, name: c.name, maxPoints: c.maxPoints, final: false })),
      // The final control belongs to a period made of other periods (half-year, year).
      ...(rule.aggregation === "WEIGHTED_WITH_FINAL" && rule.finalComponent && (await this.hasChildren(period.id))
        ? [{ key: rule.finalComponent.key, name: null, maxPoints: "100", final: true }]
        : []),
    ];
    return {
      periodStatus: period.status,
      manualComponents,
      sessions: sessions.map((s) => ({
        id: s.id,
        date: schoolDateFromDb(s.date),
        lessonNumber: s.lessonNumber,
        status: s.status,
        topicTitle: s.planItem?.topic.title ?? null,
      })),
      students: students.map(([studentId, name]) => {
        const mine = (loaded.get(studentId) ?? []).filter((s) => s.status !== "CANCELLED");
        const outcomes = new Map(mine.map((s) => [s.sessionId, { s, o: sessionOutcome(s, config) }]));
        const t = tally([...outcomes.values()].map((x) => x.o));
        return {
          studentId,
          name,
          cells: sessions
            .filter((s) => outcomes.has(s.id))
            .map((s) => {
              const { s: loadedSession, o } = outcomes.get(s.id)!;
              return {
                sessionId: s.id,
                state: o.state,
                points: o.state === "SCORED" ? str(o.earned) : null,
                max: loadedSession.maxPoints.toString(),
                attendance: loadedSession.attendance,
              };
            }),
          percent: str(t.percent),
          displayPercent: t.percent === null ? null : roundTo(t.percent, config.rounding).toString(),
        };
      }),
    };
  }

  private async hasChildren(periodId: string) {
    return (await this.db.academicPeriod.count({ where: { parentId: periodId } })) > 0;
  }

  /** Period results of a group's students: live while the period is open, the FINAL snapshot once closed. */
  async periodResults(auth: RequestAuth, q: z.infer<typeof PeriodResultQuerySchema>) {
    await this.assertGroup(auth, q.teachingGroupId);
    const period = await this.db.academicPeriod.findFirst({ where: { id: q.periodId } });
    if (!period) throw notFound();
    const students = await this.groupStudents(q.teachingGroupId, period.startDate, period.endDate);
    const ids = students.map(([id]) => id);
    const computed =
      period.status === "CLOSED"
        ? await this.storedResults(period.id, ids, q.subjectId)
        : await new ResultsService(this.db).compute(period.id, ids, q.subjectId);
    const subjects = await this.db.subject.findMany({ select: { id: true, name: true } });
    return computed.map((r) =>
      resultDto(r, { student: new Map(students), subject: new Map(subjects.map((s) => [s.id, s.name])) }),
    );
  }
}
