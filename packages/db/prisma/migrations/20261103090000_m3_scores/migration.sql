-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT_EXCUSED', 'ABSENT_UNEXCUSED');

-- CreateEnum
CREATE TYPE "ScoreEntryKind" AS ENUM ('NORMAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ScoreLimitWindow" AS ENUM ('LESSON', 'DAY', 'WEEK', 'MONTH', 'PERIOD');

-- CreateEnum
CREATE TYPE "ScoreLimitScope" AS ENUM ('GLOBAL', 'SUBJECT', 'GRADE', 'TEACHER', 'TEACHING_GROUP');

-- CreateTable
CREATE TABLE "ScoreCriterion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScoreCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonAttendance" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "markedById" UUID NOT NULL,
    "markedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LessonAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teachingGroupId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "topicId" UUID,
    "academicYearId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "schoolDate" DATE NOT NULL,
    "criterionId" UUID,
    "points" DECIMAL(8,2) NOT NULL,
    "note" TEXT,
    "kind" "ScoreEntryKind" NOT NULL DEFAULT 'NORMAL',
    "reversesEntryId" UUID,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreLimitRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "window" "ScoreLimitWindow" NOT NULL,
    "scopeType" "ScoreLimitScope" NOT NULL,
    "subjectId" UUID,
    "gradeId" UUID,
    "teacherId" UUID,
    "teachingGroupId" UUID,
    "maxPoints" DECIMAL(8,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScoreLimitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSettings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "hardCapPerLesson" DECIMAL(8,2) NOT NULL DEFAULT 10,
    "hardCapPerDay" DECIMAL(8,2) NOT NULL DEFAULT 70,
    "lessonMaxPoints" DECIMAL(8,2) NOT NULL DEFAULT 10,
    "allowScoreOnAbsent" BOOLEAN NOT NULL DEFAULT false,
    "lateEntryDays" INTEGER NOT NULL DEFAULT 3,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScoreSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoreCriterion_tenantId_name_key" ON "ScoreCriterion"("tenantId", "name");

-- CreateIndex
CREATE INDEX "LessonAttendance_tenantId_studentId_idx" ON "LessonAttendance"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonAttendance_lessonSessionId_studentId_key" ON "LessonAttendance"("lessonSessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEntry_reversesEntryId_key" ON "ScoreEntry"("reversesEntryId");

-- CreateIndex
CREATE INDEX "ScoreEntry_tenantId_studentId_schoolDate_idx" ON "ScoreEntry"("tenantId", "studentId", "schoolDate");

-- CreateIndex
CREATE INDEX "ScoreEntry_lessonSessionId_studentId_idx" ON "ScoreEntry"("lessonSessionId", "studentId");

-- CreateIndex
CREATE INDEX "ScoreEntry_periodId_subjectId_studentId_idx" ON "ScoreEntry"("periodId", "subjectId", "studentId");

-- CreateIndex
CREATE INDEX "ScoreEntry_teacherId_schoolDate_idx" ON "ScoreEntry"("teacherId", "schoolDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEntry_tenantId_idempotencyKey_key" ON "ScoreEntry"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ScoreLimitRule_tenantId_window_scopeType_isActive_idx" ON "ScoreLimitRule"("tenantId", "window", "scopeType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreSettings_tenantId_key" ON "ScoreSettings"("tenantId");

-- AddForeignKey
ALTER TABLE "ScoreCriterion" ADD CONSTRAINT "ScoreCriterion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttendance" ADD CONSTRAINT "LessonAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "ScoreCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "ScoreEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSettings" ADD CONSTRAINT "ScoreSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

-- NORMAL entries add points, a REVERSAL takes back one NORMAL entry.
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_kind_check" CHECK (
  ("kind" = 'NORMAL' AND "points" > 0 AND "reversesEntryId" IS NULL)
  OR ("kind" = 'REVERSAL' AND "points" < 0 AND "reversesEntryId" IS NOT NULL)
);

-- The score ledger is insert-only.
CREATE TRIGGER "ScoreEntry_append_only"
  BEFORE UPDATE OR DELETE ON "ScoreEntry"
  FOR EACH ROW EXECUTE FUNCTION idrok_reject_modification();

-- A reversal is exactly the negative of a NORMAL entry of the same student and lesson.
CREATE FUNCTION idrok_score_reversal_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original "ScoreEntry"%ROWTYPE;
BEGIN
  IF NEW."kind" = 'REVERSAL' THEN
    SELECT * INTO original FROM "ScoreEntry" WHERE "id" = NEW."reversesEntryId";
    IF original."kind" IS DISTINCT FROM 'NORMAL'
      OR original."points" <> -NEW."points"
      OR original."studentId" <> NEW."studentId"
      OR original."lessonSessionId" <> NEW."lessonSessionId"
      OR original."tenantId" <> NEW."tenantId" THEN
      RAISE EXCEPTION 'ScoreEntry reversal does not match the entry it reverses'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ScoreEntry_reversal_matches"
  BEFORE INSERT ON "ScoreEntry"
  FOR EACH ROW EXECUTE FUNCTION idrok_score_reversal_matches();

-- Exactly the column of the scope type may be set (none for GLOBAL or for the default rule of a type).
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_scope_check" CHECK (
  "maxPoints" > 0
  AND ("subjectId" IS NULL OR "scopeType" = 'SUBJECT')
  AND ("gradeId" IS NULL OR "scopeType" = 'GRADE')
  AND ("teacherId" IS NULL OR "scopeType" = 'TEACHER')
  AND ("teachingGroupId" IS NULL OR "scopeType" = 'TEACHING_GROUP')
);

-- One active rule per window, scope type and scope (or default).
CREATE UNIQUE INDEX "ScoreLimitRule_one_active" ON "ScoreLimitRule" (
  "tenantId", "window", "scopeType",
  COALESCE("subjectId", "gradeId", "teacherId", "teachingGroupId", '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "isActive";

ALTER TABLE "ScoreSettings" ADD CONSTRAINT "ScoreSettings_values_check" CHECK (
  "hardCapPerLesson" > 0 AND "hardCapPerDay" > 0 AND "lessonMaxPoints" > 0
  AND "lessonMaxPoints" <= "hardCapPerLesson" AND "lateEntryDays" BETWEEN 0 AND 365
);
