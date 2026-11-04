// School attendance, Face ID devices, bridges and face sync (M6, MASTER_SPEC §11).
import { z } from "zod";
import { ListQuerySchema, SchoolDateSchema } from "./common";

const minuteOfDay = z.number().int().min(0).max(1439);

// ---- settings and lateness bands

export const AttendanceSettingsSchema = z.object({
  isEnabled: z.boolean(),
  defaultStartMinute: minuteOfDay,
  defaultEndMinute: minuteOfDay,
  graceMinutes: z.number().int().min(0).max(120),
  acceptedSubEvents: z.array(z.number().int().min(0).max(1000)).min(1).max(20),
  maxClockSkewSeconds: z.number().int().min(0).max(3600),
  maxEventAgeDays: z.number().int().min(1).max(60),
  deviceStaleSeconds: z.number().int().min(30).max(86_400),
  /** Read-only: the server can encrypt device passwords and face photos (DATA_ENCRYPTION_KEY set). */
  encryptionConfigured: z.boolean(),
});
export type AttendanceSettingsDto = z.infer<typeof AttendanceSettingsSchema>;

export const UpdateAttendanceSettingsSchema = AttendanceSettingsSchema.omit({ encryptionConfigured: true })
  .partial()
  .strict();

export const LatenessBandSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  fromMinute: z.number().int(),
  toMinute: z.number().int().nullable(),
  archived: z.boolean(),
});
export type LatenessBandDto = z.infer<typeof LatenessBandSchema>;

export const UpsertLatenessBandSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    fromMinute: z.number().int().min(1).max(600),
    toMinute: z.number().int().min(2).max(601).nullable(),
  })
  .strict()
  .refine((b) => b.toMinute === null || b.toMinute > b.fromMinute, { message: "invalid_range", path: ["toMinute"] });

// ---- bridge agents and devices

export const ConnectionStatusSchema = z.enum(["ONLINE", "OFFLINE", "UNKNOWN"]);

export const BridgeAgentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  version: z.string().nullable(),
  hostname: z.string().nullable(),
  queueDepth: z.number().int().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  tokenRotatedAt: z.iso.datetime(),
  connection: ConnectionStatusSchema,
  deviceCount: z.number().int(),
  pendingJobs: z.number().int(),
});
export type BridgeAgentDto = z.infer<typeof BridgeAgentSchema>;

export const UpsertBridgeAgentSchema = z
  .object({ name: z.string().trim().min(1).max(60), isActive: z.boolean().optional() })
  .strict();

/** The plain token is shown once, when created or rotated. */
export const BridgeTokenSchema = z.object({ agent: BridgeAgentSchema, token: z.string() });

export const DeviceDirectionSchema = z.enum(["IN", "OUT", "BOTH"]);

export const DeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  serialNumber: z.string().nullable(),
  ipAddress: z.string().nullable(),
  port: z.number().int(),
  username: z.string().nullable(),
  hasPassword: z.boolean(),
  direction: DeviceDirectionSchema,
  location: z.string().nullable(),
  useBridge: z.boolean(),
  bridgeAgentId: z.uuid().nullable(),
  bridgeAgentName: z.string().nullable(),
  isActive: z.boolean(),
  model: z.string().nullable(),
  firmware: z.string().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  lastEventAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  connection: ConnectionStatusSchema,
  archived: z.boolean(),
  eventsToday: z.number().int(),
  faces: z.object({ synced: z.number().int(), pending: z.number().int(), failed: z.number().int() }),
});
export type DeviceDto = z.infer<typeof DeviceSchema>;

const host = z
  .string()
  .trim()
  .max(253)
  .regex(/^[a-zA-Z0-9.:-]+$/, { message: "invalid_host" });

export const UpsertDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    serialNumber: z.string().trim().min(1).max(64).nullable(),
    ipAddress: host.nullable(),
    port: z.number().int().min(1).max(65_535),
    username: z.string().trim().min(1).max(64).nullable(),
    /** Omitted = keep; null = remove; a string = replace. */
    password: z.string().min(1).max(128).nullable().optional(),
    direction: DeviceDirectionSchema,
    location: z.string().trim().max(120).nullable(),
    useBridge: z.boolean(),
    bridgeAgentId: z.uuid().nullable(),
    isActive: z.boolean(),
  })
  .strict()
  .refine((d) => !d.useBridge || d.bridgeAgentId !== null, { message: "bridge_required", path: ["bridgeAgentId"] });

/** The webhook URL path carries the device key; shown once, when created or rotated. */
export const DeviceKeySchema = z.object({ device: DeviceSchema, webhookKey: z.string(), webhookPath: z.string() });

// ---- face profiles and sync (Face Check)

export const FaceSyncStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "SYNCED", "FAILED"]);

export const FaceDeviceStateSchema = z.object({
  deviceId: z.uuid(),
  deviceName: z.string(),
  action: z.enum(["UPSERT", "DELETE"]),
  status: FaceSyncStatusSchema,
  upToDate: z.boolean(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  syncedAt: z.iso.datetime().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  deviceHasFace: z.boolean().nullable(),
});
export type FaceDeviceStateDto = z.infer<typeof FaceDeviceStateSchema>;

export const FaceProfileSchema = z.object({
  studentId: z.uuid(),
  studentCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  className: z.string().nullable(),
  hasPhoto: z.boolean(),
  version: z.number().int().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  /** Worst state across devices: NONE when the student has no photo. */
  overall: z.enum(["NONE", "SYNCED", "PENDING", "FAILED"]),
  devices: z.array(FaceDeviceStateSchema),
});
export type FaceProfileDto = z.infer<typeof FaceProfileSchema>;

export const FaceProfileQuerySchema = ListQuerySchema.extend({
  classGroupId: z.uuid().optional(),
  overall: z.enum(["NONE", "SYNCED", "PENDING", "FAILED"]).optional(),
});

export const FaceProfilePageSchema = z.object({
  items: z.array(FaceProfileSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.record(z.string(), z.number().int()),
});

// ---- school attendance

export const SchoolAttendanceStatusSchema = z.enum(["PRESENT", "LATE", "ABSENT", "NOT_ARRIVED", "EXCUSED"]);
export type SchoolAttendanceStatusDto = z.infer<typeof SchoolAttendanceStatusSchema>;
export const ManualAttendanceStatusSchema = z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]);

export const AttendanceDayRowSchema = z.object({
  studentId: z.uuid(),
  studentCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  className: z.string().nullable(),
  status: SchoolAttendanceStatusSchema,
  deviceStatus: SchoolAttendanceStatusSchema,
  firstInAt: z.iso.datetime().nullable(),
  lastOutAt: z.iso.datetime().nullable(),
  lateMinutes: z.number().int(),
  latenessBandName: z.string().nullable(),
  earlyLeaveMinutes: z.number().int(),
  manualStatus: ManualAttendanceStatusSchema.nullable(),
  manualReason: z.string().nullable(),
});
export type AttendanceDayRowDto = z.infer<typeof AttendanceDayRowSchema>;

export const AttendanceDayQuerySchema = ListQuerySchema.extend({
  date: SchoolDateSchema.optional(),
  classGroupId: z.uuid().optional(),
  status: SchoolAttendanceStatusSchema.optional(),
});

export const AttendanceDaySchema = z.object({
  date: SchoolDateSchema,
  /** false = a day off for the whole school. */
  schoolDay: z.boolean(),
  items: z.array(AttendanceDayRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.record(z.string(), z.number().int()),
});
export type AttendanceDayDto = z.infer<typeof AttendanceDaySchema>;

export const StudentAttendanceQuerySchema = z.object({
  from: SchoolDateSchema.optional(),
  to: SchoolDateSchema.optional(),
});

export const StudentAttendanceDaySchema = AttendanceDayRowSchema.pick({
  status: true,
  firstInAt: true,
  lastOutAt: true,
  lateMinutes: true,
  latenessBandName: true,
  earlyLeaveMinutes: true,
  manualStatus: true,
  manualReason: true,
}).extend({ date: SchoolDateSchema });

export const StudentAttendanceSchema = z.object({
  studentId: z.uuid(),
  from: SchoolDateSchema,
  to: SchoolDateSchema,
  days: z.array(StudentAttendanceDaySchema),
  counts: z.record(z.string(), z.number().int()),
});
export type StudentAttendanceDto = z.infer<typeof StudentAttendanceSchema>;

export const ManualMarkParamsSchema = z.object({ id: z.uuid(), date: SchoolDateSchema });

export const ManualMarkSchema = z
  .object({ status: ManualAttendanceStatusSchema, reason: z.string().trim().min(1).max(300) })
  .strict();

export const ClearManualMarkSchema = z.object({ reason: z.string().trim().min(1).max(300) }).strict();

// ---- events and monitoring

export const AccessEventSchema = z.object({
  id: z.uuid(),
  deviceId: z.uuid(),
  deviceName: z.string(),
  occurredAt: z.iso.datetime(),
  employeeNo: z.string(),
  studentId: z.uuid().nullable(),
  studentName: z.string().nullable(),
  direction: z.enum(["IN", "OUT"]).nullable(),
  source: z.enum(["WEBHOOK", "HISTORY"]),
});
export type AccessEventDto = z.infer<typeof AccessEventSchema>;

export const AccessEventQuerySchema = ListQuerySchema.extend({
  date: SchoolDateSchema.optional(),
  deviceId: z.uuid().optional(),
  unmatched: z.enum(["true", "false"]).optional(),
});

export const AttendanceMonitoringSchema = z.object({
  date: SchoolDateSchema,
  devices: z.object({ online: z.number().int(), offline: z.number().int(), unknown: z.number().int() }),
  bridges: z.object({ online: z.number().int(), offline: z.number().int(), unknown: z.number().int() }),
  eventsToday: z.number().int(),
  unmatchedToday: z.number().int(),
  faces: z.object({
    none: z.number().int(),
    synced: z.number().int(),
    pending: z.number().int(),
    failed: z.number().int(),
  }),
  failedJobs: z.number().int(),
});
export type AttendanceMonitoringDto = z.infer<typeof AttendanceMonitoringSchema>;

export const AttendanceFeatureSchema = z.object({ isEnabled: z.boolean() });

// ---- bridge protocol (machine to machine; the bridge authenticates with its bearer token)

export const BridgeHeartbeatSchema = z
  .object({
    version: z.string().trim().max(40),
    hostname: z.string().trim().max(120),
    queueDepth: z.number().int().min(0).max(1_000_000),
    devices: z
      .array(
        z.object({
          deviceId: z.uuid(),
          reachable: z.boolean(),
          error: z.string().max(300).nullable().optional(),
        }),
      )
      .max(100),
  })
  .strict();

export const BridgeDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  ipAddress: z.string().nullable(),
  port: z.number().int(),
  username: z.string().nullable(),
  /** Decrypted for the bridge only (TLS); never logged. */
  password: z.string().nullable(),
  direction: DeviceDirectionSchema,
  isActive: z.boolean(),
});

export const BridgeHeartbeatResponseSchema = z.object({
  serverTime: z.iso.datetime(),
  pollSeconds: z.number().int(),
  /** The school's UTC offset today ("+05:00"): terminals take local times with an offset. */
  utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/),
  /** The bridge should rotate its token (older than the rotation period). */
  rotateToken: z.boolean(),
  devices: z.array(BridgeDeviceSchema),
});

export const BridgeJobTypeSchema = z.enum(["FACE_UPSERT", "FACE_DELETE", "FACE_CHECK", "DEVICE_INFO", "EVENT_HISTORY"]);

export const BridgeJobSchema = z.object({
  id: z.uuid(),
  deviceId: z.uuid(),
  type: BridgeJobTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  leasedUntil: z.iso.datetime(),
});
export type BridgeJobDto = z.infer<typeof BridgeJobSchema>;

export const BridgeLeaseSchema = z.object({ max: z.number().int().min(1).max(50).default(10) }).strict();

export const BridgeJobResultSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().max(1000).nullable().optional(),
    result: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

/** Events relayed by the bridge: the raw Hikvision event JSON, per device. */
export const BridgeEventsSchema = z
  .object({
    deviceId: z.uuid(),
    source: z.enum(["WEBHOOK", "HISTORY"]),
    events: z.array(z.unknown()).min(1).max(500),
  })
  .strict();

export const IngestResultSchema = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  ignored: z.number().int(),
  unmatched: z.number().int(),
});
export type IngestResultDto = z.infer<typeof IngestResultSchema>;
