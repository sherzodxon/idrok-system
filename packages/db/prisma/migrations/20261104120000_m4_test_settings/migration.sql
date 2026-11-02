-- AlterTable
ALTER TABLE "SchoolSettings" ADD COLUMN     "maxQuestionsPerTest" INTEGER NOT NULL DEFAULT 50;

-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

ALTER TABLE "SchoolSettings" ADD CONSTRAINT "SchoolSettings_max_questions_check" CHECK (
  "maxQuestionsPerTest" BETWEEN 1 AND 200
);
