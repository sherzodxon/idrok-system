-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "resultAssetId" UUID;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_resultAssetId_fkey" FOREIGN KEY ("resultAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

