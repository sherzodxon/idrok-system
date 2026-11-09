// School notification settings and a guardian's own preferences (T-92, T-93). Settings changes are audited.
import type { z } from "zod";
import { requireTenantId, type Db, type DbTransaction } from "@idrok/db";
import type {
  NotificationPreferenceDto,
  NotificationSettingsDto,
  UpdateNotificationPreferenceSchema,
  UpdateNotificationSettingsSchema,
} from "@idrok/shared";
import { D } from "@idrok/shared/decimal";
import { writeAudit } from "../audit/audit.service";

export const NOTIFICATION_DEFAULTS: NotificationSettingsDto = {
  isEnabled: true,
  arrivalEnabled: true,
  departureEnabled: true,
  lowAttendanceEnabled: true,
  dailyDigestEnabled: true,
  testResultsEnabled: true,
  departureDelayMinutes: 10,
  digestMinute: 19 * 60,
  lowAttendanceThreshold: "80.00",
  lowAttendanceWindowDays: 30,
  quietStartMinute: 22 * 60,
  quietEndMinute: 7 * 60,
  maxPerGuardianPerHour: 10,
  linkCodeTtlHours: 72,
  smsFallbackEnabled: false,
};

export const PREFERENCE_DEFAULTS: NotificationPreferenceDto = {
  arrival: true,
  departure: true,
  lowAttendance: true,
  dailyDigest: true,
  testResults: true,
  quietStartMinute: null,
  quietEndMinute: null,
  quietHoursOff: false,
};

export async function notificationSettings(db: Db | DbTransaction): Promise<NotificationSettingsDto> {
  const row = await db.notificationSettings.findFirst();
  if (!row) return NOTIFICATION_DEFAULTS;
  const { tenantId: _t, updatedAt: _u, lowAttendanceThreshold, ...rest } = row;
  return { ...rest, lowAttendanceThreshold: D(lowAttendanceThreshold.toString()).toFixed(2) };
}

export async function updateNotificationSettings(
  db: Db,
  input: z.infer<typeof UpdateNotificationSettingsSchema>,
): Promise<NotificationSettingsDto> {
  return db.$transaction(async (tx) => {
    const before = await notificationSettings(tx);
    const next = { ...before, ...input };
    const data = { ...next, lowAttendanceThreshold: D(next.lowAttendanceThreshold).toFixed(2) };
    await tx.notificationSettings.upsert({
      where: { tenantId: requireTenantId() },
      create: data,
      update: data,
    });
    await writeAudit(tx, {
      action: "notifications.settings.update",
      entityType: "NotificationSettings",
      entityId: null,
      before,
      after: data,
    });
    return data;
  });
}

type PreferenceRow = NotificationPreferenceDto;

export async function preferenceOf(db: Db | DbTransaction, guardianId: string): Promise<NotificationPreferenceDto> {
  const row = await db.notificationPreference.findUnique({ where: { guardianId } });
  return row ? pickPreference(row) : PREFERENCE_DEFAULTS;
}

export const pickPreference = (row: PreferenceRow): NotificationPreferenceDto => ({
  arrival: row.arrival,
  departure: row.departure,
  lowAttendance: row.lowAttendance,
  dailyDigest: row.dailyDigest,
  testResults: row.testResults,
  quietStartMinute: row.quietStartMinute,
  quietEndMinute: row.quietEndMinute,
  quietHoursOff: row.quietHoursOff,
});

export async function updatePreference(
  db: Db,
  guardianId: string,
  input: z.infer<typeof UpdateNotificationPreferenceSchema>,
): Promise<NotificationPreferenceDto> {
  const next = { ...(await preferenceOf(db, guardianId)), ...input };
  const row = await db.notificationPreference.upsert({
    where: { guardianId },
    create: { ...next, guardianId },
    update: next,
  });
  return pickPreference(row);
}
