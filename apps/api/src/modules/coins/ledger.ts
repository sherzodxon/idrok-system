// The coin ledger core (CLAUDE.md §4): every write for a student runs in one transaction under an advisory lock on the
// student, checks the balance floor against the locked account and inserts one CoinTransaction together with the
// cached balance. Rows are never updated or deleted — mistakes are REVERSAL / CORRECTION rows.
import { requireTenantId, type Db, type DbTransaction, type Prisma } from "@idrok/db";
import type { CoinSettingsDto } from "@idrok/shared";
import { schoolDateFromDb, schoolDateToDb, type SchoolDate } from "@idrok/shared/time";
import { fitsFloor } from "../../domain/coins";
import { AppError } from "../../http/errors";

export const COIN_SETTINGS_DEFAULTS: CoinSettingsDto = {
  isEnabled: true,
  rewardsEnabled: true,
  penaltiesEnabled: true,
  teacherEvaluationEnabled: true,
  adminAdjustmentEnabled: true,
  autoCoinsEnabled: true,
  shopEnabled: true,
  newOrdersEnabled: true,
  orderApprovalRequired: true,
  allowNegativeBalance: false,
  maxDebt: null,
  activityWindowDays: 7,
  activityMinCoverage: 30,
  activityStaleDays: 3,
};

export async function coinSettings(db: Db | DbTransaction): Promise<CoinSettingsDto> {
  const row = await db.coinSettings.findFirst();
  if (!row) return COIN_SETTINGS_DEFAULTS;
  const { id: _id, tenantId: _t, updatedById: _u, updatedAt: _a, ...rest } = row;
  return rest;
}

/** A switched-off part of the coin system. */
export const coinsOff = (reason: string) => new AppError("FORBIDDEN", 403, { reason });

export const lockStudentCoins = (tx: DbTransaction, studentId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`coins:${requireTenantId()}:${studentId}`}, 0))`;

/**
 * The academic year a school day belongs to: the one containing it, else the last one that started before it (summer
 * records belong to the year that just ended — Q-34).
 */
export async function yearFor(tx: DbTransaction | Db, day: SchoolDate): Promise<string> {
  const d = schoolDateToDb(day);
  const year =
    (await tx.academicYear.findFirst({
      where: { startDate: { lte: d }, endDate: { gte: d } },
      select: { id: true },
    })) ??
    (await tx.academicYear.findFirst({
      where: { startDate: { lte: d } },
      orderBy: { startDate: "desc" },
      select: { id: true },
    }));
  if (!year) throw new AppError("CONFLICT", 409, { reason: "NO_ACADEMIC_YEAR" });
  return year.id;
}

export const transactionSelect = {
  id: true,
  studentId: true,
  student: { select: { firstName: true, lastName: true } },
  type: true,
  source: true,
  amount: true,
  balanceAfter: true,
  schoolDate: true,
  criterionId: true,
  criterionNameSnapshot: true,
  teacherId: true,
  teacher: { select: { firstName: true, lastName: true } },
  reason: true,
  reversesTransactionId: true,
  correctsTransactionId: true,
  reversedBy: { select: { id: true } },
  corrections: { select: { amount: true } },
  orderId: true,
  createdAt: true,
} satisfies Prisma.CoinTransactionSelect;
export type TransactionRow = Prisma.CoinTransactionGetPayload<{ select: typeof transactionSelect }>;

const fullName = (p: { firstName: string; lastName: string } | null) => (p ? `${p.lastName} ${p.firstName}` : null);

export function transactionDto(t: TransactionRow) {
  const evaluation = t.type === "REWARD" || t.type === "PENALTY";
  return {
    id: t.id,
    studentId: t.studentId,
    studentName: fullName(t.student) ?? "",
    type: t.type,
    source: t.source,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    schoolDate: schoolDateFromDb(t.schoolDate),
    criterionId: t.criterionId,
    criterionName: t.criterionNameSnapshot,
    teacherId: t.teacherId,
    teacherName: fullName(t.teacher),
    reason: t.reason,
    reversesTransactionId: t.reversesTransactionId,
    correctsTransactionId: t.correctsTransactionId,
    reversed: t.reversedBy !== null,
    effectiveAmount: evaluation ? t.corrections.reduce((s, c) => s + c.amount, t.amount) : null,
    orderId: t.orderId,
    createdAt: t.createdAt.toISOString(),
  };
}

export interface PostInput {
  studentId: string;
  type: Prisma.CoinTransactionUncheckedCreateInput["type"];
  source: Prisma.CoinTransactionUncheckedCreateInput["source"];
  amount: number;
  /** The lowest balance a debit may leave (null: no floor). */
  floor: number | null;
  schoolDate: SchoolDate;
  idempotencyKey: string;
  actorUserId: string | null;
  criterionId?: string | null;
  criterionNameSnapshot?: string | null;
  teacherId?: string | null;
  orderId?: string | null;
  reversesTransactionId?: string | null;
  correctsTransactionId?: string | null;
  sourceRef?: string | null;
  reason?: string | null;
}

/** Inserts one ledger row and moves the cached balance. The caller holds the student's lock. */
export async function post(tx: DbTransaction, input: PostInput) {
  const tenantId = requireTenantId();
  const account = await tx.coinAccount.upsert({
    where: { studentId: input.studentId },
    create: { tenantId, studentId: input.studentId },
    update: {},
    select: { balance: true },
  });
  if (!fitsFloor(account.balance, input.amount, input.floor))
    throw new AppError("COIN_INSUFFICIENT_BALANCE", 422, {
      balance: account.balance,
      floor: input.floor,
      available: input.floor === null ? null : Math.max(0, account.balance - input.floor),
    });
  const balanceAfter = account.balance + input.amount;
  await tx.coinAccount.update({ where: { studentId: input.studentId }, data: { balance: balanceAfter } });
  const transaction = await tx.coinTransaction.create({
    data: {
      tenantId,
      studentId: input.studentId,
      type: input.type,
      source: input.source,
      amount: input.amount,
      balanceAfter,
      schoolDate: schoolDateToDb(input.schoolDate),
      academicYearId: await yearFor(tx, input.schoolDate),
      criterionId: input.criterionId ?? null,
      criterionNameSnapshot: input.criterionNameSnapshot ?? null,
      teacherId: input.teacherId ?? null,
      actorUserId: input.actorUserId,
      orderId: input.orderId ?? null,
      reversesTransactionId: input.reversesTransactionId ?? null,
      correctsTransactionId: input.correctsTransactionId ?? null,
      sourceRef: input.sourceRef ?? null,
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey,
    },
    select: transactionSelect,
  });
  return { transaction: transactionDto(transaction), balance: balanceAfter };
}

/** The cached balance (0 for a student without coins yet). */
export async function balanceOf(db: Db | DbTransaction, studentId: string) {
  const account = await db.coinAccount.findUnique({ where: { studentId }, select: { balance: true } });
  return account?.balance ?? 0;
}

/**
 * Daily reconciliation (edextest-audit.md §5): the cached balance must equal the ledger sum and the last row's
 * balanceAfter. Runs on the root client across tenants; returns the mismatching accounts (nothing is changed).
 */
export async function reconcileCoins(root: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> }) {
  return root.$queryRaw<
    { tenantId: string; studentId: string; balance: number; ledger: number; last: number | null }[]
  >`
    SELECT a."tenantId", a."studentId", a."balance",
           COALESCE(SUM(t."amount"), 0)::int AS "ledger",
           (SELECT t2."balanceAfter" FROM "CoinTransaction" t2
             WHERE t2."studentId" = a."studentId" ORDER BY t2."createdAt" DESC, t2."id" DESC LIMIT 1) AS "last"
    FROM "CoinAccount" a
    LEFT JOIN "CoinTransaction" t ON t."studentId" = a."studentId"
    GROUP BY a."id"
    HAVING a."balance" <> COALESCE(SUM(t."amount"), 0)
        OR a."balance" <> COALESCE((SELECT t3."balanceAfter" FROM "CoinTransaction" t3
             WHERE t3."studentId" = a."studentId" ORDER BY t3."createdAt" DESC, t3."id" DESC LIMIT 1), 0)`;
}
