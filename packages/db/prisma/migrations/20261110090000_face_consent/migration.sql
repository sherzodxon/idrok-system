-- Audit decision T-75: a student's face photo is kept only with a recorded guardian consent. Additive only.

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN "faceConsentRequired" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "FaceConsent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID,
    "givenBy" TEXT NOT NULL,
    "givenOn" DATE NOT NULL,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revokeReason" TEXT,

    CONSTRAINT "FaceConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceConsent_tenantId_studentId_idx" ON "FaceConsent"("tenantId", "studentId");

-- AddForeignKey
ALTER TABLE "FaceConsent" ADD CONSTRAINT "FaceConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaceConsent" ADD CONSTRAINT "FaceConsent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaceConsent" ADD CONSTRAINT "FaceConsent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One consent in force per student; a revoked one stays as history and must say why.
CREATE UNIQUE INDEX "FaceConsent_one_active" ON "FaceConsent" ("tenantId", "studentId") WHERE "revokedAt" IS NULL;
ALTER TABLE "FaceConsent" ADD CONSTRAINT "FaceConsent_revoke_check" CHECK (
  "revokedAt" IS NULL OR ("revokedById" IS NOT NULL AND "revokeReason" IS NOT NULL)
);

