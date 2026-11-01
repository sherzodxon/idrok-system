// The SQL-only invariants (INVARIANTS.md) must exist after migrations — a later migration must not drop them.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseUrl } from "./helpers";

const INDEXES = [
  "AcademicYear_one_active",
  "UserRole_active_unique",
  "TeachingGroup_one_class_group",
  "StudentEnrollment_one_active",
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
];
const TRIGGERS = ["AuditLog_append_only"];

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
    expect(rows.map((r) => r.tgname)).toEqual(TRIGGERS);
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
