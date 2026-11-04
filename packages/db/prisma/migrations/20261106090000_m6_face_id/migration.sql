-- CreateEnum
CREATE TYPE "DeviceDirection" AS ENUM ('IN', 'OUT', 'BOTH');

-- CreateEnum
CREATE TYPE "EventDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AccessEventSource" AS ENUM ('WEBHOOK', 'HISTORY');

-- CreateEnum
CREATE TYPE "SchoolAttendanceStatus" AS ENUM ('PRESENT', 'LATE');

-- CreateEnum
CREATE TYPE "ManualAttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "FaceSyncAction" AS ENUM ('UPSERT', 'DELETE');

-- CreateEnum
CREATE TYPE "FaceSyncStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "BridgeJobType" AS ENUM ('FACE_UPSERT', 'FACE_DELETE', 'FACE_CHECK', 'DEVICE_INFO', 'EVENT_HISTORY');

-- CreateEnum
CREATE TYPE "BridgeJobStatus" AS ENUM ('QUEUED', 'LEASED', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'FACE_PHOTO';

-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "tenantId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultStartMinute" INTEGER NOT NULL DEFAULT 510,
    "defaultEndMinute" INTEGER NOT NULL DEFAULT 810,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "acceptedSubEvents" INTEGER[] DEFAULT ARRAY[75]::INTEGER[],
    "maxClockSkewSeconds" INTEGER NOT NULL DEFAULT 300,
    "maxEventAgeDays" INTEGER NOT NULL DEFAULT 7,
    "deviceStaleSeconds" INTEGER NOT NULL DEFAULT 180,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "LatenessBand" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fromMinute" INTEGER NOT NULL,
    "toMinute" INTEGER,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LatenessBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeAgent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "previousTokenHash" TEXT,
    "previousTokenExpiresAt" TIMESTAMPTZ(3),
    "tokenRotatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT,
    "hostname" TEXT,
    "queueDepth" INTEGER,
    "lastSeenAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BridgeAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "ipAddress" TEXT,
    "port" INTEGER NOT NULL DEFAULT 80,
    "username" TEXT,
    "passwordEnc" TEXT,
    "direction" "DeviceDirection" NOT NULL,
    "location" TEXT,
    "useBridge" BOOLEAN NOT NULL DEFAULT true,
    "bridgeAgentId" UUID,
    "webhookKeyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT,
    "firmware" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastEventAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "schoolDate" DATE NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "studentId" UUID,
    "direction" "EventDirection",
    "attendanceStatus" TEXT,
    "majorEventType" INTEGER NOT NULL,
    "subEventType" INTEGER NOT NULL,
    "source" "AccessEventSource" NOT NULL DEFAULT 'WEBHOOK',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "schoolDate" DATE NOT NULL,
    "firstInAt" TIMESTAMPTZ(3),
    "lastOutAt" TIMESTAMPTZ(3),
    "deviceStatus" "SchoolAttendanceStatus",
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "latenessBandId" UUID,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "manualStatus" "ManualAttendanceStatus",
    "manualReason" TEXT,
    "manualById" UUID,
    "manualAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "photoAssetId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FaceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSyncJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "action" "FaceSyncAction" NOT NULL,
    "status" "FaceSyncStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER,
    "syncedVersion" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "deviceHasFace" BOOLEAN,
    "syncedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FaceSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bridgeAgentId" UUID,
    "deviceId" UUID NOT NULL,
    "faceSyncId" UUID,
    "type" "BridgeJobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BridgeJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leasedUntil" TIMESTAMPTZ(3),
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BridgeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LatenessBand_tenantId_fromMinute_idx" ON "LatenessBand"("tenantId", "fromMinute");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeAgent_tokenHash_key" ON "BridgeAgent"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeAgent_previousTokenHash_key" ON "BridgeAgent"("previousTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeAgent_tenantId_name_key" ON "BridgeAgent"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Device_webhookKeyHash_key" ON "Device"("webhookKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tenantId_name_key" ON "Device"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tenantId_serialNumber_key" ON "Device"("tenantId", "serialNumber");

-- CreateIndex
CREATE INDEX "AccessEvent_tenantId_studentId_schoolDate_idx" ON "AccessEvent"("tenantId", "studentId", "schoolDate");

-- CreateIndex
CREATE INDEX "AccessEvent_tenantId_schoolDate_idx" ON "AccessEvent"("tenantId", "schoolDate");

-- CreateIndex
CREATE UNIQUE INDEX "AccessEvent_deviceId_eventKey_key" ON "AccessEvent"("deviceId", "eventKey");

-- CreateIndex
CREATE INDEX "AttendanceRecord_tenantId_schoolDate_idx" ON "AttendanceRecord"("tenantId", "schoolDate");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_tenantId_studentId_schoolDate_key" ON "AttendanceRecord"("tenantId", "studentId", "schoolDate");

-- CreateIndex
CREATE UNIQUE INDEX "FaceProfile_tenantId_studentId_key" ON "FaceProfile"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "FaceSyncJob_tenantId_status_idx" ON "FaceSyncJob"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FaceSyncJob_deviceId_studentId_key" ON "FaceSyncJob"("deviceId", "studentId");

-- CreateIndex
CREATE INDEX "BridgeJob_bridgeAgentId_status_createdAt_idx" ON "BridgeJob"("bridgeAgentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BridgeJob_tenantId_deviceId_status_idx" ON "BridgeJob"("tenantId", "deviceId", "status");

-- AddForeignKey
ALTER TABLE "AttendanceSettings" ADD CONSTRAINT "AttendanceSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatenessBand" ADD CONSTRAINT "LatenessBand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeAgent" ADD CONSTRAINT "BridgeAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_bridgeAgentId_fkey" FOREIGN KEY ("bridgeAgentId") REFERENCES "BridgeAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_latenessBandId_fkey" FOREIGN KEY ("latenessBandId") REFERENCES "LatenessBand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSyncJob" ADD CONSTRAINT "FaceSyncJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSyncJob" ADD CONSTRAINT "FaceSyncJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSyncJob" ADD CONSTRAINT "FaceSyncJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeJob" ADD CONSTRAINT "BridgeJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeJob" ADD CONSTRAINT "BridgeJob_bridgeAgentId_fkey" FOREIGN KEY ("bridgeAgentId") REFERENCES "BridgeAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeJob" ADD CONSTRAINT "BridgeJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeJob" ADD CONSTRAINT "BridgeJob_faceSyncId_fkey" FOREIGN KEY ("faceSyncId") REFERENCES "FaceSyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

ALTER TABLE "AttendanceSettings" ADD CONSTRAINT "AttendanceSettings_check" CHECK (
  "defaultStartMinute" BETWEEN 0 AND 1439
  AND "defaultEndMinute" BETWEEN 1 AND 1439
  AND "defaultEndMinute" > "defaultStartMinute"
  AND "graceMinutes" BETWEEN 0 AND 120
  AND "maxClockSkewSeconds" BETWEEN 0 AND 3600
  AND "maxEventAgeDays" BETWEEN 1 AND 60
  AND "deviceStaleSeconds" BETWEEN 30 AND 86400
);

ALTER TABLE "LatenessBand" ADD CONSTRAINT "LatenessBand_check" CHECK (
  "fromMinute" >= 1 AND ("toMinute" IS NULL OR "toMinute" > "fromMinute")
);

ALTER TABLE "Device" ADD CONSTRAINT "Device_port_check" CHECK ("port" BETWEEN 1 AND 65535);

-- Raw terminal events are insert-only (attendance is recomputed from them).
CREATE TRIGGER "AccessEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AccessEvent"
  FOR EACH ROW EXECUTE FUNCTION idrok_reject_modification();

-- A device result has its arrival time; lateness only when late; a manual mark has its author, time and reason.
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_check" CHECK (
  (("deviceStatus" IS NULL) = ("firstInAt" IS NULL))
  AND "lateMinutes" >= 0 AND "earlyLeaveMinutes" >= 0
  AND ("deviceStatus" = 'LATE' OR ("lateMinutes" = 0 AND "latenessBandId" IS NULL))
  AND ("lastOutAt" IS NULL OR ("firstInAt" IS NOT NULL AND "lastOutAt" >= "firstInAt"))
  AND (("manualStatus" IS NULL) = ("manualAt" IS NULL))
  AND ("manualStatus" IS NULL OR ("manualById" IS NOT NULL AND length(btrim(coalesce("manualReason", ''))) > 0))
  AND ("deviceStatus" IS NOT NULL OR "manualStatus" IS NOT NULL)
);
