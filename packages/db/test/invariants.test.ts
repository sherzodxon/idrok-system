// The SQL-only invariants (INVARIANTS.md) must exist after migrations — a later migration must not drop them.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrl } from "./helpers";

const INDEXES = [
  "AcademicYear_one_active",
  "UserRole_active_unique",
  "TeachingGroup_one_class_group",
  "StudentEnrollment_one_active",
  "CurriculumPlan_one_open",
  "CurriculumPlan_one_approved",
  "PlanAssignment_one_active",
  "ScoreLimitRule_one_active",
  "AssessmentPolicy_one_default",
  "AssessmentPolicyVersion_one_draft",
  "PolicyBinding_one_current",
  "ManualAssessmentScore_one_current",
  "PeriodResult_one_current",
  "TestAttempt_one_in_progress",
  "OfflineResult_one_current",
  "FaceConsent_one_active",
];
const CONSTRAINTS = [
  "AcademicYear_dates_check",
  "Grade_level_check",
  "TeachingGroup_class_check",
  "TeachingGroupMember_dates_check",
  "TeachingGroupMember_no_overlap",
  "StudentEnrollment_dates_check",
  "TeacherAssignment_dates_check",
  "SchoolBranding_color_check",
  "AcademicPeriod_dates_check",
  "AcademicPeriod_no_overlap",
  "SchoolWeek_weekdays_check",
  "CalendarDay_override_check",
  "Shift_minutes_check",
  "BellSlot_minutes_check",
  "Timetable_published_check",
  "Timetable_no_overlap",
  "TimetableEntry_slot_check",
  "LessonSession_times_check",
  "PlanItem_hours_check",
  "ScoreEntry_kind_check",
  "ScoreLimitRule_scope_check",
  "ScoreCriterion_points_check",
  "FaceConsent_revoke_check",
  "FaceProfile_subject_check",
  "FaceSyncJob_subject_check",
  "AccessEvent_subject_check",
  "AttendanceSettings_staff_check",
  "ScoreSettings_values_check",
  "GradeScaleBand_range_check",
  "ManualAssessmentScore_points_check",
  "QuestionVersion_points_check",
  "Test_window_check",
  "Test_weighted_check",
  "Test_offline_scale_check",
  "Test_threshold_check",
  "TestQuestion_points_check",
  "TestAssignment_target_check",
  "TestWindowOverride_window_check",
  "TestAttempt_finish_check",
  "OfflineResult_score_check",
  "SchoolSettings_max_questions_check",
  "CoinSettings_check",
  "CoinCriterion_amount_check",
  "CoinLimitRule_check",
  "CoinTransaction_shape_check",
  "CoinProduct_check",
  "CoinOrder_price_check",
  "AttendanceSettings_check",
  "LatenessBand_check",
  "Device_port_check",
  "AttendanceRecord_check",
];
const TRIGGERS = [
  "AuditLog_append_only",
  "TimetableEntry_frozen",
  "LessonSession_no_delete",
  "PlanItem_frozen",
  "ScoreEntry_append_only",
  "ScoreEntry_reversal_matches",
  "AssessmentPolicyVersion_frozen",
  "PeriodResult_final_frozen",
  "QuestionVersion_append_only",
  "OfflineResult_history",
  "CoinTransaction_append_only",
  "AccessEvent_append_only",
];

let client: pg.Client;
beforeAll(async () => {
  client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
});
afterAll(() => client.end());

describe("SQL invariants", () => {
  it("partial unique indexes exist and are partial", async () => {
    const { rows } = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [INDEXES],
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual([...INDEXES].sort());
    for (const r of rows) expect(r.indexdef).toMatch(/UNIQUE INDEX .* WHERE /);
  });

  it("check and exclusion constraints exist", async () => {
    const { rows } = await client.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname = ANY($1)",
      [CONSTRAINTS],
    );
    expect(rows.map((r) => r.conname).sort()).toEqual([...CONSTRAINTS].sort());
  });

  it("append-only triggers exist", async () => {
    const { rows } = await client.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1)",
      [TRIGGERS],
    );
    expect(rows.map((r) => r.tgname).sort()).toEqual([...TRIGGERS].sort());
  });

  it("the schema has no drift against the migrations", async () => {
    // A column added to schema.prisma without a migration would show up as a non-empty diff.
    const { execFileSync } = await import("node:child_process");
    const { createRequire } = await import("node:module");
    const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const out = execFileSync(
      process.execPath,
      [cli, "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"],
      {
        cwd: new URL("..", import.meta.url).pathname,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, DIRECT_URL: databaseUrl() },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).toString();
    expect(out).toMatch(/No difference|empty migration/i);
  });
});
