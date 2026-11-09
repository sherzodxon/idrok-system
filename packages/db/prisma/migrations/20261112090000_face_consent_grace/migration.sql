-- Q-54 (owner, 2026-11-11): faces stored before the consent rule (T-75) get 30 days; after that, student faces with
-- no consent in force are removed by the nightly maintenance. Existing schools get the deadline 30 school days from
-- today (Asia/Tashkent); a school created later has no deadline (every face already needs a consent).

-- AlterTable
ALTER TABLE "AttendanceSettings" ADD COLUMN "faceConsentGraceEndsOn" DATE;

UPDATE "AttendanceSettings"
SET "faceConsentGraceEndsOn" = (now() AT TIME ZONE 'Asia/Tashkent')::date + 30;
