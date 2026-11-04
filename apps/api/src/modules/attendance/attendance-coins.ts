// Automatic coins for school attendance (MASTER_SPEC §11 "Kechikish", §14 "Avtomatik coin"): on time, or per lateness
// band. A day is awarded once its shift is over (late-delivered events from a bridge are in by then), once per student
// and day (sourceRef "attendance:<date>"), and never re-evaluated afterwards. A manual mark, a day off or a late
// arrival outside every band earns nothing. A penalty takes at most what the debt floor allows.
import type { Db } from "@idrok/db";
import { AttendanceRuleConfigSchema } from "@idrok/shared";
import type { SchoolDate } from "@idrok/shared/time";
import { schoolDateToDb } from "@idrok/shared/time";
import { attendanceAward, attendanceOutcome, isDayOver } from "../../domain/attendance";
import { penaltyFloor } from "../../domain/coins";
import { writeAudit } from "../audit/audit.service";
import { schoolClock } from "../access/school-clock";
import { coinSettings, lockStudentCoins, post } from "../coins/ledger";
import { activeBands, attendanceSettings } from "./attendance-config.service";
import { studentDays } from "./school-day";

export async function awardAttendanceCoins(db: Db, date: SchoolDate, now: Date = new Date()): Promise<number> {
  const coins = await coinSettings(db);
  if (!coins.isEnabled || !coins.autoCoinsEnabled) return 0;
  const rows = await db.coinAutoRule.findMany({
    where: { source: "ATTENDANCE", isActive: true, criterion: { isActive: true } },
    select: { id: true, criterionId: true, config: true, criterion: { select: { name: true, type: true } } },
  });
  if (!rows.length) return 0;
  const rules = rows.map((r) => {
    const config = AttendanceRuleConfigSchema.parse(r.config);
    return {
      id: r.id,
      outcome: config.latenessBandId ?? "ON_TIME",
      amount: config.amount,
      criterionId: r.criterionId,
      criterionName: r.criterion.name,
      type: config.latenessBandId === null ? ("REWARD" as const) : ("PENALTY" as const),
    };
  });
  const [settings, bands, { timezone }] = await Promise.all([attendanceSettings(db), activeBands(db), schoolClock(db)]);
  const records = await db.attendanceRecord.findMany({
    where: { schoolDate: schoolDateToDb(date), deviceStatus: { not: null }, manualStatus: null },
    select: { studentId: true, deviceStatus: true, latenessBandId: true },
  });
  if (!records.length) return 0;
  const days = await studentDays(
    db,
    date,
    { settings, bands, tz: timezone },
    {
      studentIds: records.map((r) => r.studentId),
    },
  );
  const sourceRef = `attendance:${date}`;
  let awarded = 0;
  for (const rec of records) {
    const day = days.get(rec.studentId);
    if (!day?.expected || !isDayOver(day.rules, now)) continue;
    const outcome = attendanceOutcome({ status: rec.deviceStatus!, latenessBandId: rec.latenessBandId }, null);
    const match = attendanceAward(outcome, rules);
    const rule = match && rules.find((r) => r.outcome === match.outcome);
    if (!rule) continue;
    if (rule.type === "REWARD" ? !coins.rewardsEnabled : !coins.penaltiesEnabled) continue;
    const done = await db.$transaction(async (tx) => {
      await lockStudentCoins(tx, rec.studentId);
      const existing = await tx.coinTransaction.findFirst({
        where: { studentId: rec.studentId, source: "ATTENDANCE", sourceRef },
        select: { id: true },
      });
      if (existing) return false;
      let amount = rule.amount;
      const floor = rule.type === "PENALTY" ? penaltyFloor(coins) : 0;
      if (rule.type === "PENALTY" && floor !== null) {
        const account = await tx.coinAccount.findUnique({
          where: { studentId: rec.studentId },
          select: { balance: true },
        });
        amount = Math.min(amount, (account?.balance ?? 0) - floor);
        if (amount <= 0) return false;
      }
      const { transaction } = await post(tx, {
        studentId: rec.studentId,
        type: rule.type,
        source: "ATTENDANCE",
        amount: rule.type === "PENALTY" ? -amount : amount,
        floor,
        schoolDate: date,
        idempotencyKey: `auto:${sourceRef}:${rec.studentId}`,
        actorUserId: null,
        criterionId: rule.criterionId,
        criterionNameSnapshot: rule.criterionName,
        sourceRef,
      });
      await writeAudit(tx, {
        action: "coins.auto.attendance",
        entityType: "CoinTransaction",
        entityId: transaction.id,
        actorUserId: null,
        after: { date, studentId: rec.studentId, ruleId: rule.id, amount: transaction.amount },
      });
      return true;
    });
    if (done) awarded++;
  }
  return awarded;
}
