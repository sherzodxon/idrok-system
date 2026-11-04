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
| `QuestionVersion_append_only` | TRIGGER | `20261104090000_m4_tests` | a question version is never edited or deleted (an edit is a new version) |
| `QuestionVersion_points_check` | CHECK | ″ | `points > 0` |
| `Test_window_check` | CHECK | ″ | `startsAt < endsAt`; time limit and question count positive |
| `Test_weighted_check` | CHECK | ″ | a `WEIGHTED` test has a period and a positive weight |
| `Test_offline_scale_check` | CHECK | ″ | an `OFFLINE` test's `maxScore` ∈ {5, 10, 20, 25, 40, 50, 100} (Q-45) |
| `Test_threshold_check` | CHECK | ″ | `violationThreshold >= 0`, `maxScore >= 0` |
| `TestQuestion_points_check` | CHECK | ″ | `points > 0`, `order >= 0` |
| `TestAssignment_target_check` | CHECK | ″ | exactly one of teaching group / student |
| `TestWindowOverride_window_check` | CHECK | ″ | `startsAt < endsAt`, time limit positive |
| `TestAttempt_one_in_progress` | partial unique | ″ | one running attempt per student and test |
| `TestAttempt_finish_check` | CHECK | ″ | `FINISHED` ⇔ finish reason and time set; `attemptNo >= 1` |
| `OfflineResult_score_check` | CHECK | ″ | `SCORED` ⇔ `rawScore` set; `rawScore >= 0` (≤ `maxScore` checked by the API) |
| `OfflineResult_one_current` | partial unique | ″ | one current offline result per test and student |
| `OfflineResult_history` | TRIGGER | ″ | offline results are never deleted; an update only links a row to its successor |
| `SchoolSettings_max_questions_check` | CHECK | `20261104120000_m4_test_settings` | `maxQuestionsPerTest` 1..200 (Q-36) |
| `CoinSettings_check` | CHECK | `20261105090000_m5_coins` | `maxDebt >= 0`; activity window 1..90 days, coverage 0..100 %, stale days ≥ 0 |
| `CoinCriterion_amount_check` | CHECK | ″ | `1 <= minAmount <= maxAmount` |
| `CoinLimitRule_check` | CHECK | ″ | a limit has an amount or a count (≥ 1); `ROLLING` ⇔ duration; the scope decides which of teacher / criterion is set |
| `CoinTransaction_append_only` | TRIGGER | ″ | the coin ledger is never updated or deleted (mistakes: `REVERSAL` / `CORRECTION` rows) |
| `CoinTransaction_shape_check` | CHECK | ″ | amount ≠ 0; `REWARD`/`REFUND` > 0, `PENALTY`/`PURCHASE` < 0; only a `REVERSAL` points at the row it undoes, only a `CORRECTION` at the row it lowers |
| `CoinProduct_check` | CHECK | ″ | `price >= 1`, `stock >= 0` |
| `CoinOrder_price_check` | CHECK | ″ | `priceAtOrder >= 1` |
| `AttendanceSettings_check` | CHECK | `20261106090000_m6_face_id` | default school day start < end (minutes of day); grace 0..120 min; clock skew 0..3600 s; event age 1..60 days; device stale window 30 s..1 day |
| `LatenessBand_check` | CHECK | ″ | `fromMinute >= 1`; `toMinute` empty or greater than `fromMinute` |
| `Device_port_check` | CHECK | ″ | port 1..65535 |
| `AccessEvent_append_only` | TRIGGER | ″ | raw terminal events are never updated or deleted (attendance is recomputed from them) |
| `AttendanceRecord_check` | CHECK | ″ | device status ⇔ arrival time; lateness and band only when `LATE`; departure not before arrival; a manual mark has author, time and reason; a row has a device result or a manual mark |

Checking a new migration does not touch them:

```bash
grep -nE '_one_|_check|_no_overlap|_append_only|_active_unique|_frozen|_no_delete' packages/db/prisma/migrations/<new>/migration.sql
```
