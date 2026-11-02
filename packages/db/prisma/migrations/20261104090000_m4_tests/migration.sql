-- AlterEnum
ALTER TYPE "ImportKind" ADD VALUE 'QUESTIONS';

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'QUESTION_IMAGE';

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE', 'MULTIPLE', 'SHORT_TEXT', 'MATCHING');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestFormat" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "TestPurpose" AS ENUM ('PRACTICE', 'WEIGHTED');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TestResultVisibility" AS ENUM ('IMMEDIATE', 'AFTER_CLOSE', 'NEVER');

-- CreateEnum
CREATE TYPE "MultipleScoring" AS ENUM ('ALL_OR_NOTHING', 'PARTIAL');

-- CreateEnum
CREATE TYPE "TestRetakePolicy" AS ENUM ('LAST', 'BEST');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- CreateEnum
CREATE TYPE "AttemptFinishReason" AS ENUM ('SUBMITTED', 'TIME_UP', 'VIOLATION', 'ADMIN_CLOSED');

-- CreateEnum
CREATE TYPE "TestEventType" AS ENUM ('VISIBILITY_HIDDEN', 'VISIBILITY_VISIBLE', 'BLUR', 'FOCUS', 'RECONNECT');

-- CreateEnum
CREATE TYPE "OfflineResultStatus" AS ENUM ('SCORED', 'ABSENT', 'EXCUSED');

-- CreateTable
CREATE TABLE "TestType" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "topicId" UUID,
    "type" "QuestionType" NOT NULL,
    "difficulty" "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "status" "QuestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" UUID,
    "sharedWithSubject" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "imageAssetId" UUID,
    "points" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "options" JSONB NOT NULL DEFAULT '[]',
    "acceptedAnswers" JSONB,
    "pairs" JSONB,
    "explanation" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subjectId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "testTypeId" UUID NOT NULL,
    "format" "TestFormat" NOT NULL,
    "purpose" "TestPurpose" NOT NULL,
    "status" "TestStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "schoolDate" DATE,
    "timeLimitMinutes" INTEGER,
    "questionCount" INTEGER,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT true,
    "selection" JSONB NOT NULL DEFAULT '{"mode":"MANUAL"}',
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "multipleScoring" "MultipleScoring" NOT NULL DEFAULT 'ALL_OR_NOTHING',
    "periodId" UUID,
    "weight" DECIMAL(6,2),
    "includedInAssessment" BOOLEAN NOT NULL DEFAULT true,
    "retakePolicy" "TestRetakePolicy" NOT NULL DEFAULT 'LAST',
    "violationThreshold" INTEGER NOT NULL DEFAULT 3,
    "showResultToStudent" "TestResultVisibility" NOT NULL DEFAULT 'AFTER_CLOSE',
    "planItemId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestQuestion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,

    CONSTRAINT "TestQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAssignment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "teachingGroupId" UUID,
    "studentId" UUID,

    CONSTRAINT "TestAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestWindowOverride" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "timeLimitMinutes" INTEGER,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestWindowOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "finishReason" "AttemptFinishReason",
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "questionOrder" JSONB NOT NULL,
    "optionOrder" JSONB NOT NULL,
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "score" DECIMAL(8,2),
    "maxScore" DECIMAL(8,2) NOT NULL,
    "percent" DECIMAL(7,4),
    "gradedAt" TIMESTAMPTZ(3),
    "schoolDate" DATE NOT NULL,

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAnswer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "testQuestionId" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientSeq" INTEGER NOT NULL,
    "isCorrect" BOOLEAN,
    "pointsAwarded" DECIMAL(6,2),

    CONSTRAINT "TestAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "type" "TestEventType" NOT NULL,
    "clientTs" TIMESTAMPTZ(3),
    "serverTs" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientSeq" INTEGER,
    "counted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineResult" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "rawScore" DECIMAL(8,2),
    "status" "OfflineResultStatus" NOT NULL,
    "note" TEXT,
    "enteredById" UUID NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededById" UUID,

    CONSTRAINT "OfflineResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestType_tenantId_code_key" ON "TestType"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Question_currentVersionId_key" ON "Question"("currentVersionId");

-- CreateIndex
CREATE INDEX "Question_tenantId_subjectId_gradeId_status_idx" ON "Question"("tenantId", "subjectId", "gradeId", "status");

-- CreateIndex
CREATE INDEX "Question_ownerId_idx" ON "Question"("ownerId");

-- CreateIndex
CREATE INDEX "QuestionVersion_tenantId_contentHash_idx" ON "QuestionVersion"("tenantId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "Test_tenantId_subjectId_gradeId_status_idx" ON "Test"("tenantId", "subjectId", "gradeId", "status");

-- CreateIndex
CREATE INDEX "Test_teacherId_idx" ON "Test"("teacherId");

-- CreateIndex
CREATE INDEX "Test_periodId_idx" ON "Test"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_testId_order_key" ON "TestQuestion"("testId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TestQuestion_testId_questionVersionId_key" ON "TestQuestion"("testId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAssignment_testId_teachingGroupId_key" ON "TestAssignment"("testId", "teachingGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAssignment_testId_studentId_key" ON "TestAssignment"("testId", "studentId");

-- CreateIndex
CREATE INDEX "TestWindowOverride_testId_studentId_idx" ON "TestWindowOverride"("testId", "studentId");

-- CreateIndex
CREATE INDEX "TestAttempt_studentId_status_idx" ON "TestAttempt"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestAttempt_testId_studentId_attemptNo_key" ON "TestAttempt"("testId", "studentId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "TestAnswer_attemptId_testQuestionId_key" ON "TestAnswer"("attemptId", "testQuestionId");

-- CreateIndex
CREATE INDEX "TestEvent_attemptId_serverTs_idx" ON "TestEvent"("attemptId", "serverTs");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineResult_supersededById_key" ON "OfflineResult"("supersededById");

-- CreateIndex
CREATE INDEX "OfflineResult_testId_studentId_idx" ON "OfflineResult"("testId", "studentId");

-- AddForeignKey
ALTER TABLE "TestType" ADD CONSTRAINT "TestType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "TestType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestWindowOverride" ADD CONSTRAINT "TestWindowOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestWindowOverride" ADD CONSTRAINT "TestWindowOverride_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestWindowOverride" ADD CONSTRAINT "TestWindowOverride_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAnswer" ADD CONSTRAINT "TestAnswer_testQuestionId_fkey" FOREIGN KEY ("testQuestionId") REFERENCES "TestQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestEvent" ADD CONSTRAINT "TestEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestEvent" ADD CONSTRAINT "TestEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "TestAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineResult" ADD CONSTRAINT "OfflineResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineResult" ADD CONSTRAINT "OfflineResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineResult" ADD CONSTRAINT "OfflineResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineResult" ADD CONSTRAINT "OfflineResult_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "OfflineResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

-- A question version is never edited or deleted: an edit is a new version, so tests keep what they used.
CREATE TRIGGER "QuestionVersion_append_only"
  BEFORE UPDATE OR DELETE ON "QuestionVersion"
  FOR EACH ROW EXECUTE FUNCTION idrok_reject_modification();

ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_points_check" CHECK ("points" > 0);

ALTER TABLE "Test" ADD CONSTRAINT "Test_window_check" CHECK (
  ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt")
  AND ("timeLimitMinutes" IS NULL OR "timeLimitMinutes" > 0)
  AND ("questionCount" IS NULL OR "questionCount" > 0)
);

-- A weighted test counts towards a period with a positive relative weight.
ALTER TABLE "Test" ADD CONSTRAINT "Test_weighted_check" CHECK (
  "purpose" <> 'WEIGHTED' OR ("periodId" IS NOT NULL AND "weight" IS NOT NULL AND "weight" > 0)
);

-- Offline scales (Q-45).
ALTER TABLE "Test" ADD CONSTRAINT "Test_offline_scale_check" CHECK (
  "format" <> 'OFFLINE' OR "maxScore" IN (5, 10, 20, 25, 40, 50, 100)
);

ALTER TABLE "Test" ADD CONSTRAINT "Test_threshold_check" CHECK ("violationThreshold" >= 0 AND "maxScore" >= 0);

ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_points_check" CHECK ("points" > 0 AND "order" >= 0);

-- A test is given to a teaching group or to one student, never both.
ALTER TABLE "TestAssignment" ADD CONSTRAINT "TestAssignment_target_check" CHECK (
  num_nonnulls("teachingGroupId", "studentId") = 1
);

ALTER TABLE "TestWindowOverride" ADD CONSTRAINT "TestWindowOverride_window_check" CHECK (
  "startsAt" < "endsAt" AND ("timeLimitMinutes" IS NULL OR "timeLimitMinutes" > 0)
);

-- At most one running attempt per student and test (starting is idempotent).
CREATE UNIQUE INDEX "TestAttempt_one_in_progress" ON "TestAttempt" ("testId", "studentId")
  WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_finish_check" CHECK (
  ("status" = 'FINISHED') = ("finishReason" IS NOT NULL AND "finishedAt" IS NOT NULL)
  AND "attemptNo" >= 1 AND "violationCount" >= 0 AND "maxScore" >= 0
);

ALTER TABLE "OfflineResult" ADD CONSTRAINT "OfflineResult_score_check" CHECK (
  ("status" = 'SCORED') = ("rawScore" IS NOT NULL) AND ("rawScore" IS NULL OR "rawScore" >= 0)
);

CREATE UNIQUE INDEX "OfflineResult_one_current" ON "OfflineResult" ("testId", "studentId")
  WHERE "supersededById" IS NULL;

-- Offline results keep their history: no delete; an update may only link a row to its successor.
CREATE FUNCTION idrok_offline_result_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OfflineResult rows are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."supersededById" IS NOT NULL AND OLD."supersededById" <> OLD."id"
    OR NEW."testId" <> OLD."testId" OR NEW."studentId" <> OLD."studentId"
    OR NEW."rawScore" IS DISTINCT FROM OLD."rawScore" OR NEW."status" <> OLD."status"
    OR NEW."note" IS DISTINCT FROM OLD."note" OR NEW."enteredById" <> OLD."enteredById"
    OR NEW."enteredAt" <> OLD."enteredAt" OR NEW."tenantId" <> OLD."tenantId" THEN
    RAISE EXCEPTION 'OfflineResult may only be linked to its successor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OfflineResult_history"
  BEFORE UPDATE OR DELETE ON "OfflineResult"
  FOR EACH ROW EXECUTE FUNCTION idrok_offline_result_history();
