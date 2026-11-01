-- M2 step 4: topics and versioned curriculum plans (docs/spec/lesson-plan.md §4).

-- CreateEnum
CREATE TYPE "CurriculumPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('NEW', 'PRACTICE', 'REVIEW', 'CONTROL_WORK', 'BSB', 'CHSB', 'LAB', 'OTHER');

-- CreateTable
CREATE TABLE "Topic" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "code" TEXT,
    "parentTopicId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumPlan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lineageId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "academicYearId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "authorId" UUID,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CurriculumPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "rejectionNote" TEXT,
    "sourceImportId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CurriculumPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "periodId" UUID,
    "topicId" UUID NOT NULL,
    "hours" INTEGER NOT NULL,
    "lessonType" "LessonType" NOT NULL DEFAULT 'NEW',
    "objectives" TEXT,
    "homework" TEXT,
    "resources" TEXT,
    "notes" TEXT,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_tenantId_subjectId_gradeId_normalizedTitle_key" ON "Topic"("tenantId", "subjectId", "gradeId", "normalizedTitle");

-- CreateIndex
CREATE INDEX "CurriculumPlan_tenantId_academicYearId_subjectId_gradeId_idx" ON "CurriculumPlan"("tenantId", "academicYearId", "subjectId", "gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumPlan_lineageId_version_key" ON "CurriculumPlan"("lineageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItem_planId_order_key" ON "PlanItem"("planId", "order");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_parentTopicId_fkey" FOREIGN KEY ("parentTopicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumPlan" ADD CONSTRAINT "CurriculumPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumPlan" ADD CONSTRAINT "CurriculumPlan_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumPlan" ADD CONSTRAINT "CurriculumPlan_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumPlan" ADD CONSTRAINT "CurriculumPlan_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumPlan" ADD CONSTRAINT "CurriculumPlan_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CurriculumPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

-- One version of a plan is being worked on at a time, and one is approved at a time.
CREATE UNIQUE INDEX "CurriculumPlan_one_open" ON "CurriculumPlan" ("lineageId")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'REJECTED');
CREATE UNIQUE INDEX "CurriculumPlan_one_approved" ON "CurriculumPlan" ("lineageId") WHERE "status" = 'APPROVED';

ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_hours_check" CHECK ("hours" BETWEEN 1 AND 100 AND "order" >= 1);

-- Items of a submitted, approved or archived version never change (lessons and scores refer to them).
CREATE FUNCTION idrok_plan_item_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  plan_status "CurriculumPlanStatus";
BEGIN
  SELECT "status" INTO plan_status FROM "CurriculumPlan"
    WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."planId" ELSE NEW."planId" END);
  IF plan_status IS DISTINCT FROM 'DRAFT' AND plan_status IS DISTINCT FROM 'REJECTED' THEN
    RAISE EXCEPTION 'PlanItem of a % plan is frozen: % is not allowed', plan_status, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PlanItem_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "PlanItem"
  FOR EACH ROW EXECUTE FUNCTION idrok_plan_item_frozen();
