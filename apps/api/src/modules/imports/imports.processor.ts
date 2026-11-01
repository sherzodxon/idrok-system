// Worker side of imports (apps/worker): parse → preview rows, commit → apply rows. Both are idempotent: a retried job
// re-parses from scratch or skips rows that already have targetEntityId.
import { createHash, randomUUID } from "node:crypto";
import { requireTenantId, type Db, type Prisma } from "@idrok/db";
import type { ImportKindCode } from "@idrok/shared";
import { schoolDateFromDb, schoolToday, type SchoolDate } from "@idrok/shared/time";
import type { Logger } from "pino";
import type { StorageProvider } from "../../infra/storage";
import { storageKey } from "../../infra/storage";
import { schoolClock } from "../access/school-clock";
import type { AuthStateStore } from "../access/auth-state";
import { AccountsService } from "../users/accounts.service";
import {
  auditCommit,
  commitClassRow,
  commitEmployeeRow,
  commitStudentRow,
  commitSubjectRow,
  type CommitContext,
  type Credential,
} from "./commit";
import { AppError } from "../../http/errors";
import { CurriculumService } from "../curriculum/curriculum.service";
import { ImportFileError, buildCredentialsFile, readImportSheet } from "./excel";
import { mergePlanRows, parsePlanRows, type PlanImportMode, type PlanRowData } from "./plan-parse";
import { employeeLookup, studentLookup } from "./lookups";
import {
  classKey,
  parseClassRows,
  parseEmployeeRows,
  parseStudentRows,
  parseSubjectRows,
  type ClassRowData,
  type EmployeeRowData,
  type PreviewRow,
  type StudentRowData,
  type SubjectRowData,
} from "./parse";
import { normalizeText } from "@idrok/shared";

export interface ImportDeps {
  db: Db;
  storage: StorageProvider;
  authState: AuthStateStore;
  logger: Logger;
}

interface Options {
  academicYearId?: string;
  validFrom?: string;
  // curriculum plans (PlanImportOptions)
  subjectId?: string;
  gradeId?: string;
  mode?: PlanImportMode;
  planId?: string;
  teachingGroupId?: string;
  title?: string;
}

const NEEDS_YEAR: ImportKindCode[] = ["STUDENTS_GUARDIANS", "EMPLOYEES_ASSIGNMENTS", "CLASS_GROUPS", "CURRICULUM_PLAN"];

async function resolveYear(db: Db, options: Options) {
  const year = options.academicYearId
    ? await db.academicYear.findUnique({ where: { id: options.academicYearId } })
    : await db.academicYear.findFirst({ where: { status: "ACTIVE" } });
  return year;
}

async function fail(db: Db, id: string, code: string) {
  await db.importJob.update({ where: { id }, data: { status: "FAILED", failure: { code } } });
}

export async function parseImport(deps: ImportDeps, importJobId: string): Promise<void> {
  const { db } = deps;
  // Claim the job; a duplicate delivery of the same job finds it already parsed.
  const claimed = await db.importJob.updateMany({
    where: { id: importJobId, status: { in: ["UPLOADED", "PARSING"] } },
    data: { status: "PARSING" },
  });
  if (!claimed.count) return;
  const job = await db.importJob.findUniqueOrThrow({ where: { id: importJobId }, include: { fileAsset: true } });
  const kind = job.kind as ImportKindCode;
  const options = (job.options ?? {}) as Options;

  let sheet;
  try {
    sheet = await readImportSheet(await deps.storage.get(job.fileAsset.storageKey), kind);
  } catch (err) {
    if (err instanceof ImportFileError) return fail(db, importJobId, err.code);
    throw err;
  }

  const year = NEEDS_YEAR.includes(kind) ? await resolveYear(db, options) : null;
  if (NEEDS_YEAR.includes(kind) && !year) return fail(db, importJobId, "IMPORT_YEAR_REQUIRED");

  let rows: PreviewRow<unknown>[];
  switch (kind) {
    case "STUDENTS_GUARDIANS":
      rows = parseStudentRows(sheet, await studentLookup(db, year!.id));
      break;
    case "EMPLOYEES_ASSIGNMENTS":
      rows = parseEmployeeRows(sheet, await employeeLookup(db, year!.id));
      break;
    case "CLASS_GROUPS": {
      const [classes, employees] = await Promise.all([
        db.classGroup.findMany({ where: { academicYearId: year!.id }, select: { name: true } }),
        db.employee.findMany({ where: { employeeCode: { not: null } }, select: { id: true, employeeCode: true } }),
      ]);
      rows = parseClassRows(sheet, {
        existingClassKeys: new Set(classes.map((c) => classKey(c.name))),
        employeeIdByCode: new Map(employees.map((e) => [e.employeeCode!, e.id])),
      });
      break;
    }
    case "SUBJECTS": {
      const subjects = await db.subject.findMany({ select: { name: true } });
      rows = parseSubjectRows(sheet, { existingNameKeys: new Set(subjects.map((s) => normalizeText(s.name))) });
      break;
    }
    case "CURRICULUM_PLAN": {
      const periods = await db.academicPeriod.findMany({
        where: { academicYearId: year!.id },
        select: { id: true, name: true },
      });
      rows = parsePlanRows(sheet, {
        mode: options.mode ?? "TOPICS",
        periodIdByName: new Map(periods.map((p) => [normalizeText(p.name), p.id])),
      });
      break;
    }
  }
  // Curriculum plans: planned hours against the group's lessons (a warning when they differ, §4.3).
  const planTotals =
    kind === "CURRICULUM_PLAN"
      ? {
          hours: rows.reduce(
            (sum, r) => sum + (r.status === "OK" || r.status === "WARNING" ? ((r.data as PlanRowData).hours ?? 0) : 0),
            0,
          ),
          ...(options.teachingGroupId && options.subjectId
            ? {
                lessons: await db.lessonSession.count({
                  where: {
                    teachingGroupId: options.teachingGroupId,
                    subjectId: options.subjectId,
                    academicYearId: year!.id,
                    status: { not: "CANCELLED" },
                  },
                }),
              }
            : {}),
        }
      : {};

  const count = (s: string) => rows.filter((r) => r.status === s).length;
  await db.$transaction(async (tx) => {
    await tx.importRow.deleteMany({ where: { importJobId } });
    await tx.importRow.createMany({
      data: rows.map((r) => ({
        importJobId,
        rowNumber: r.rowNumber,
        status: r.status,
        data: r.data as Prisma.InputJsonValue,
        messages: r.messages as unknown as Prisma.InputJsonValue,
      })),
    });
    await tx.importJob.update({
      where: { id: importJobId },
      data: {
        status: "PREVIEW_READY",
        errorCount: count("ERROR"),
        warningCount: count("WARNING"),
        summary: {
          total: rows.length,
          ok: count("OK"),
          warnings: count("WARNING"),
          errors: count("ERROR"),
          ...(kind === "CURRICULUM_PLAN" ? { skipped: count("SKIPPED"), ...planTotals } : {}),
        },
        ...(year ? { options: { ...options, academicYearId: year.id } } : {}),
      },
    });
  });
}

/** A curriculum plan is created as a whole: all rows in one transaction (it is one document, not many records). */
async function commitPlanImport(
  deps: ImportDeps,
  job: { id: string; createdById: string; options: unknown; summary: unknown },
) {
  const { db } = deps;
  const options = (job.options ?? {}) as Options;
  const rows = await db.importRow.findMany({
    where: { importJobId: job.id, status: { in: ["OK", "WARNING"] } },
    orderBy: { rowNumber: "asc" },
  });
  const items = mergePlanRows(rows.map((r) => r.data as unknown as PlanRowData));
  try {
    await db.$transaction(async (tx) => {
      const plan = await new CurriculumService(db).createFromImport(tx, {
        academicYearId: options.academicYearId!,
        subjectId: options.subjectId!,
        gradeId: options.gradeId!,
        planId: options.planId,
        title: options.title ?? "Import",
        userId: job.createdById,
        importJobId: job.id,
        items: items.map((i) => ({
          topicTitle: i.topicTitle,
          hours: i.hours,
          lessonType: i.lessonType,
          periodId: i.periodId,
          objectives: i.objectives,
          homework: i.homework,
          resources: i.resources,
          notes: i.notes,
        })),
      });
      await tx.importRow.updateMany({
        where: { importJobId: job.id, status: { in: ["OK", "WARNING"] } },
        data: { targetEntityId: plan.id },
      });
      const summary = { ...((job.summary as Record<string, number> | null) ?? {}), created: 1, items: items.length };
      await tx.importJob.update({
        where: { id: job.id },
        data: { status: "COMMITTED", committedAt: new Date(), summary },
      });
      await auditCommit(tx, job.id, summary);
    });
  } catch (err) {
    if (err instanceof AppError) return fail(db, job.id, String(err.details?.reason ?? err.code));
    throw err;
  }
}

export async function commitImport(deps: ImportDeps, importJobId: string): Promise<void> {
  const { db } = deps;
  const job = await db.importJob.findUniqueOrThrow({ where: { id: importJobId } });
  if (job.status !== "COMMITTING") return;
  if (job.kind === "CURRICULUM_PLAN") return commitPlanImport(deps, job);
  const kind = job.kind as ImportKindCode;
  const options = (job.options ?? {}) as Options & { skipErrors?: boolean };
  const accounts = new AccountsService(db, deps.authState);
  const actorRoles = await db.userRole.findMany({
    where: { userId: job.createdById, revokedAt: null },
    select: { role: { select: { code: true } } },
  });
  const actor = { userId: job.createdById, roles: actorRoles.map((r) => r.role.code) };
  const { timezone } = await schoolClock(db);
  const year = NEEDS_YEAR.includes(kind) ? await resolveYear(db, options) : null;
  const yearStart = year ? schoolDateFromDb(year.startDate) : null;
  const today = schoolToday(timezone);
  const validFrom = (options.validFrom ?? (yearStart && yearStart > today ? yearStart : today)) as SchoolDate;
  const settings = await db.schoolSettings.findFirst({ select: { studentAccountMinGrade: true } });

  const credentials: Credential[] = [];
  const tally = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const rows = await db.importRow.findMany({ where: { importJobId }, orderBy: { rowNumber: "asc" } });

  for (const row of rows) {
    if (row.targetEntityId) continue; // applied by an earlier attempt of this job
    if (row.status === "ERROR" || row.status === "SKIPPED") {
      tally.skipped++;
      if (row.status === "ERROR") await db.importRow.update({ where: { id: row.id }, data: { status: "SKIPPED" } });
      continue;
    }
    try {
      const outcome = await db.$transaction(async (tx) => {
        const ctx: CommitContext = {
          tx,
          actor,
          accounts,
          validFrom,
          minGrade: settings?.studentAccountMinGrade ?? 5,
          credentials,
        };
        // Row data was produced by this module's parsers for this job's kind.
        const data: unknown = row.data;
        const result =
          kind === "STUDENTS_GUARDIANS"
            ? await commitStudentRow(ctx, data as StudentRowData)
            : kind === "EMPLOYEES_ASSIGNMENTS"
              ? await commitEmployeeRow(ctx, data as EmployeeRowData)
              : kind === "CLASS_GROUPS"
                ? await commitClassRow(ctx, data as ClassRowData, year!.id)
                : await commitSubjectRow(ctx, data as SubjectRowData);
        await tx.importRow.update({ where: { id: row.id }, data: { targetEntityId: result.targetEntityId } });
        return result;
      });
      tally[outcome.action === "CREATED" ? "created" : outcome.action === "UPDATED" ? "updated" : "unchanged"]++;
    } catch (err) {
      tally.failed++;
      deps.logger.warn({ err, importJobId, rowNumber: row.rowNumber }, "import row failed");
      await db.importRow.update({
        where: { id: row.id },
        data: { status: "ERROR", messages: [{ code: "COMMIT_FAILED" }] as unknown as Prisma.InputJsonValue },
      });
    }
  }

  let resultAssetId: string | null = null;
  if (credentials.length) {
    const tenantId = requireTenantId();
    const buffer = await buildCredentialsFile("uz", credentials);
    const id = randomUUID();
    const key = storageKey(tenantId, "EXPORT", id, "xlsx");
    await deps.storage.put(key, buffer, { contentType: XLSX });
    resultAssetId = (
      await db.fileAsset.create({
        data: {
          id,
          tenantId,
          storageKey: key,
          originalName: `logins-${importJobId.slice(0, 8)}.xlsx`,
          mimeType: XLSX,
          sizeBytes: buffer.length,
          sha256: createHash("sha256").update(buffer).digest("hex"),
          kind: "EXPORT",
          status: "READY",
          createdById: job.createdById,
        },
      })
    ).id;
  }

  const summary = { ...((job.summary as Record<string, number> | null) ?? {}), ...tally, accounts: credentials.length };
  await db.$transaction(async (tx) => {
    await tx.importJob.update({
      where: { id: importJobId },
      data: { status: "COMMITTED", committedAt: new Date(), summary, resultAssetId },
    });
    await auditCommit(tx, importJobId, summary);
  });
}

export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
