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

Checking a new migration does not touch them:

```bash
grep -nE '_one_|_check|_no_overlap|_append_only|_active_unique' packages/db/prisma/migrations/<new>/migration.sql
```
