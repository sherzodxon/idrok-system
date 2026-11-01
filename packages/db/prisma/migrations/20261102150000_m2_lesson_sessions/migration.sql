-- M2 step 3: concrete lessons generated from the timetable (docs/spec/lesson-plan.md §3).

-- CreateEnum
CREATE TYPE "LessonSessionStatus" AS ENUM ('SCHEDULED', 'HELD', 'CANCELLED', 'MOVED');

-- CreateEnum
CREATE TYPE "LessonSessionSource" AS ENUM ('TIMETABLE', 'MANUAL');

-- CreateTable
CREATE TABLE "LessonSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "teachingGroupId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "substituteTeacherId" UUID,
    "date" DATE NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "status" "LessonSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "source" "LessonSessionSource" NOT NULL DEFAULT 'TIMETABLE',
    "timetableEntryId" UUID,
    "actualTopicNote" TEXT,
    "heldMarkedAt" TIMESTAMPTZ(3),
    "heldMarkedById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LessonSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonSession_tenantId_teacherId_date_idx" ON "LessonSession"("tenantId", "teacherId", "date");

-- CreateIndex
CREATE INDEX "LessonSession_tenantId_substituteTeacherId_date_idx" ON "LessonSession"("tenantId", "substituteTeacherId", "date");

-- CreateIndex
CREATE INDEX "LessonSession_teachingGroupId_subjectId_sequenceNo_idx" ON "LessonSession"("teachingGroupId", "subjectId", "sequenceNo");

-- CreateIndex
CREATE INDEX "LessonSession_periodId_teachingGroupId_subjectId_idx" ON "LessonSession"("periodId", "teachingGroupId", "subjectId");

-- CreateIndex
CREATE INDEX "LessonSession_academicYearId_date_idx" ON "LessonSession"("academicYearId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LessonSession_teachingGroupId_date_lessonNumber_key" ON "LessonSession"("teachingGroupId", "date", "lessonNumber");

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_timetableEntryId_fkey" FOREIGN KEY ("timetableEntryId") REFERENCES "TimetableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_times_check" CHECK (
  "startsAt" < "endsAt" AND "lessonNumber" BETWEEN 0 AND 20 AND "sequenceNo" >= 0
  AND ("status" <> 'HELD' OR "heldMarkedAt" IS NOT NULL)
);

-- Lessons are history: a dropped lesson is CANCELLED, never deleted.
CREATE TRIGGER "LessonSession_no_delete"
  BEFORE DELETE ON "LessonSession"
  FOR EACH ROW EXECUTE FUNCTION idrok_reject_modification();
