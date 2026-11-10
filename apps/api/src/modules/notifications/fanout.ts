// One event → one Notification per eligible guardian (T-93). (guardian, dedupeKey) is unique, so producing the same
// event twice creates nothing new; each new row gets an outbox event delivered at its (quiet-hours adjusted) time.
import { requireTenantId, type DbTransaction, type NotificationKind, type Prisma } from "@idrok/db";
import type { NotificationPreferenceDto, NotificationSettingsDto } from "@idrok/shared";
import { deferForQuietHours, effectiveQuietHours } from "../../domain/notifications";
import { PREFERENCE_DEFAULTS, pickPreference } from "./settings";

type StudentKind = Exclude<NotificationKind, "BROADCAST">;

const SCHOOL_SWITCH: Record<StudentKind, keyof NotificationSettingsDto> = {
  ARRIVAL: "arrivalEnabled",
  DEPARTURE: "departureEnabled",
  LOW_ATTENDANCE: "lowAttendanceEnabled",
  DAILY_DIGEST: "dailyDigestEnabled",
  TEST_RESULT: "testResultsEnabled",
};
const OWN_SWITCH: Record<StudentKind, keyof NotificationPreferenceDto> = {
  ARRIVAL: "arrival",
  DEPARTURE: "departure",
  LOW_ATTENDANCE: "lowAttendance",
  DAILY_DIGEST: "dailyDigest",
  TEST_RESULT: "testResults",
};

export const schoolAllows = (settings: NotificationSettingsDto, kind: StudentKind) =>
  settings.isEnabled && settings[SCHOOL_SWITCH[kind]] === true;

interface Recipient {
  guardianId: string;
  scheduledAt: Date;
}

/** Writes the notifications and their delivery events; returns how many were new. */
export async function enqueueNotifications(
  tx: DbTransaction,
  rows: (Recipient & {
    kind: NotificationKind;
    dedupeKey: string;
    params: Prisma.InputJsonValue;
    studentId?: string | null;
    broadcastId?: string | null;
  })[],
): Promise<number> {
  if (!rows.length) return 0;
  const created = await tx.notification.createManyAndReturn({
    data: rows.map((r) => ({
      guardianId: r.guardianId,
      kind: r.kind,
      dedupeKey: r.dedupeKey,
      params: r.params,
      studentId: r.studentId ?? null,
      broadcastId: r.broadcastId ?? null,
      scheduledAt: r.scheduledAt,
    })),
    skipDuplicates: true,
    select: { id: true, scheduledAt: true },
  });
  if (!created.length) return 0;
  const tenantId = requireTenantId();
  await tx.outboxEvent.createMany({
    data: created.map((n) => ({
      tenantId,
      type: "notification.deliver",
      aggregateType: "Notification",
      aggregateId: n.id,
      payload: { tenantId, notificationId: n.id },
      availableAt: n.scheduledAt,
    })),
  });
  return created.length;
}

/**
 * The student's guardians who should hear about `kind`: an active link with notifications on and data access, their
 * own switch on, and a channel (a Telegram link, or SMS fallback switched on).
 */
export async function notifyStudentGuardians(
  tx: DbTransaction,
  input: {
    kind: StudentKind;
    studentId: string;
    dedupeKey: string;
    params: Prisma.InputJsonValue;
    settings: NotificationSettingsDto;
    tz: string;
    at?: Date;
  },
): Promise<number> {
  if (!schoolAllows(input.settings, input.kind)) return 0;
  const links = await tx.studentGuardian.findMany({
    where: { studentId: input.studentId, revokedAt: null, receivesNotifications: true, canViewData: true },
    select: {
      guardianId: true,
      guardian: {
        select: {
          notificationPreference: true,
          telegramLinks: { where: { revokedAt: null, blockedAt: null }, select: { id: true } },
        },
      },
    },
  });
  const at = input.at ?? new Date();
  const school = { startMinute: input.settings.quietStartMinute, endMinute: input.settings.quietEndMinute };
  const recipients: Recipient[] = [];
  for (const l of links) {
    const own = l.guardian.notificationPreference
      ? pickPreference(l.guardian.notificationPreference)
      : PREFERENCE_DEFAULTS;
    if (own[OWN_SWITCH[input.kind]] !== true) continue;
    if (!l.guardian.telegramLinks.length && !input.settings.smsFallbackEnabled) continue;
    recipients.push({
      guardianId: l.guardianId,
      scheduledAt: deferForQuietHours(at, effectiveQuietHours(school, own), input.tz),
    });
  }
  return enqueueNotifications(
    tx,
    recipients.map((r) => ({
      ...r,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      params: input.params,
      studentId: input.studentId,
    })),
  );
}
