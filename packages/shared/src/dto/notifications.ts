// M7: guardians in Telegram, notification settings and broadcasts (docs/architecture/m7-telegram.md).
import { z } from "zod";
import { ListQuerySchema } from "./common";

const minute = z.number().int().min(0).max(1439);

// ---- Mini App login

export const TelegramWebAppLoginSchema = z
  .object({
    /** Telegram.WebApp.initData exactly as Telegram passed it (query string). */
    initData: z.string().min(1).max(4096),
  })
  .strict();

// ---- school settings

export const NotificationSettingsSchema = z.object({
  isEnabled: z.boolean(),
  arrivalEnabled: z.boolean(),
  departureEnabled: z.boolean(),
  lowAttendanceEnabled: z.boolean(),
  dailyDigestEnabled: z.boolean(),
  testResultsEnabled: z.boolean(),
  departureDelayMinutes: z.number().int().min(0).max(180),
  digestMinute: minute,
  /** Percent, decimal string ("80.00"). */
  lowAttendanceThreshold: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  lowAttendanceWindowDays: z.number().int().min(7).max(120),
  quietStartMinute: minute,
  quietEndMinute: minute,
  maxPerGuardianPerHour: z.number().int().min(1).max(100),
  linkCodeTtlHours: z.number().int().min(1).max(720),
  smsFallbackEnabled: z.boolean(),
});
export type NotificationSettingsDto = z.infer<typeof NotificationSettingsSchema>;

export const TelegramStatusSchema = z.object({
  /** The bot token and webhook secret are configured on the server. */
  botConfigured: z.boolean(),
  botUsername: z.string().nullable(),
  /** No SMS provider is connected yet (Q-57). */
  smsProviderConfigured: z.boolean(),
});

export const TelegramAdminSettingsSchema = z.object({
  settings: NotificationSettingsSchema,
  status: TelegramStatusSchema,
});
export type TelegramAdminSettingsDto = z.infer<typeof TelegramAdminSettingsSchema>;

export const UpdateNotificationSettingsSchema = NotificationSettingsSchema.partial()
  .strict()
  .refine((v) => v.lowAttendanceThreshold === undefined || Number(v.lowAttendanceThreshold) <= 100, {
    message: "max_100",
    path: ["lowAttendanceThreshold"],
  });

// ---- guardians' links (admin)

export const TelegramLinkStatusSchema = z.enum(["LINKED", "BLOCKED", "NOT_LINKED"]);
export type TelegramLinkStatus = z.infer<typeof TelegramLinkStatusSchema>;

export const TelegramGuardianSchema = z.object({
  guardianId: z.uuid(),
  fullName: z.string(),
  phone: z.string(),
  children: z.array(z.object({ id: z.uuid(), fullName: z.string(), classGroup: z.string().nullable() })),
  status: TelegramLinkStatusSchema,
  linkedAt: z.iso.datetime().nullable(),
  method: z.enum(["CONTACT", "CODE"]).nullable(),
  telegramUsername: z.string().nullable(),
  lastSentAt: z.iso.datetime().nullable(),
  /** An unused, unexpired code exists (its value is never shown again). */
  pendingCodeExpiresAt: z.iso.datetime().nullable(),
});
export type TelegramGuardianDto = z.infer<typeof TelegramGuardianSchema>;

export const TelegramGuardianQuerySchema = ListQuerySchema.extend({
  status: TelegramLinkStatusSchema.optional(),
  classGroupId: z.uuid().optional(),
});

export const TelegramLinkSummarySchema = z.object({
  guardians: z.number().int(),
  linked: z.number().int(),
  blocked: z.number().int(),
});

export const LinkCodeIssuedSchema = z.object({
  /** Shown once; only its hash is stored. */
  code: z.string(),
  /** t.me deep link with the code, null while the bot username is not configured. */
  deepLink: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type LinkCodeIssuedDto = z.infer<typeof LinkCodeIssuedSchema>;

// ---- broadcasts

export const BroadcastTargetSchema = z
  .object({ classGroupIds: z.array(z.uuid()).min(1).max(200) })
  .strict();

export const BroadcastPreviewSchema = z.object({
  students: z.number().int(),
  guardians: z.number().int(),
  /** Guardians who will get it in Telegram now. */
  reachable: z.number().int(),
});
export type BroadcastPreviewDto = z.infer<typeof BroadcastPreviewSchema>;

export const CreateBroadcastSchema = z
  .object({
    classGroupIds: z.array(z.uuid()).min(1).max(200),
    text: z.string().trim().min(1).max(3000),
  })
  .strict();

export const BroadcastSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  classGroups: z.array(z.string()),
  recipientCount: z.number().int(),
  sent: z.number().int(),
  pending: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type BroadcastDto = z.infer<typeof BroadcastSchema>;

// ---- a guardian's own preferences (portal and Mini App)

export const NotificationPreferenceSchema = z.object({
  arrival: z.boolean(),
  departure: z.boolean(),
  lowAttendance: z.boolean(),
  dailyDigest: z.boolean(),
  testResults: z.boolean(),
  /** null = the school's quiet hours. */
  quietStartMinute: minute.nullable(),
  quietEndMinute: minute.nullable(),
  quietHoursOff: z.boolean(),
});
export type NotificationPreferenceDto = z.infer<typeof NotificationPreferenceSchema>;

export const MyNotificationsSchema = z.object({
  preferences: NotificationPreferenceSchema,
  schoolQuietStartMinute: minute,
  schoolQuietEndMinute: minute,
  telegram: z.object({
    status: TelegramLinkStatusSchema,
    linkedAt: z.iso.datetime().nullable(),
    botUsername: z.string().nullable(),
  }),
});
export type MyNotificationsDto = z.infer<typeof MyNotificationsSchema>;

export const UpdateNotificationPreferenceSchema = NotificationPreferenceSchema.partial()
  .strict()
  .refine((v) => (v.quietStartMinute === undefined) === (v.quietEndMinute === undefined), {
    message: "both_or_none",
    path: ["quietEndMinute"],
  });
