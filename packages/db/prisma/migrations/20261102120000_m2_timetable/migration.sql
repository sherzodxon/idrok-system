-- M2 step 2: versioned weekly timetable (docs/spec/lesson-plan.md §2).

-- CreateEnum
CREATE TYPE "TimetableStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WeekType" AS ENUM ('ALL', 'ODD', 'EVEN');

-- CreateTable
CREATE TABLE "Timetable" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TimetableStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" DATE,
    "validTo" DATE,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "publishedById" UUID,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Timetable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "timetableId" UUID NOT NULL,
    "teachingGroupId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "roomId" UUID,
    "weekday" INTEGER NOT NULL,
    "lessonNumber" INTEGER NOT NULL,
    "weekType" "WeekType" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "TimetableEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Timetable_tenantId_academicYearId_idx" ON "Timetable"("tenantId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "Timetable_academicYearId_version_key" ON "Timetable"("academicYearId", "version");

-- CreateIndex
CREATE INDEX "TimetableEntry_timetableId_teachingGroupId_idx" ON "TimetableEntry"("timetableId", "teachingGroupId");

-- CreateIndex
CREATE INDEX "TimetableEntry_timetableId_teacherId_weekday_lessonNumber_idx" ON "TimetableEntry"("timetableId", "teacherId", "weekday", "lessonNumber");

-- AddForeignKey
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "Timetable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

-- A published (or archived) version has its start date and publication time.
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_published_check" CHECK (
  ("status" = 'DRAFT' OR ("validFrom" IS NOT NULL AND "publishedAt" IS NOT NULL))
  AND ("validTo" IS NULL OR ("validFrom" IS NOT NULL AND "validFrom" <= "validTo"))
);

-- At most one published version applies on any date of a year (validTo inclusive, NULL = open).
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_no_overlap"
  EXCLUDE USING gist (
    "academicYearId" WITH =,
    daterange("validFrom", "validTo", '[]') WITH &&
  ) WHERE ("status" = 'PUBLISHED');

ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_slot_check"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "lessonNumber" BETWEEN 0 AND 20);

-- Entries of a published or archived version never change: lessons were generated from them.
CREATE FUNCTION idrok_timetable_entry_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "TimetableStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "Timetable"
    WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."timetableId" ELSE NEW."timetableId" END);
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'TimetableEntry of a % timetable is frozen: % is not allowed', parent_status, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "TimetableEntry_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "TimetableEntry"
  FOR EACH ROW EXECUTE FUNCTION idrok_timetable_entry_frozen();
