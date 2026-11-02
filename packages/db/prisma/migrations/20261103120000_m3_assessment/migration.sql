-- CreateEnum
CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PeriodResultStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "PeriodCloseRunStatus" AS ENUM ('PREPARED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AssessmentPolicy" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentPolicyVersion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyBinding" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "subjectId" UUID,
    "policyVersionId" UUID NOT NULL,
    "boundAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundById" UUID,
    "supersededAt" TIMESTAMPTZ(3),
    "reason" TEXT,

    CONSTRAINT "PolicyBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeScale" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GradeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeScaleBand" (
    "id" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "minPercent" DECIMAL(5,2) NOT NULL,
    "maxPercent" DECIMAL(5,2) NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "GradeScaleBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualAssessmentScore" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "componentKey" TEXT NOT NULL,
    "points" DECIMAL(8,2) NOT NULL,
    "maxPoints" DECIMAL(8,2) NOT NULL,
    "note" TEXT,
    "enteredById" UUID NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededById" UUID,

    CONSTRAINT "ManualAssessmentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodResult" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "subjectId" UUID,
    "periodId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "status" "PeriodResultStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "isComplete" BOOLEAN NOT NULL DEFAULT true,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "components" JSONB NOT NULL,
    "totalPoints" DECIMAL(10,4),
    "maxPoints" DECIMAL(8,2) NOT NULL,
    "percent" DECIMAL(9,6),
    "displayPercent" DECIMAL(5,2),
    "gradeLabel" TEXT,
    "inputsHash" TEXT NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,
    "finalizedById" UUID,
    "finalizedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PeriodResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodCloseRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "status" "PeriodCloseRunStatus" NOT NULL DEFAULT 'PREPARED',
    "report" JSONB NOT NULL,
    "preparedById" UUID NOT NULL,
    "preparedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PeriodCloseRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentPolicy_tenantId_name_key" ON "AssessmentPolicy"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentPolicyVersion_policyId_version_key" ON "AssessmentPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE INDEX "PolicyBinding_periodId_idx" ON "PolicyBinding"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScale_tenantId_name_key" ON "GradeScale"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScaleBand_scaleId_order_key" ON "GradeScaleBand"("scaleId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ManualAssessmentScore_supersededById_key" ON "ManualAssessmentScore"("supersededById");

-- CreateIndex
CREATE INDEX "ManualAssessmentScore_periodId_subjectId_idx" ON "ManualAssessmentScore"("periodId", "subjectId");

-- CreateIndex
CREATE INDEX "PeriodResult_tenantId_periodId_subjectId_idx" ON "PeriodResult"("tenantId", "periodId", "subjectId");

-- CreateIndex
CREATE INDEX "PeriodResult_studentId_periodId_idx" ON "PeriodResult"("studentId", "periodId");

-- CreateIndex
CREATE INDEX "PeriodCloseRun_periodId_idx" ON "PeriodCloseRun"("periodId");

-- AddForeignKey
ALTER TABLE "AssessmentPolicy" ADD CONSTRAINT "AssessmentPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPolicyVersion" ADD CONSTRAINT "AssessmentPolicyVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPolicyVersion" ADD CONSTRAINT "AssessmentPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AssessmentPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBinding" ADD CONSTRAINT "PolicyBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBinding" ADD CONSTRAINT "PolicyBinding_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBinding" ADD CONSTRAINT "PolicyBinding_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyBinding" ADD CONSTRAINT "PolicyBinding_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "AssessmentPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeScale" ADD CONSTRAINT "GradeScale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeScaleBand" ADD CONSTRAINT "GradeScaleBand_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "GradeScale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAssessmentScore" ADD CONSTRAINT "ManualAssessmentScore_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAssessmentScore" ADD CONSTRAINT "ManualAssessmentScore_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAssessmentScore" ADD CONSTRAINT "ManualAssessmentScore_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAssessmentScore" ADD CONSTRAINT "ManualAssessmentScore_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualAssessmentScore" ADD CONSTRAINT "ManualAssessmentScore_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "ManualAssessmentScore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodResult" ADD CONSTRAINT "PeriodResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodResult" ADD CONSTRAINT "PeriodResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodResult" ADD CONSTRAINT "PeriodResult_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodResult" ADD CONSTRAINT "PeriodResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodResult" ADD CONSTRAINT "PeriodResult_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "AssessmentPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodCloseRun" ADD CONSTRAINT "PeriodCloseRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodCloseRun" ADD CONSTRAINT "PeriodCloseRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

CREATE UNIQUE INDEX "AssessmentPolicy_one_default" ON "AssessmentPolicy" ("tenantId") WHERE "isDefault";

CREATE UNIQUE INDEX "AssessmentPolicyVersion_one_draft" ON "AssessmentPolicyVersion" ("policyId") WHERE "status" = 'DRAFT';

-- A published version never changes; its only move is PUBLISHED → RETIRED.
CREATE FUNCTION idrok_policy_version_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'AssessmentPolicyVersion % is published', OLD."id" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."config" IS DISTINCT FROM OLD."config" OR NEW."configHash" IS DISTINCT FROM OLD."configHash"
    OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."policyId" IS DISTINCT FROM OLD."policyId"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NOT (NEW."status" = OLD."status" OR (OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED'))
  ) THEN
    RAISE EXCEPTION 'AssessmentPolicyVersion % is published', OLD."id" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AssessmentPolicyVersion_frozen"
  BEFORE UPDATE OR DELETE ON "AssessmentPolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION idrok_policy_version_frozen();

-- One current binding per period and subject (or for all subjects).
CREATE UNIQUE INDEX "PolicyBinding_one_current" ON "PolicyBinding" (
  "periodId", COALESCE("subjectId", '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "supersededAt" IS NULL;

ALTER TABLE "GradeScaleBand" ADD CONSTRAINT "GradeScaleBand_range_check" CHECK (
  "minPercent" >= 0 AND "maxPercent" <= 100 AND "minPercent" < "maxPercent"
);

ALTER TABLE "ManualAssessmentScore" ADD CONSTRAINT "ManualAssessmentScore_points_check" CHECK (
  "maxPoints" > 0 AND "points" >= 0 AND "points" <= "maxPoints"
);

CREATE UNIQUE INDEX "ManualAssessmentScore_one_current" ON "ManualAssessmentScore" (
  "periodId", "subjectId", "studentId", "componentKey"
) WHERE "supersededById" IS NULL;

CREATE UNIQUE INDEX "PeriodResult_one_current" ON "PeriodResult" (
  "studentId", "periodId", COALESCE("subjectId", '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "isCurrent";

-- A FINAL result never changes: only "isStale" (inputs moved since) and "isCurrent" (a newer version) may.
CREATE FUNCTION idrok_period_result_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'FINAL' THEN
      RAISE EXCEPTION 'PeriodResult % is final', OLD."id" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'FINAL' AND (
    to_jsonb(NEW) - 'isStale' - 'isCurrent' IS DISTINCT FROM to_jsonb(OLD) - 'isStale' - 'isCurrent'
    OR (OLD."isCurrent" = false AND NEW."isCurrent" = true)
  ) THEN
    RAISE EXCEPTION 'PeriodResult % is final', OLD."id" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PeriodResult_final_frozen"
  BEFORE UPDATE OR DELETE ON "PeriodResult"
  FOR EACH ROW EXECUTE FUNCTION idrok_period_result_frozen();
