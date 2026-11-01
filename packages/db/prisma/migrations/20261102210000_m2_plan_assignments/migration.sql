-- M2 step 5: plans applied to groups, planned topic of a lesson, curriculum plan imports (lesson-plan.md §4.3–4.4).

-- CreateEnum
CREATE TYPE "PlanAssignmentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REMOVED');

-- AlterEnum
ALTER TYPE "ImportKind" ADD VALUE 'CURRICULUM_PLAN';

-- AlterTable
ALTER TABLE "LessonSession" ADD COLUMN     "planItemId" UUID;

-- CreateTable
CREATE TABLE "PlanAssignment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "teachingGroupId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" "PlanAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedById" UUID NOT NULL,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PlanAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanAssignment_planId_idx" ON "PlanAssignment"("planId");

-- CreateIndex
CREATE INDEX "PlanAssignment_teachingGroupId_subjectId_idx" ON "PlanAssignment"("teachingGroupId", "subjectId");

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlanItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAssignment" ADD CONSTRAINT "PlanAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAssignment" ADD CONSTRAINT "PlanAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CurriculumPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAssignment" ADD CONSTRAINT "PlanAssignment_teachingGroupId_fkey" FOREIGN KEY ("teachingGroupId") REFERENCES "TeachingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

-- One plan is in force per group and subject.
CREATE UNIQUE INDEX "PlanAssignment_one_active" ON "PlanAssignment" ("teachingGroupId", "subjectId")
  WHERE "status" = 'ACTIVE';
