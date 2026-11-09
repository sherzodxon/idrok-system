-- Audit decision T-76: employees use Face ID too, and their working day is reported. Additive only: existing student
-- rows keep their studentId; the new employeeId columns are nullable.

-- AlterTable
ALTER TABLE "FaceProfile" ALTER COLUMN "studentId" DROP NOT NULL,
ADD COLUMN "employeeId" UUID;

ALTER TABLE "FaceSyncJob" ALTER COLUMN "studentId" DROP NOT NULL,
ADD COLUMN "employeeId" UUID;

ALTER TABLE "AccessEvent" ADD COLUMN "employeeId" UUID;

ALTER TABLE "AttendanceSettings" ADD COLUMN "staffStartMinute" INTEGER NOT NULL DEFAULT 480,
ADD COLUMN "staffEndMinute" INTEGER NOT NULL DEFAULT 1020,
ADD COLUMN "staffGraceMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "FaceProfile_tenantId_employeeId_key" ON "FaceProfile"("tenantId", "employeeId");
CREATE UNIQUE INDEX "FaceSyncJob_deviceId_employeeId_key" ON "FaceSyncJob"("deviceId", "employeeId");
CREATE INDEX "AccessEvent_tenantId_employeeId_schoolDate_idx" ON "AccessEvent"("tenantId", "employeeId", "schoolDate");

-- AddForeignKey
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaceSyncJob" ADD CONSTRAINT "FaceSyncJob_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A face (and its sync row) belongs to exactly one person; an event to at most one.
ALTER TABLE "FaceProfile" ADD CONSTRAINT "FaceProfile_subject_check" CHECK (("studentId" IS NULL) <> ("employeeId" IS NULL));
ALTER TABLE "FaceSyncJob" ADD CONSTRAINT "FaceSyncJob_subject_check" CHECK (("studentId" IS NULL) <> ("employeeId" IS NULL));
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_subject_check" CHECK ("studentId" IS NULL OR "employeeId" IS NULL);

-- The staff day is ordered like the school day.
ALTER TABLE "AttendanceSettings" ADD CONSTRAINT "AttendanceSettings_staff_check" CHECK (
  "staffStartMinute" BETWEEN 0 AND 1439
  AND "staffEndMinute" BETWEEN 1 AND 1439
  AND "staffEndMinute" > "staffStartMinute"
  AND "staffGraceMinutes" BETWEEN 0 AND 120
);
