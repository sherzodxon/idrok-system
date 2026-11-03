-- CreateEnum
CREATE TYPE "CoinCriterionType" AS ENUM ('REWARD', 'PENALTY', 'BOTH');

-- CreateEnum
CREATE TYPE "CoinEligibility" AS ENUM ('ALL_TEACHERS', 'SELECTED_TEACHERS');

-- CreateEnum
CREATE TYPE "CoinTxType" AS ENUM ('REWARD', 'PENALTY', 'PURCHASE', 'REFUND', 'ADMIN_ADJUSTMENT', 'REVERSAL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "CoinTxSource" AS ENUM ('TEACHER_CRITERION', 'ATTENDANCE', 'TEST_RESULT', 'ADMIN_ADJUST', 'SHOP_PURCHASE', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "CoinLimitScope" AS ENUM ('GLOBAL', 'CRITERION', 'TEACHER', 'TEACHER_CRITERION', 'EACH_CRITERION', 'EACH_TEACHER', 'EACH_TEACHER_CRITERION');

-- CreateEnum
CREATE TYPE "CoinLimitPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH', 'ROLLING');

-- CreateEnum
CREATE TYPE "CoinDirection" AS ENUM ('REWARD', 'PENALTY');

-- CreateEnum
CREATE TYPE "CoinOrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CoinAutoSource" AS ENUM ('TEST_RESULT', 'ATTENDANCE');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'PRODUCT_IMAGE';

-- CreateTable
CREATE TABLE "CoinSettings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "penaltiesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "teacherEvaluationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "adminAdjustmentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoCoinsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "shopEnabled" BOOLEAN NOT NULL DEFAULT true,
    "newOrdersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "orderApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
    "maxDebt" INTEGER,
    "activityWindowDays" INTEGER NOT NULL DEFAULT 7,
    "activityMinCoverage" INTEGER NOT NULL DEFAULT 30,
    "activityStaleDays" INTEGER NOT NULL DEFAULT 3,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCriterion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CoinCriterionType" NOT NULL,
    "minAmount" INTEGER NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "subjectId" UUID,
    "eligibility" "CoinEligibility" NOT NULL DEFAULT 'SELECTED_TEACHERS',
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinCriterionTeacher" (
    "tenantId" UUID NOT NULL,
    "criterionId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,

    CONSTRAINT "CoinCriterionTeacher_pkey" PRIMARY KEY ("criterionId","teacherId")
);

-- CreateTable
CREATE TABLE "CoinLimitRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "scope" "CoinLimitScope" NOT NULL,
    "criterionId" UUID,
    "teacherId" UUID,
    "type" "CoinDirection",
    "period" "CoinLimitPeriod" NOT NULL,
    "durationMinutes" INTEGER,
    "maxAmount" INTEGER,
    "maxCount" INTEGER,
    "countTypesSeparately" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinLimitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "type" "CoinTxType" NOT NULL,
    "source" "CoinTxSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "schoolDate" DATE NOT NULL,
    "academicYearId" UUID NOT NULL,
    "criterionId" UUID,
    "criterionNameSnapshot" TEXT,
    "teacherId" UUID,
    "actorUserId" UUID,
    "orderId" UUID,
    "reversesTransactionId" UUID,
    "correctsTransactionId" UUID,
    "sourceRef" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinProduct" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageAssetId" UUID,
    "price" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "priceAtOrder" INTEGER NOT NULL,
    "status" "CoinOrderStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "processedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinAutoRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "source" "CoinAutoSource" NOT NULL,
    "criterionId" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoinAutoRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoinSettings_tenantId_key" ON "CoinSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinCriterion_tenantId_name_key" ON "CoinCriterion"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CoinCriterionTeacher_teacherId_idx" ON "CoinCriterionTeacher"("teacherId");

-- CreateIndex
CREATE INDEX "CoinLimitRule_tenantId_isActive_idx" ON "CoinLimitRule"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CoinAccount_studentId_key" ON "CoinAccount"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_reversesTransactionId_key" ON "CoinTransaction"("reversesTransactionId");

-- CreateIndex
CREATE INDEX "CoinTransaction_tenantId_studentId_schoolDate_idx" ON "CoinTransaction"("tenantId", "studentId", "schoolDate");

-- CreateIndex
CREATE INDEX "CoinTransaction_tenantId_teacherId_schoolDate_idx" ON "CoinTransaction"("tenantId", "teacherId", "schoolDate");

-- CreateIndex
CREATE INDEX "CoinTransaction_tenantId_type_schoolDate_idx" ON "CoinTransaction"("tenantId", "type", "schoolDate");

-- CreateIndex
CREATE INDEX "CoinTransaction_criterionId_idx" ON "CoinTransaction"("criterionId");

-- CreateIndex
CREATE INDEX "CoinTransaction_correctsTransactionId_idx" ON "CoinTransaction"("correctsTransactionId");

-- CreateIndex
CREATE INDEX "CoinTransaction_orderId_idx" ON "CoinTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_tenantId_idempotencyKey_key" ON "CoinTransaction"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_tenantId_studentId_source_sourceRef_key" ON "CoinTransaction"("tenantId", "studentId", "source", "sourceRef");

-- CreateIndex
CREATE INDEX "CoinProduct_tenantId_archivedAt_idx" ON "CoinProduct"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "CoinOrder_tenantId_status_createdAt_idx" ON "CoinOrder"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CoinOrder_studentId_createdAt_idx" ON "CoinOrder"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoinOrder_tenantId_idempotencyKey_key" ON "CoinOrder"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CoinAutoRule_tenantId_source_isActive_idx" ON "CoinAutoRule"("tenantId", "source", "isActive");

-- AddForeignKey
ALTER TABLE "CoinSettings" ADD CONSTRAINT "CoinSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCriterion" ADD CONSTRAINT "CoinCriterion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCriterion" ADD CONSTRAINT "CoinCriterion_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCriterionTeacher" ADD CONSTRAINT "CoinCriterionTeacher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCriterionTeacher" ADD CONSTRAINT "CoinCriterionTeacher_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CoinCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinCriterionTeacher" ADD CONSTRAINT "CoinCriterionTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinLimitRule" ADD CONSTRAINT "CoinLimitRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinLimitRule" ADD CONSTRAINT "CoinLimitRule_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CoinCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinLimitRule" ADD CONSTRAINT "CoinLimitRule_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinAccount" ADD CONSTRAINT "CoinAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinAccount" ADD CONSTRAINT "CoinAccount_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CoinCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CoinOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_reversesTransactionId_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "CoinTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_correctsTransactionId_fkey" FOREIGN KEY ("correctsTransactionId") REFERENCES "CoinTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinProduct" ADD CONSTRAINT "CoinProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinProduct" ADD CONSTRAINT "CoinProduct_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinOrder" ADD CONSTRAINT "CoinOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinOrder" ADD CONSTRAINT "CoinOrder_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinOrder" ADD CONSTRAINT "CoinOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CoinProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinAutoRule" ADD CONSTRAINT "CoinAutoRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinAutoRule" ADD CONSTRAINT "CoinAutoRule_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "CoinCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- SQL-only invariants (packages/db/INVARIANTS.md)

ALTER TABLE "CoinSettings" ADD CONSTRAINT "CoinSettings_check" CHECK (
  ("maxDebt" IS NULL OR "maxDebt" >= 0)
  AND "activityWindowDays" BETWEEN 1 AND 90
  AND "activityMinCoverage" BETWEEN 0 AND 100
  AND "activityStaleDays" >= 0
);

ALTER TABLE "CoinCriterion" ADD CONSTRAINT "CoinCriterion_amount_check" CHECK (
  "minAmount" >= 1 AND "maxAmount" >= "minAmount"
);

-- A limit bounds something; ROLLING has a duration; the scope says which of teacher / criterion is set.
ALTER TABLE "CoinLimitRule" ADD CONSTRAINT "CoinLimitRule_check" CHECK (
  ("maxAmount" IS NOT NULL OR "maxCount" IS NOT NULL)
  AND ("maxAmount" IS NULL OR "maxAmount" >= 1)
  AND ("maxCount" IS NULL OR "maxCount" >= 1)
  AND (("period" = 'ROLLING') = ("durationMinutes" IS NOT NULL))
  AND ("durationMinutes" IS NULL OR "durationMinutes" >= 1)
  AND (("scope" IN ('CRITERION', 'TEACHER_CRITERION')) = ("criterionId" IS NOT NULL))
  AND (("scope" IN ('TEACHER', 'TEACHER_CRITERION')) = ("teacherId" IS NOT NULL))
);

-- The coin ledger is insert-only.
CREATE TRIGGER "CoinTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "CoinTransaction"
  FOR EACH ROW EXECUTE FUNCTION idrok_reject_modification();

-- Signs by type; a reversal points at what it undoes, a correction at what it lowers, nothing else points anywhere.
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_shape_check" CHECK (
  "amount" <> 0
  AND ("type" NOT IN ('REWARD', 'REFUND') OR "amount" > 0)
  AND ("type" NOT IN ('PENALTY', 'PURCHASE') OR "amount" < 0)
  AND (("type" = 'REVERSAL') = ("reversesTransactionId" IS NOT NULL))
  AND (("type" = 'CORRECTION') = ("correctsTransactionId" IS NOT NULL))
);

ALTER TABLE "CoinProduct" ADD CONSTRAINT "CoinProduct_check" CHECK ("price" >= 1 AND "stock" >= 0);

ALTER TABLE "CoinOrder" ADD CONSTRAINT "CoinOrder_price_check" CHECK ("priceAtOrder" >= 1);
