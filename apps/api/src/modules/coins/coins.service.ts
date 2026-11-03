// Coin ledger writes and reads (MASTER_SPEC §14, api-plan.md §6): teacher evaluations under the limits, admin
// adjustments, reversals and corrections, the teacher's quick-evaluation board, histories and the student summary.
//
// Every write locks the student first (ledger.ts), then repeats the idempotency check and the limit check inside the
// lock, so concurrent requests from different teachers see each other's evaluations.
import type { z } from "zod";
import type { Db, DbTransaction, Prisma } from "@idrok/db";
import type {
  CapacityQuerySchema,
  CoinAdjustmentSchema,
  CoinTransactionQuerySchema,
  CorrectCoinSchema,
  GiveCoinsInput,
  ReverseCoinSchema,
} from "@idrok/shared";
import { addSchoolDays, eachSchoolDate, schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import {
  checkCoinLimits,
  correctionDelta,
  effectiveAmount,
  evaluationsSince,
  limitUsage,
  penaltyFloor,
  remainingCapacity,
  type CoinDirection,
  type CountedEvaluation,
} from "../../domain/coins";
import type { RequestAuth } from "../../http/auth";
import { AppError, forbidden, notFound } from "../../http/errors";
import { page, skipTake } from "../../http/pagination";
import { activeOn, resolveScope, studentWhere } from "../access/scope";
import { schoolClock } from "../access/school-clock";
import { writeAudit } from "../audit/audit.service";
import { activeCoinLimits } from "./coin-config.service";
import { balanceOf, coinSettings, coinsOff, lockStudentCoins, post, transactionDto, transactionSelect } from "./ledger";

const invalid = (path: string, code = "invalid") => new AppError("VALIDATION_ERROR", 400, { fields: [{ path, code }] });
const conflict = (reason: string) => new AppError("CONFLICT", 409, { reason });

interface Teacher {
  employeeId: string;
  teachingGroupIds: string[];
  homeroomClassIds: string[];
  /** School-wide roles may evaluate any student; teachers only their own. */
  schoolWide: boolean;
}

export class CoinsService {
  constructor(private readonly db: Db) {}

  /** The caller as an evaluating teacher: an employee, with their groups (also for school-wide roles). */
  private async teacher(auth: RequestAuth, timezone: string, today: SchoolDate): Promise<Teacher> {
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind === "teacher") return { ...scope, schoolWide: false };
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { employee: { select: { id: true } } },
    });
    if (scope.kind !== "school" || !user.employee) throw forbidden({ reason: "NOT_A_TEACHER" });
    const [assignments, homeroom] = await Promise.all([
      this.db.teacherAssignment.findMany({
        where: { teacherId: user.employee.id, ...activeOn(today) },
        select: { teachingGroupId: true },
      }),
      this.db.classGroup.findMany({
        where: { homeroomTeacherId: user.employee.id, archivedAt: null },
        select: { id: true },
      }),
    ]);
    return {
      employeeId: user.employee.id,
      teachingGroupIds: [...new Set(assignments.map((a) => a.teachingGroupId))],
      homeroomClassIds: homeroom.map((c) => c.id),
      schoolWide: true,
    };
  }

  private teacherStudentWhere(t: Teacher, today: SchoolDate): Prisma.StudentWhereInput {
    if (t.schoolWide) return {};
    return studentWhere({ kind: "teacher", ...t }, today);
  }

  /** Criteria the teacher may use: active, manual, allowed for everyone or for them, of a subject they teach. */
  private async teacherCriteria(db: Db | DbTransaction, t: Teacher, today: SchoolDate) {
    const subjects = await db.teacherAssignment.findMany({
      where: { teacherId: t.employeeId, ...activeOn(today) },
      select: { subjectId: true },
    });
    const subjectIds = [...new Set(subjects.map((s) => s.subjectId))];
    return db.coinCriterion.findMany({
      where: {
        isActive: true,
        isAutomatic: false,
        OR: [{ eligibility: "ALL_TEACHERS" }, { teachers: { some: { teacherId: t.employeeId } } }],
        AND: [{ OR: [{ subjectId: null }, { subjectId: { in: subjectIds } }] }],
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        minAmount: true,
        maxAmount: true,
        subjectId: true,
        subject: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  /** Teacher evaluations of the student that still stand, from `since` on, at their corrected magnitude. */
  private async evaluations(
    tx: DbTransaction | Db,
    studentId: string,
    since: SchoolDate,
  ): Promise<CountedEvaluation[]> {
    const rows = await tx.coinTransaction.findMany({
      where: {
        studentId,
        source: "TEACHER_CRITERION",
        type: { in: ["REWARD", "PENALTY"] },
        schoolDate: { gte: schoolDateToDb(since) },
        reversedBy: null,
      },
      select: {
        teacherId: true,
        criterionId: true,
        type: true,
        schoolDate: true,
        createdAt: true,
        amount: true,
        corrections: { select: { amount: true } },
      },
    });
    return rows.map((r) => ({
      teacherId: r.teacherId ?? "",
      criterionId: r.criterionId ?? "",
      type: r.type as CoinDirection,
      schoolDate: schoolDateFromDb(r.schoolDate),
      createdAt: r.createdAt,
      magnitude: Math.abs(
        effectiveAmount(
          r.amount,
          r.corrections.map((c) => c.amount),
        ),
      ),
    }));
  }

  private async replay(tx: Db | DbTransaction, key: string, check: (t: { studentId: string }) => boolean) {
    const found = await tx.coinTransaction.findFirst({ where: { idempotencyKey: key }, select: transactionSelect });
    if (!found) return null;
    if (!check(found)) throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
    return { transaction: transactionDto(found), balance: await balanceOf(tx, found.studentId), duplicate: true };
  }

  /** A teacher evaluation (reward or penalty by a criterion). */
  async give(auth: RequestAuth, input: GiveCoinsInput) {
    const settings = await coinSettings(this.db);
    if (!settings.isEnabled) throw coinsOff("COINS_DISABLED");
    if (!settings.teacherEvaluationEnabled) throw coinsOff("EVALUATION_DISABLED");
    const sameStudent = (t: { studentId: string }) => t.studentId === input.studentId;
    const replay = await this.replay(this.db, input.idempotencyKey, sameStudent);
    if (replay) return replay;

    const { timezone, today } = await schoolClock(this.db);
    const teacher = await this.teacher(auth, timezone, today);
    const student = await this.db.student.findFirst({
      where: { AND: [{ id: input.studentId }, this.teacherStudentWhere(teacher, today)] },
      select: { id: true, status: true },
    });
    if (!student) throw notFound();
    if (student.status !== "ACTIVE") throw conflict("STUDENT_INACTIVE");

    const criterion = (await this.teacherCriteria(this.db, teacher, today)).find((c) => c.id === input.criterionId);
    if (!criterion) throw forbidden({ reason: "CRITERION_NOT_ALLOWED" });
    if (criterion.subjectId && !teacher.schoolWide) {
      // A subject criterion: only for students the teacher teaches that subject to.
      const groups = await this.db.teacherAssignment.findMany({
        where: { teacherId: teacher.employeeId, subjectId: criterion.subjectId, ...activeOn(today) },
        select: { teachingGroupId: true },
      });
      const teaches = await this.db.teachingGroupMember.findFirst({
        where: {
          studentId: student.id,
          teachingGroupId: { in: groups.map((g) => g.teachingGroupId) },
          ...activeOn(today),
        },
        select: { id: true },
      });
      if (!teaches) throw forbidden({ reason: "CRITERION_SUBJECT" });
    }
    let type: CoinDirection;
    if (criterion.type === "BOTH") {
      if (!input.type) throw invalid("type", "required");
      type = input.type;
    } else {
      if (input.type && input.type !== criterion.type) throw invalid("type");
      type = criterion.type;
    }
    if (type === "REWARD" && !settings.rewardsEnabled) throw coinsOff("REWARDS_DISABLED");
    if (type === "PENALTY" && !settings.penaltiesEnabled) throw coinsOff("PENALTIES_DISABLED");
    if (input.amount < criterion.minAmount || input.amount > criterion.maxAmount)
      throw invalid("amount", "out_of_range");

    return this.db.$transaction(async (tx) => {
      await lockStudentCoins(tx, student.id);
      const again = await this.replay(tx, input.idempotencyKey, sameStudent);
      if (again) return again;
      const rules = await activeCoinLimits(tx);
      const evaluations = await this.evaluations(tx, student.id, evaluationsSince(rules, today));
      const usage = limitUsage(
        rules,
        evaluations,
        { teacherId: teacher.employeeId, criterionId: criterion.id, type, schoolDate: today, now: new Date() },
        timezone,
      );
      const reasons = checkCoinLimits(usage, input.amount);
      if (reasons.length) throw new AppError("COIN_LIMIT_EXCEEDED", 422, { reasons });
      const result = await post(tx, {
        studentId: student.id,
        type,
        source: "TEACHER_CRITERION",
        amount: type === "PENALTY" ? -input.amount : input.amount,
        floor: type === "PENALTY" ? penaltyFloor(settings) : 0,
        schoolDate: today,
        idempotencyKey: input.idempotencyKey,
        actorUserId: auth.userId,
        criterionId: criterion.id,
        criterionNameSnapshot: criterion.name,
        teacherId: teacher.employeeId,
      });
      await writeAudit(tx, {
        action: "coins.give",
        entityType: "CoinTransaction",
        entityId: result.transaction.id,
        after: { studentId: student.id, criterionId: criterion.id, type, amount: input.amount },
      });
      return { ...result, duplicate: false };
    });
  }

  /** An admin's manual adjustment (either sign, with a reason). */
  async adjust(auth: RequestAuth, input: z.infer<typeof CoinAdjustmentSchema>) {
    const settings = await coinSettings(this.db);
    if (!settings.isEnabled) throw coinsOff("COINS_DISABLED");
    if (!settings.adminAdjustmentEnabled) throw coinsOff("ADJUSTMENT_DISABLED");
    const sameStudent = (t: { studentId: string }) => t.studentId === input.studentId;
    const replay = await this.replay(this.db, input.idempotencyKey, sameStudent);
    if (replay) return replay;
    if (!(await this.db.student.findFirst({ where: { id: input.studentId }, select: { id: true } }))) throw notFound();
    const { today } = await schoolClock(this.db);
    return this.db.$transaction(async (tx) => {
      await lockStudentCoins(tx, input.studentId);
      const again = await this.replay(tx, input.idempotencyKey, sameStudent);
      if (again) return again;
      const result = await post(tx, {
        studentId: input.studentId,
        type: "ADMIN_ADJUSTMENT",
        source: "ADMIN_ADJUST",
        amount: input.amount,
        floor: penaltyFloor(settings),
        schoolDate: today,
        idempotencyKey: input.idempotencyKey,
        actorUserId: auth.userId,
        reason: input.reason,
      });
      await writeAudit(tx, {
        action: "coins.adjust",
        entityType: "CoinTransaction",
        entityId: result.transaction.id,
        after: { studentId: input.studentId, amount: input.amount },
        reason: input.reason,
      });
      return { ...result, duplicate: false };
    });
  }

  private async original(tx: DbTransaction, id: string) {
    const t = await tx.coinTransaction.findFirst({
      where: { id },
      select: { ...transactionSelect, schoolDate: true, actorUserId: true },
    });
    if (!t) throw notFound();
    return t;
  }

  /**
   * Undoes a reward, penalty or adjustment at its effective amount (purchases go through order refunds). `coins.reverse`
   * may reverse anything with a reason; the evaluating teacher may undo their own evaluation the same school day.
   */
  async reverse(auth: RequestAuth, id: string, input: z.infer<typeof ReverseCoinSchema>) {
    const settings = await coinSettings(this.db);
    if (!settings.isEnabled) throw coinsOff("COINS_DISABLED");
    const replay = await this.replay(this.db, input.idempotencyKey, () => true);
    if (replay) {
      if (replay.transaction.reversesTransactionId !== id) throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
      return replay;
    }
    const { today } = await schoolClock(this.db);
    const admin = auth.permissions.includes("coins.reverse");
    return this.db.$transaction(async (tx) => {
      const first = await this.original(tx, id);
      await lockStudentCoins(tx, first.studentId);
      const again = await this.replay(tx, input.idempotencyKey, () => true);
      if (again) return again;
      const original = await this.original(tx, id);
      if (!["REWARD", "PENALTY", "ADMIN_ADJUSTMENT"].includes(original.type)) throw conflict("NOT_REVERSIBLE");
      if (original.reversedBy) throw conflict("ALREADY_REVERSED");
      const ownToday =
        original.actorUserId === auth.userId &&
        original.source === "TEACHER_CRITERION" &&
        schoolDateFromDb(original.schoolDate) === today;
      if (!admin && !ownToday) throw forbidden();
      if (!ownToday && !input.reason) throw invalid("reason", "required");
      const effective = effectiveAmount(
        original.amount,
        original.corrections.map((c) => c.amount),
      );
      const result = await post(tx, {
        studentId: original.studentId,
        type: "REVERSAL",
        source: original.source,
        amount: -effective,
        floor: penaltyFloor(settings),
        schoolDate: today,
        idempotencyKey: input.idempotencyKey,
        actorUserId: auth.userId,
        criterionId: original.criterionId,
        criterionNameSnapshot: original.criterionNameSnapshot,
        teacherId: original.teacherId,
        reversesTransactionId: original.id,
        reason: input.reason ?? null,
      });
      await writeAudit(tx, {
        action: "coins.reverse",
        entityType: "CoinTransaction",
        entityId: original.id,
        before: { amount: effective },
        after: { reversalId: result.transaction.id },
        reason: input.reason ?? null,
      });
      return { ...result, duplicate: false };
    });
  }

  /** Lowers an evaluation (never raises it — that would bypass the limits). `amount` is the new signed amount. */
  async correct(auth: RequestAuth, id: string, input: z.infer<typeof CorrectCoinSchema>) {
    const settings = await coinSettings(this.db);
    if (!settings.isEnabled) throw coinsOff("COINS_DISABLED");
    const replay = await this.replay(this.db, input.idempotencyKey, () => true);
    if (replay) {
      if (replay.transaction.correctsTransactionId !== id) throw new AppError("IDEMPOTENCY_KEY_REUSED", 409);
      return replay;
    }
    const { today } = await schoolClock(this.db);
    return this.db.$transaction(async (tx) => {
      const first = await this.original(tx, id);
      await lockStudentCoins(tx, first.studentId);
      const again = await this.replay(tx, input.idempotencyKey, () => true);
      if (again) return again;
      const original = await this.original(tx, id);
      if (original.type !== "REWARD" && original.type !== "PENALTY") throw conflict("NOT_CORRECTABLE");
      if (original.reversedBy) throw conflict("ALREADY_REVERSED");
      const effective = effectiveAmount(
        original.amount,
        original.corrections.map((c) => c.amount),
      );
      const delta = correctionDelta(original.amount, effective, input.amount);
      if ("error" in delta) throw invalid("amount", delta.error.toLowerCase());
      const result = await post(tx, {
        studentId: original.studentId,
        type: "CORRECTION",
        source: original.source,
        amount: delta.delta,
        floor: penaltyFloor(settings),
        schoolDate: today,
        idempotencyKey: input.idempotencyKey,
        actorUserId: auth.userId,
        criterionId: original.criterionId,
        criterionNameSnapshot: original.criterionNameSnapshot,
        teacherId: original.teacherId,
        correctsTransactionId: original.id,
        reason: input.reason,
      });
      await writeAudit(tx, {
        action: "coins.correct",
        entityType: "CoinTransaction",
        entityId: original.id,
        before: { amount: effective },
        after: { amount: input.amount, correctionId: result.transaction.id },
        reason: input.reason,
      });
      return { ...result, duplicate: false };
    });
  }

  // ---- reads

  private listWhere(q: z.infer<typeof CoinTransactionQuerySchema>): Prisma.CoinTransactionWhereInput {
    return {
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.teacherId ? { teacherId: q.teacherId } : {}),
      ...(q.criterionId ? { criterionId: q.criterionId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.from || q.to
        ? {
            schoolDate: {
              ...(q.from ? { gte: schoolDateToDb(q.from) } : {}),
              ...(q.to ? { lte: schoolDateToDb(q.to) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            student: {
              OR: [
                { firstName: { contains: q.q, mode: "insensitive" as const } },
                { lastName: { contains: q.q, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };
  }

  private async pageOf(where: Prisma.CoinTransactionWhereInput, q: z.infer<typeof CoinTransactionQuerySchema>) {
    const [rows, total] = await Promise.all([
      this.db.coinTransaction.findMany({
        where,
        select: transactionSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...skipTake(q),
      }),
      this.db.coinTransaction.count({ where }),
    ]);
    return page(rows.map(transactionDto), total, q);
  }

  /** The whole ledger (coins.view). */
  list(q: z.infer<typeof CoinTransactionQuerySchema>) {
    return this.pageOf(this.listWhere(q), q);
  }

  /** What the teacher gave (their "history"). */
  async teacherHistory(auth: RequestAuth, q: z.infer<typeof CoinTransactionQuerySchema>) {
    const { timezone, today } = await schoolClock(this.db);
    const teacher = await this.teacher(auth, timezone, today);
    return this.pageOf({ AND: [this.listWhere(q), { teacherId: teacher.employeeId }] }, q);
  }

  /** A student the caller may see: staff with coins.view (school), teachers (own students), self, own child. */
  async visibleStudent(auth: RequestAuth, studentId: string) {
    const { timezone, today } = await schoolClock(this.db);
    const scope = await resolveScope(this.db, auth, timezone);
    if (scope.kind === "school" && !auth.permissions.includes("coins.view") && !auth.permissions.includes("coins.give"))
      throw forbidden();
    const student = await this.db.student.findFirst({
      where: { AND: [{ id: studentId }, studentWhere(scope, today)] },
      select: { id: true },
    });
    if (!student) throw notFound();
    return today;
  }

  async studentHistory(auth: RequestAuth, studentId: string, q: z.infer<typeof CoinTransactionQuerySchema>) {
    await this.visibleStudent(auth, studentId);
    return this.pageOf({ AND: [this.listWhere(q), { studentId }] }, q);
  }

  /** Balance and totals by kind (reversals and corrections counted with what they change), last 30 days by day. */
  async summary(auth: RequestAuth, studentId: string) {
    const today = await this.visibleStudent(auth, studentId);
    const [balance, settings, rows] = await Promise.all([
      balanceOf(this.db, studentId),
      coinSettings(this.db),
      this.db.coinTransaction.findMany({
        where: { studentId },
        select: {
          type: true,
          amount: true,
          schoolDate: true,
          reversesTransaction: { select: { type: true } },
          correctsTransaction: { select: { type: true } },
        },
      }),
    ]);
    const from = addSchoolDays(today, -29);
    const days = new Map<string, { earned: number; penalties: number }>();
    for (const d of eachSchoolDate(from, today)) days.set(d, { earned: 0, penalties: 0 });
    let earned = 0;
    let penalties = 0;
    let spent = 0;
    for (const r of rows) {
      const kind = r.reversesTransaction?.type ?? r.correctsTransaction?.type ?? r.type;
      const bucket = days.get(schoolDateFromDb(r.schoolDate));
      if (kind === "REWARD") {
        earned += r.amount;
        if (bucket) bucket.earned += r.amount;
      } else if (kind === "PENALTY") {
        penalties -= r.amount;
        if (bucket) bucket.penalties -= r.amount;
      } else if (kind === "PURCHASE" || kind === "REFUND") spent -= r.amount;
    }
    return {
      studentId,
      balance,
      earned,
      penalties,
      spent,
      maxDebt: settings.allowNegativeBalance ? settings.maxDebt : null,
      series: [...days].map(([date, v]) => ({ date: date as SchoolDate, ...v })),
    };
  }

  // ---- teacher board

  /** The teacher's groups, their students with balances, and the criteria they may use. */
  async board(auth: RequestAuth) {
    const { timezone, today } = await schoolClock(this.db);
    const teacher = await this.teacher(auth, timezone, today);
    const studentFilter = studentWhere({ kind: "teacher", ...teacher }, today);
    const [groups, students, criteria, given] = await Promise.all([
      this.db.teacherAssignment.findMany({
        where: { teacherId: teacher.employeeId, ...activeOn(today) },
        select: { teachingGroup: { select: { id: true, name: true } }, subject: { select: { name: true } } },
        orderBy: { teachingGroup: { name: "asc" } },
      }),
      this.db.student.findMany({
        where: { AND: [studentFilter, { status: "ACTIVE" }] },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          coinAccount: { select: { balance: true } },
          groupMemberships: {
            where: { teachingGroupId: { in: teacher.teachingGroupIds }, ...activeOn(today) },
            select: { teachingGroupId: true },
          },
          enrollments: {
            where: { status: "ACTIVE" },
            select: { classGroup: { select: { name: true } } },
            take: 1,
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      this.teacherCriteria(this.db, teacher, today),
      this.db.coinTransaction.groupBy({
        by: ["studentId"],
        where: {
          teacherId: teacher.employeeId,
          source: "TEACHER_CRITERION",
          type: { in: ["REWARD", "PENALTY"] },
          schoolDate: schoolDateToDb(today),
          reversedBy: null,
        },
        _count: { _all: true },
      }),
    ]);
    const todayCount = new Map(given.map((g) => [g.studentId, g._count._all]));
    return {
      groups: [...new Map(groups.map((g) => [g.teachingGroup.id, g])).values()].map((g) => ({
        id: g.teachingGroup.id,
        name: g.teachingGroup.name,
        subjectName: g.subject.name,
      })),
      students: students.map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        className: s.enrollments[0]?.classGroup.name ?? null,
        groupIds: s.groupMemberships.map((m) => m.teachingGroupId),
        balance: s.coinAccount?.balance ?? 0,
        todayByMe: todayCount.get(s.id) ?? 0,
      })),
      criteria: criteria.map(({ subject, ...c }) => ({ ...c, subjectName: subject?.name ?? null })),
    };
  }

  /** What is left for this teacher, criterion and student now (reads only — the write checks again). */
  async capacity(auth: RequestAuth, studentId: string, q: z.infer<typeof CapacityQuerySchema>) {
    const { timezone, today } = await schoolClock(this.db);
    const teacher = await this.teacher(auth, timezone, today);
    const student = await this.db.student.findFirst({
      where: { AND: [{ id: studentId }, this.teacherStudentWhere(teacher, today)] },
      select: { id: true },
    });
    if (!student) throw notFound();
    const criterion = (await this.teacherCriteria(this.db, teacher, today)).find((c) => c.id === q.criterionId);
    if (!criterion) throw forbidden({ reason: "CRITERION_NOT_ALLOWED" });
    const type: CoinDirection = criterion.type === "BOTH" ? (q.type ?? "REWARD") : criterion.type;
    const rules = await activeCoinLimits(this.db);
    const usage = limitUsage(
      rules,
      await this.evaluations(this.db, studentId, evaluationsSince(rules, today)),
      { teacherId: teacher.employeeId, criterionId: criterion.id, type, schoolDate: today, now: new Date() },
      timezone,
    );
    return remainingCapacity(usage, criterion.minAmount);
  }
}
