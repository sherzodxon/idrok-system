// Terminal events → AccessEvent (raw, insert-only, idempotent per device event) → AttendanceRecord (recomputed for the
// student's school day under a lock). Used by the device webhook and by the bridge, which relays the same JSON.
import { Prisma, requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import type { IngestResultDto } from "@idrok/shared";
import { schoolDateFromDb, schoolDateToDb, toSchoolDate, type SchoolDate } from "@idrok/shared/time";
import { dailyAttendance, eventDirection, type DeviceDirection } from "../../domain/attendance";
import { eventKey, parseHikEvent, withinClockSkew } from "../../domain/hikvision";
import { schoolClock } from "../access/school-clock";
import { activeBands, attendanceSettings } from "./attendance-config.service";
import { studentDays } from "./school-day";

export interface IngestDevice {
  id: string;
  direction: DeviceDirection;
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Runs inside the device's tenant context. Unparseable items are counted as ignored, never fail the batch. */
export async function ingestEvents(
  db: Db,
  device: IngestDevice,
  raws: unknown[],
  source: "WEBHOOK" | "HISTORY",
  now: Date = new Date(),
): Promise<IngestResultDto & { lastEventAt: Date | null }> {
  const settings = await attendanceSettings(db);
  const { timezone } = await schoolClock(db);
  const result = { accepted: 0, duplicates: 0, ignored: 0, unmatched: 0, lastEventAt: null as Date | null };
  const touched = new Map<string, { studentId: string; date: SchoolDate }>();
  const studentByCode = new Map<string, string | null>();

  for (const raw of raws) {
    let parsed;
    try {
      parsed = parseHikEvent(raw, { tz: timezone, acceptedSubEvents: settings.acceptedSubEvents });
    } catch {
      result.ignored++;
      continue;
    }
    if (parsed.kind !== "ACCESS") {
      if (parsed.kind === "IGNORED") result.ignored++;
      continue;
    }
    if (
      !settings.isEnabled ||
      !withinClockSkew(parsed.occurredAt, now, settings.maxClockSkewSeconds, settings.maxEventAgeDays)
    ) {
      result.ignored++;
      continue;
    }
    if (!studentByCode.has(parsed.employeeNo)) {
      const s = await db.student.findFirst({ where: { studentCode: parsed.employeeNo }, select: { id: true } });
      studentByCode.set(parsed.employeeNo, s?.id ?? null);
    }
    const studentId = studentByCode.get(parsed.employeeNo) ?? null;
    const date = toSchoolDate(parsed.occurredAt, timezone);
    try {
      await db.accessEvent.create({
        data: {
          tenantId: requireTenantId(),
          deviceId: device.id,
          eventKey: eventKey(parsed),
          occurredAt: parsed.occurredAt,
          schoolDate: schoolDateToDb(date),
          employeeNo: parsed.employeeNo,
          studentId,
          direction: eventDirection(device.direction, parsed.attendanceStatus),
          attendanceStatus: parsed.attendanceStatus,
          majorEventType: parsed.majorEventType,
          subEventType: parsed.subEventType,
          source,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      result.duplicates++;
      continue;
    }
    result.accepted++;
    if (!result.lastEventAt || parsed.occurredAt > result.lastEventAt) result.lastEventAt = parsed.occurredAt;
    if (studentId) touched.set(`${studentId}:${date}`, { studentId, date });
    else result.unmatched++;
  }

  for (const t of touched.values()) await recomputeDay(db, t.studentId, t.date);
  return result;
}

const lockDay = (tx: DbTransaction, studentId: string, date: SchoolDate) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${requireTenantId()}:${studentId}:${date}`}, 0))`;

/** Recomputes the device part of one student's day from all of its events; a manual mark is kept as it is. */
export async function recomputeDay(db: Db, studentId: string, date: SchoolDate): Promise<void> {
  const [settings, bands, { timezone }] = await Promise.all([attendanceSettings(db), activeBands(db), schoolClock(db)]);
  await db.$transaction(async (tx) => {
    await lockDay(tx, studentId, date);
    const d = schoolDateToDb(date);
    const events = await tx.accessEvent.findMany({
      where: { studentId, schoolDate: d },
      select: { occurredAt: true, direction: true },
    });
    const day = (await studentDays(tx, date, { settings, bands, tz: timezone }, { studentIds: [studentId] })).get(
      studentId,
    );
    const rules = day?.rules ?? {
      schoolDate: date,
      startMinute: settings.defaultStartMinute,
      endMinute: settings.defaultEndMinute,
      graceMinutes: settings.graceMinutes,
      bands,
      tz: timezone,
    };
    const r = dailyAttendance(
      events.map((e) => ({ at: e.occurredAt, direction: e.direction })),
      rules,
      false,
    );
    const device = {
      firstInAt: r.firstInAt,
      lastOutAt: r.lastOutAt,
      deviceStatus: r.status === "PRESENT" || r.status === "LATE" ? r.status : null,
      lateMinutes: r.lateMinutes,
      latenessBandId: r.latenessBandId,
      earlyLeaveMinutes: r.earlyLeaveMinutes,
    };
    const existing = await tx.attendanceRecord.findUnique({
      where: { tenantId_studentId_schoolDate: { tenantId: requireTenantId(), studentId, schoolDate: d } },
      select: { id: true, manualStatus: true },
    });
    if (!device.deviceStatus && !existing) return;
    if (existing && !device.deviceStatus && !existing.manualStatus) {
      await tx.attendanceRecord.delete({ where: { id: existing.id } });
    } else if (existing) {
      await tx.attendanceRecord.update({ where: { id: existing.id }, data: device });
    } else {
      await tx.attendanceRecord.create({ data: { tenantId: requireTenantId(), studentId, schoolDate: d, ...device } });
    }
  });
}

/** Recompute every student with events on a day (after a settings or band change, by an admin action). */
export async function recomputeDate(db: Db, date: SchoolDate): Promise<number> {
  const rows = await db.accessEvent.findMany({
    where: { schoolDate: schoolDateToDb(date), studentId: { not: null } },
    distinct: ["studentId"],
    select: { studentId: true, schoolDate: true },
  });
  for (const r of rows) await recomputeDay(db, r.studentId!, schoolDateFromDb(r.schoolDate));
  return rows.length;
}
