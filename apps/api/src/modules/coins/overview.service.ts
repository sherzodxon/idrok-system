// Coin dashboard for staff (coins.view): totals over a school-date range, the balance ranking and teacher activity.
// Reversals and corrections count with the row they change, so every total is net.
import type { z } from "zod";
import type { Db } from "@idrok/db";
import type { CoinRangeQuerySchema, CoinRankingQuerySchema } from "@idrok/shared";
import { addSchoolDays, eachSchoolDate, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { teacherActivity } from "../../domain/coins";
import { AppError } from "../../http/errors";
import { activeOn } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { coinSettings } from "./ledger";

const MAX_RANGE_DAYS = 366;

export class CoinOverviewService {
  constructor(private readonly db: Db) {}

  async overview(q: z.infer<typeof CoinRangeQuerySchema>) {
    const { today } = await schoolClock(this.db);
    const to = q.to ?? today;
    const from = q.from ?? addSchoolDays(to, -29);
    if (from > to || addSchoolDays(from, MAX_RANGE_DAYS) < to)
      throw new AppError("VALIDATION_ERROR", 400, { fields: [{ path: "from", code: "invalid_range" }] });
    const [rows, balances, inDebt, pendingOrders] = await Promise.all([
      this.db.coinTransaction.findMany({
        where: { schoolDate: { gte: schoolDateToDb(from), lte: schoolDateToDb(to) } },
        select: {
          type: true,
          source: true,
          amount: true,
          schoolDate: true,
          criterionId: true,
          criterionNameSnapshot: true,
          reversedBy: { select: { id: true } },
          reversesTransaction: { select: { type: true } },
          correctsTransaction: { select: { type: true } },
        },
      }),
      this.db.coinAccount.aggregate({ _sum: { balance: true } }),
      this.db.coinAccount.count({ where: { balance: { lt: 0 } } }),
      this.db.coinOrder.count({ where: { status: "PENDING" } }),
    ]);
    const days = new Map<string, { awarded: number; penalties: number }>();
    for (const d of eachSchoolDate(from, to)) days.set(d, { awarded: 0, penalties: 0 });
    const criteria = new Map<
      string,
      { id: string | null; name: string; awarded: number; penalties: number; count: number }
    >();
    const totals = { awarded: 0, penalties: 0, spent: 0, automatic: 0, adjustments: 0, evaluations: 0 };
    for (const r of rows) {
      const kind = r.reversesTransaction?.type ?? r.correctsTransaction?.type ?? r.type;
      const teacherMade = r.source === "TEACHER_CRITERION";
      const day = days.get(schoolDateFromDb(r.schoolDate));
      if (kind === "REWARD" || kind === "PENALTY") {
        if (kind === "REWARD" && !teacherMade) totals.automatic += r.amount;
        else if (kind === "REWARD") totals.awarded += r.amount;
        else totals.penalties -= r.amount;
        if (day) {
          if (kind === "REWARD") day.awarded += r.amount;
          else day.penalties -= r.amount;
        }
        const key = r.criterionId ?? "";
        const c = criteria.get(key) ?? {
          id: r.criterionId,
          name: r.criterionNameSnapshot ?? "",
          awarded: 0,
          penalties: 0,
          count: 0,
        };
        if (kind === "REWARD") c.awarded += r.amount;
        else c.penalties -= r.amount;
        if ((r.type === "REWARD" || r.type === "PENALTY") && !r.reversedBy) {
          c.count++;
          if (teacherMade) totals.evaluations++;
        }
        criteria.set(key, c);
      } else if (kind === "PURCHASE" || kind === "REFUND") totals.spent -= r.amount;
      else if (kind === "ADMIN_ADJUSTMENT") totals.adjustments += r.amount;
    }
    return {
      from,
      to,
      ...totals,
      totalBalance: balances._sum.balance ?? 0,
      studentsInDebt: inDebt,
      pendingOrders,
      byCriterion: [...criteria.values()].sort((a, b) => b.awarded + b.penalties - (a.awarded + a.penalties)),
      series: [...days].map(([date, v]) => ({ date: date as SchoolDate, ...v })),
    };
  }

  /** Students by balance (internal only — Q-44: no public board). */
  async ranking(q: z.infer<typeof CoinRankingQuerySchema>) {
    const rows = await this.db.coinAccount.findMany({
      where: {
        student: {
          status: "ACTIVE",
          ...(q.classGroupId ? { enrollments: { some: { classGroupId: q.classGroupId, status: "ACTIVE" } } } : {}),
        },
      },
      select: {
        balance: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            enrollments: { where: { status: "ACTIVE" }, select: { classGroup: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: [{ balance: "desc" }, { student: { lastName: "asc" } }],
      take: q.limit,
    });
    return rows.map((r) => ({
      studentId: r.student.id,
      name: `${r.student.lastName} ${r.student.firstName}`,
      className: r.student.enrollments[0]?.classGroup.name ?? null,
      balance: r.balance,
    }));
  }

  /**
   * Teacher activity (§14): within the last N school days, the share of the teacher's students they evaluated;
   * UNASSIGNED without usable criteria or students.
   */
  async teachers() {
    const { today } = await schoolClock(this.db);
    const settings = await coinSettings(this.db);
    const rule = {
      windowDays: settings.activityWindowDays,
      minCoverage: settings.activityMinCoverage,
      staleDays: settings.activityStaleDays,
    };
    const windowFrom = addSchoolDays(today, -(rule.windowDays - 1));
    const evaluation = { source: "TEACHER_CRITERION" as const, type: { in: ["REWARD" as const, "PENALTY" as const] } };
    const [assignments, criteria, windowRows, last] = await Promise.all([
      this.db.teacherAssignment.findMany({
        where: { ...activeOn(today), teacher: { status: "ACTIVE" } },
        select: { teacherId: true, teachingGroupId: true },
      }),
      this.db.coinCriterion.findMany({
        where: { isActive: true, isAutomatic: false },
        select: { eligibility: true, teachers: { select: { teacherId: true } } },
      }),
      this.db.coinTransaction.findMany({
        where: { ...evaluation, reversedBy: null, schoolDate: { gte: schoolDateToDb(windowFrom) } },
        select: { teacherId: true, studentId: true, type: true },
      }),
      this.db.coinTransaction.groupBy({
        by: ["teacherId"],
        where: { ...evaluation, reversedBy: null },
        _max: { schoolDate: true },
      }),
    ]);
    const teacherIds = [
      ...new Set([
        ...assignments.map((a) => a.teacherId),
        ...criteria.flatMap((c) => c.teachers.map((t) => t.teacherId)),
      ]),
    ];
    const [teachers, members] = await Promise.all([
      this.db.employee.findMany({
        where: { id: { in: teacherIds }, status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      this.db.teachingGroupMember.findMany({
        where: { teachingGroupId: { in: [...new Set(assignments.map((a) => a.teachingGroupId))] }, ...activeOn(today) },
        select: { teachingGroupId: true, studentId: true },
      }),
    ]);
    const lastBy = new Map(last.map((l) => [l.teacherId, l._max.schoolDate]));
    return {
      rule,
      teachers: teachers.map((t) => {
        const groups = new Set(assignments.filter((a) => a.teacherId === t.id).map((a) => a.teachingGroupId));
        const students = new Set(members.filter((m) => groups.has(m.teachingGroupId)).map((m) => m.studentId));
        const eligibleCriteria = criteria.filter(
          (c) => c.eligibility === "ALL_TEACHERS" || c.teachers.some((x) => x.teacherId === t.id),
        ).length;
        const mine = windowRows.filter((r) => r.teacherId === t.id);
        const windowStudents = new Set(mine.filter((r) => students.has(r.studentId)).map((r) => r.studentId)).size;
        const lastDate = lastBy.get(t.id);
        const lastEvaluation = lastDate ? schoolDateFromDb(lastDate) : null;
        const activity = teacherActivity(
          {
            assignedStudents: students.size,
            eligibleCriteria,
            windowEvaluations: mine.length,
            windowStudents,
            lastEvaluation,
            today,
          },
          rule,
        );
        return {
          teacherId: t.id,
          name: `${t.lastName} ${t.firstName}`,
          status: activity.status,
          reason: activity.reason,
          assignedStudents: students.size,
          eligibleCriteria,
          windowEvaluations: mine.length,
          windowStudents,
          coverage: activity.coverage,
          penaltyShare: mine.length
            ? Math.round((mine.filter((r) => r.type === "PENALTY").length / mine.length) * 100)
            : 0,
          lastEvaluation,
          daysSinceLast: activity.daysSinceLast,
        };
      }),
    };
  }
}
