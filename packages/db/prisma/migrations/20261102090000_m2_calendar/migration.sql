-- M2 step 1: academic periods, school week, calendar days, shifts, bell schedules, rooms (docs/spec/lesson-plan.md §2).

-- CreateEnum
CREATE TYPE "AcademicPeriodType" AS ENUM ('QUARTER', 'HALF', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AcademicPeriodStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "CalendarDayKind" AS ENUM ('HOLIDAY', 'VACATION', 'NON_WORKING', 'WORKING_OVERRIDE', 'SHORTENED');

-- AlterTable
ALTER TABLE "ClassGroup" ADD COLUMN     "shiftId" UUID;

-- CreateTable
CREATE TABLE "AcademicPeriod" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "type" "AcademicPeriodType" NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "parentId" UUID,
    "status" "AcademicPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "closedAt" TIMESTAMPTZ(3),
    "closedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AcademicPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolWeek" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "workingWeekdays" INTEGER[],
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SchoolWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarDay" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "CalendarDayKind" NOT NULL,
    "title" TEXT NOT NULL,
    "followsWeekday" INTEGER,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarDayGrade" (
    "calendarDayId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,

    CONSTRAINT "CalendarDayGrade_pkey" PRIMARY KEY ("calendarDayId","gradeId")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BellSchedule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "shiftId" UUID,
    "name" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BellSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BellSlot" (
    "id" UUID NOT NULL,
    "bellScheduleId" UUID NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "BellSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademicPeriod_tenantId_academicYearId_idx" ON "AcademicPeriod"("tenantId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicPeriod_academicYearId_type_order_key" ON "AcademicPeriod"("academicYearId", "type", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolWeek_academicYearId_key" ON "SchoolWeek"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarDay_academicYearId_date_key" ON "CalendarDay"("academicYearId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_tenantId_name_key" ON "Shift"("tenantId", "name");

-- CreateIndex
CREATE INDEX "BellSchedule_academicYearId_shiftId_validFrom_idx" ON "BellSchedule"("academicYearId", "shiftId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BellSlot_bellScheduleId_lessonNumber_key" ON "BellSlot"("bellScheduleId", "lessonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Room_tenantId_name_key" ON "Room"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolWeek" ADD CONSTRAINT "SchoolWeek_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolWeek" ADD CONSTRAINT "SchoolWeek_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDayGrade" ADD CONSTRAINT "CalendarDayGrade_calendarDayId_fkey" FOREIGN KEY ("calendarDayId") REFERENCES "CalendarDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarDayGrade" ADD CONSTRAINT "CalendarDayGrade_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BellSchedule" ADD CONSTRAINT "BellSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BellSchedule" ADD CONSTRAINT "BellSchedule_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BellSchedule" ADD CONSTRAINT "BellSchedule_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BellSlot" ADD CONSTRAINT "BellSlot_bellScheduleId_fkey" FOREIGN KEY ("bellScheduleId") REFERENCES "BellSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_dates_check" CHECK ("startDate" <= "endDate");
-- Periods of the same type never overlap within a year (two quarters cannot share a day).
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_no_overlap"
  EXCLUDE USING gist (
    "academicYearId" WITH =,
    "type" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );

ALTER TABLE "SchoolWeek" ADD CONSTRAINT "SchoolWeek_weekdays_check"
  CHECK ("workingWeekdays" IS NOT NULL AND cardinality("workingWeekdays") BETWEEN 1 AND 7 AND "workingWeekdays" <@ ARRAY[1,2,3,4,5,6,7]);

-- followsWeekday only on WORKING_OVERRIDE days, and required there.
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_override_check" CHECK (
  ("kind" = 'WORKING_OVERRIDE' AND "followsWeekday" IS NOT NULL AND "followsWeekday" BETWEEN 1 AND 7)
  OR ("kind" <> 'WORKING_OVERRIDE' AND "followsWeekday" IS NULL)
);

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_minutes_check"
  CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440);

ALTER TABLE "BellSlot" ADD CONSTRAINT "BellSlot_minutes_check"
  CHECK ("lessonNumber" BETWEEN 0 AND 20 AND "startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440);
