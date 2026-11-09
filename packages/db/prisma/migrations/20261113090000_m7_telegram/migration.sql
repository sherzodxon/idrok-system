-- M7: Telegram bot, guardian linking, notifications and broadcasts (docs/architecture/m7-telegram.md). Additive only.
-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN "telegramLinkId" UUID;
CREATE INDEX "AuthSession_telegramLinkId_idx" ON "AuthSession"("telegramLinkId");

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ARRIVAL', 'DEPARTURE', 'LOW_ATTENDANCE', 'DAILY_DIGEST', 'TEST_RESULT', 'BROADCAST');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('TELEGRAM', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "username" TEXT,
    "languageCode" TEXT,
    "method" TEXT NOT NULL,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "revokedByUserId" UUID,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUpdate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "updateId" BIGINT NOT NULL,
    "payload" JSONB,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "tenantId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "arrivalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "departureEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lowAttendanceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "testResultsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "departureDelayMinutes" INTEGER NOT NULL DEFAULT 10,
    "digestMinute" INTEGER NOT NULL DEFAULT 1140,
    "lowAttendanceThreshold" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "lowAttendanceWindowDays" INTEGER NOT NULL DEFAULT 30,
    "quietStartMinute" INTEGER NOT NULL DEFAULT 1320,
    "quietEndMinute" INTEGER NOT NULL DEFAULT 420,
    "maxPerGuardianPerHour" INTEGER NOT NULL DEFAULT 10,
    "linkCodeTtlHours" INTEGER NOT NULL DEFAULT 72,
    "smsFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "guardianId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "arrival" BOOLEAN NOT NULL DEFAULT true,
    "departure" BOOLEAN NOT NULL DEFAULT true,
    "lowAttendance" BOOLEAN NOT NULL DEFAULT true,
    "dailyDigest" BOOLEAN NOT NULL DEFAULT true,
    "testResults" BOOLEAN NOT NULL DEFAULT true,
    "quietStartMinute" INTEGER,
    "quietEndMinute" INTEGER,
    "quietHoursOff" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("guardianId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "studentId" UUID,
    "broadcastId" UUID,
    "kind" "NotificationKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'TELEGRAM',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "classGroupIds" UUID[],
    "recipientCount" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramLink_tenantId_guardianId_idx" ON "TelegramLink"("tenantId", "guardianId");

-- CreateIndex
CREATE INDEX "TelegramLink_tenantId_telegramUserId_idx" ON "TelegramLink"("tenantId", "telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkCode_codeHash_key" ON "TelegramLinkCode"("codeHash");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_tenantId_guardianId_idx" ON "TelegramLinkCode"("tenantId", "guardianId");

-- CreateIndex
CREATE INDEX "TelegramUpdate_receivedAt_idx" ON "TelegramUpdate"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUpdate_tenantId_updateId_key" ON "TelegramUpdate"("tenantId", "updateId");

-- CreateIndex
CREATE INDEX "NotificationPreference_tenantId_idx" ON "NotificationPreference"("tenantId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_guardianId_sentAt_idx" ON "Notification"("tenantId", "guardianId", "sentAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_broadcastId_status_idx" ON "Notification"("tenantId", "broadcastId", "status");

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_guardianId_dedupeKey_key" ON "Notification"("tenantId", "guardianId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Broadcast_tenantId_createdAt_idx" ON "Broadcast"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUpdate" ADD CONSTRAINT "TelegramUpdate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active Telegram account per guardian and one guardian per Telegram account (T-89); revoked links stay.
CREATE UNIQUE INDEX "TelegramLink_one_active_guardian" ON "TelegramLink" ("tenantId", "guardianId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "TelegramLink_one_active_user" ON "TelegramLink" ("tenantId", "telegramUserId") WHERE "revokedAt" IS NULL;
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_method_check" CHECK ("method" IN ('CONTACT', 'CODE'));

ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_check" CHECK (
  "departureDelayMinutes" BETWEEN 0 AND 180
  AND "digestMinute" BETWEEN 0 AND 1439
  AND "quietStartMinute" BETWEEN 0 AND 1439
  AND "quietEndMinute" BETWEEN 0 AND 1439
  AND "lowAttendanceThreshold" BETWEEN 0 AND 100
  AND "lowAttendanceWindowDays" BETWEEN 7 AND 120
  AND "maxPerGuardianPerHour" BETWEEN 1 AND 100
  AND "linkCodeTtlHours" BETWEEN 1 AND 720
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_quiet_check" CHECK (
  ("quietStartMinute" IS NULL) = ("quietEndMinute" IS NULL)
  AND ("quietStartMinute" IS NULL OR "quietStartMinute" BETWEEN 0 AND 1439)
  AND ("quietEndMinute" IS NULL OR "quietEndMinute" BETWEEN 0 AND 1439)
);
