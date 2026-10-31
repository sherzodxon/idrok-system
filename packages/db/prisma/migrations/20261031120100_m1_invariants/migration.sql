-- M1 invariants Prisma cannot express (partial unique indexes, CHECK, EXCLUDE, append-only trigger).
-- Listed in packages/db/INVARIANTS.md and verified by test/invariants.test.ts.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- One ACTIVE academic year per tenant.
CREATE UNIQUE INDEX "AcademicYear_one_active" ON "AcademicYear" ("tenantId") WHERE "status" = 'ACTIVE';
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_dates_check" CHECK ("startDate" <= "endDate");

-- Grade levels: 0 (preparatory) .. 11.
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_level_check" CHECK ("level" BETWEEN 0 AND 11);

-- A role is assigned to a user at most once at a time (revoked rows are history).
CREATE UNIQUE INDEX "UserRole_active_unique" ON "UserRole" ("userId", "roleId") WHERE "revokedAt" IS NULL;

-- Every class has exactly one whole-class teaching group; class and subgroup kinds belong to a class.
CREATE UNIQUE INDEX "TeachingGroup_one_class_group" ON "TeachingGroup" ("classGroupId") WHERE "kind" = 'CLASS';
ALTER TABLE "TeachingGroup" ADD CONSTRAINT "TeachingGroup_class_check"
  CHECK ("kind" = 'CROSS_CLASS' OR "classGroupId" IS NOT NULL);

-- Group membership periods of one student in one group never overlap (validTo inclusive, NULL = open).
ALTER TABLE "TeachingGroupMember" ADD CONSTRAINT "TeachingGroupMember_dates_check"
  CHECK ("validTo" IS NULL OR "validFrom" <= "validTo");
ALTER TABLE "TeachingGroupMember" ADD CONSTRAINT "TeachingGroupMember_no_overlap"
  EXCLUDE USING gist (
    "teachingGroupId" WITH =,
    "studentId" WITH =,
    daterange("validFrom", "validTo", '[]') WITH &&
  );

-- One ACTIVE enrollment per student per academic year; history rows are unlimited.
CREATE UNIQUE INDEX "StudentEnrollment_one_active" ON "StudentEnrollment" ("studentId", "academicYearId")
  WHERE "status" = 'ACTIVE';
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_dates_check"
  CHECK ("validTo" IS NULL OR "validFrom" <= "validTo");

ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_dates_check"
  CHECK ("validTo" IS NULL OR "validFrom" <= "validTo");

-- Branding colours are #RRGGBB (they are injected into CSS variables).
ALTER TABLE "SchoolBranding" ADD CONSTRAINT "SchoolBranding_color_check" CHECK (
  "primaryColor" ~ '^#[0-9A-Fa-f]{6}$'
  AND "primaryHoverColor" ~ '^#[0-9A-Fa-f]{6}$'
  AND "primaryStrongColor" ~ '^#[0-9A-Fa-f]{6}$'
  AND "primarySoftColor" ~ '^#[0-9A-Fa-f]{6}$'
  AND ("secondaryColor" IS NULL OR "secondaryColor" ~ '^#[0-9A-Fa-f]{6}$')
);

-- Audit log is append-only.
CREATE FUNCTION idrok_reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION idrok_reject_modification();
