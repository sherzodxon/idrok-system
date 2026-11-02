-- A correction first points the old row at itself and then at its successor (one current row per key). With a
-- unique "supersededById" the second correction collided with the first one's pointer; history links need no unique.

-- DropIndex
DROP INDEX "ManualAssessmentScore_supersededById_key";

-- DropIndex
DROP INDEX "OfflineResult_supersededById_key";

-- CreateIndex
CREATE INDEX "ManualAssessmentScore_supersededById_idx" ON "ManualAssessmentScore"("supersededById");

-- CreateIndex
CREATE INDEX "OfflineResult_supersededById_idx" ON "OfflineResult"("supersededById");
