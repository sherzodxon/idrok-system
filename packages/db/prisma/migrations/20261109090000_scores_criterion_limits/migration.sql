-- Audit decision T-77: score limits per criterion and bounds of one entry per criterion. Additive only: new columns
-- are nullable, existing rules and criteria keep working as before.

-- AlterEnum
ALTER TYPE "ScoreLimitScope" ADD VALUE 'CRITERION';

-- AlterTable
ALTER TABLE "ScoreCriterion" ADD COLUMN "minPoints" DECIMAL(8,2),
ADD COLUMN "maxPoints" DECIMAL(8,2);

ALTER TABLE "ScoreLimitRule" ADD COLUMN "criterionId" UUID;

-- AddForeignKey
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "ScoreCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bounds are positive and ordered (scores are positive, scoring.md §3).
ALTER TABLE "ScoreCriterion" ADD CONSTRAINT "ScoreCriterion_points_check" CHECK (
  ("minPoints" IS NULL OR "minPoints" > 0)
  AND ("maxPoints" IS NULL OR "maxPoints" > 0)
  AND ("minPoints" IS NULL OR "maxPoints" IS NULL OR "minPoints" <= "maxPoints")
);

-- The scope check and the one-active index learn the criterion column. The new enum value is compared as text: a
-- value added by ALTER TYPE cannot be used as an enum literal in the same transaction.
ALTER TABLE "ScoreLimitRule" DROP CONSTRAINT "ScoreLimitRule_scope_check";
ALTER TABLE "ScoreLimitRule" ADD CONSTRAINT "ScoreLimitRule_scope_check" CHECK (
  "maxPoints" > 0
  AND ("subjectId" IS NULL OR "scopeType" = 'SUBJECT')
  AND ("gradeId" IS NULL OR "scopeType" = 'GRADE')
  AND ("teacherId" IS NULL OR "scopeType" = 'TEACHER')
  AND ("teachingGroupId" IS NULL OR "scopeType" = 'TEACHING_GROUP')
  AND ("criterionId" IS NULL OR "scopeType"::text = 'CRITERION')
);

DROP INDEX "ScoreLimitRule_one_active";
CREATE UNIQUE INDEX "ScoreLimitRule_one_active" ON "ScoreLimitRule" (
  "tenantId", "window", "scopeType",
  COALESCE("subjectId", "gradeId", "teacherId", "teachingGroupId", "criterionId", '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE "isActive";

CREATE INDEX "ScoreLimitRule_criterionId_idx" ON "ScoreLimitRule"("criterionId");
