# SQL-only invariants

Prisma cannot express partial unique indexes, CHECK/EXCLUDE constraints or triggers, and it ignores them when diffing.
They live in migration SQL and are verified by `test/invariants.test.ts` (existence) and `test/constraints.test.ts`
(behaviour). Never declare a partial index in `schema.prisma` (Prisma would recreate it as a full index), never edit an
applied migration — add a new one.

| Object | Kind | Migration | Rule |
|---|---|---|---|
| `AcademicYear_one_active` | partial unique | `20261031120100_m1_invariants` | one `ACTIVE` year per tenant |
| `AcademicYear_dates_check` | CHECK | ″ | `startDate <= endDate` |
| `Grade_level_check` | CHECK | ″ | `level` 0..11 |
| `UserRole_active_unique` | partial unique | ″ | `(userId, roleId)` while `revokedAt IS NULL` |
| `TeachingGroup_one_class_group` | partial unique | ″ | one `CLASS` group per class |
| `TeachingGroup_class_check` | CHECK | ″ | `CLASS`/`SUBGROUP` need `classGroupId` |
| `TeachingGroupMember_dates_check` | CHECK | ″ | `validFrom <= validTo` |
| `TeachingGroupMember_no_overlap` | EXCLUDE (btree_gist) | ″ | a student's periods in one group never overlap |
| `StudentEnrollment_one_active` | partial unique | ″ | one `ACTIVE` enrollment per student and year |
| `StudentEnrollment_dates_check` | CHECK | ″ | `validFrom <= validTo` |
| `TeacherAssignment_dates_check` | CHECK | ″ | `validFrom <= validTo` |
| `SchoolBranding_color_check` | CHECK | ″ | colours are `#RRGGBB` |
| `AuditLog_append_only` | TRIGGER | ″ | `UPDATE`/`DELETE` raise `restrict_violation` |
| `AcademicPeriod_dates_check` | CHECK | `20261102090000_m2_calendar` | `startDate <= endDate` |
| `AcademicPeriod_no_overlap` | EXCLUDE (btree_gist) | ″ | periods of one type in one year never share a day |
| `SchoolWeek_weekdays_check` | CHECK | ″ | 1–7 working weekdays, each ISO 1..7 |
| `CalendarDay_override_check` | CHECK | ″ | `followsWeekday` (1..7) exactly on `WORKING_OVERRIDE` days |
| `Shift_minutes_check` | CHECK | ″ | `0 <= startMinute < endMinute <= 1440` |
| `BellSlot_minutes_check` | CHECK | ″ | lesson number 0..20, start before end within the day |
| `Timetable_published_check` | CHECK | `20261102120000_m2_timetable` | published/archived versions have `validFrom`, `publishedAt`; `validFrom <= validTo` |
| `Timetable_no_overlap` | EXCLUDE (btree_gist, partial) | ″ | published versions of a year never cover the same date |
| `TimetableEntry_slot_check` | CHECK | ″ | weekday 1..7, lesson number 0..20 |
| `TimetableEntry_frozen` | TRIGGER | ″ | entries of a non-`DRAFT` timetable cannot be inserted, changed or deleted |
| `LessonSession_times_check` | CHECK | `20261102150000_m2_lesson_sessions` | starts before it ends; lesson 0..20; `HELD` has `heldMarkedAt` |
| `LessonSession_no_delete` | TRIGGER | ″ | lessons are never deleted (`CANCELLED` instead) |
| `CurriculumPlan_one_open` | partial unique | `20261102180000_m2_curriculum` | one `DRAFT`/`SUBMITTED`/`REJECTED` version per plan lineage |
| `CurriculumPlan_one_approved` | partial unique | ″ | one `APPROVED` version per plan lineage |
| `PlanItem_hours_check` | CHECK | ″ | `hours` 1..100, `order >= 1` |
| `PlanItem_frozen` | TRIGGER | ″ | items of a submitted/approved/archived plan cannot change |
| `PlanAssignment_one_active` | partial unique | `20261102210000_m2_plan_assignments` | one `ACTIVE` plan per group and subject |
| `ScoreEntry_kind_check` | CHECK | `20261103090000_m3_scores` | NORMAL: points > 0, no reversed entry; REVERSAL: points < 0 and names the entry it reverses |
| `ScoreEntry_append_only` | TRIGGER | ″ | the score ledger is insert-only |
| `ScoreEntry_reversal_matches` | TRIGGER | ″ | a reversal is the exact negative of a NORMAL entry of the same student and lesson (once: `reversesEntryId` is unique) |
| `ScoreLimitRule_scope_check` | CHECK | ″ | `maxPoints > 0`; only the column of the scope type may be set |
| `ScoreLimitRule_one_active` | partial unique | ″ | one active rule per window, scope type and scope (or default) |
| `ScoreSettings_values_check` | CHECK | ″ | caps and session maximum positive, session maximum ≤ lesson cap, `lateEntryDays` 0..365 |
| `AssessmentPolicy_one_default` | partial unique | `20261103120000_m3_assessment` | one default policy per school |
| `AssessmentPolicyVersion_one_draft` | partial unique | ″ | one `DRAFT` version per policy |
| `AssessmentPolicyVersion_frozen` | TRIGGER | ″ | a published version never changes or disappears; only `PUBLISHED → RETIRED` |
| `PolicyBinding_one_current` | partial unique | ″ | one current binding per period and subject (or all subjects) |
| `GradeScaleBand_range_check` | CHECK | ″ | `0 <= min < max <= 100` |
| `ManualAssessmentScore_points_check` | CHECK | ″ | `0 <= points <= maxPoints`, `maxPoints > 0` |
| `ManualAssessmentScore_one_current` | partial unique | ″ | one current manual score per period, subject, student and component |
| `PeriodResult_one_current` | partial unique | ″ | one current result per student, period and subject (or overall) |
| `PeriodResult_final_frozen` | TRIGGER | ″ | a `FINAL` result never changes (only `isStale`, and `isCurrent` → false) and is never deleted |

Checking a new migration does not touch them:

```bash
grep -nE '_one_|_check|_no_overlap|_append_only|_active_unique|_frozen|_no_delete' packages/db/prisma/migrations/<new>/migration.sql
```
