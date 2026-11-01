// Fills a school with the synthetic demo data (implementation-plan step 8) through the same parse and commit code as
// an Excel import, so the demo has every invariant real data has (whole-class groups, enrollments, accounts, audit).
// Runs inside the caller's tenant context. Account passwords are random and never shown: the admin resets the ones
// needed for a demo in Settings → Users.
import type { Db } from "@idrok/db";
import { normalizeText } from "@idrok/shared";
import { parseSchoolDate, schoolDateFromDb, type SchoolDate } from "@idrok/shared/time";
import {
  commitClassRow,
  commitEmployeeRow,
  commitStudentRow,
  commitSubjectRow,
  type CommitContext,
} from "../imports/commit";
import { employeeLookup, studentLookup } from "../imports/lookups";
import {
  classKey,
  parseClassRows,
  parseEmployeeRows,
  parseStudentRows,
  parseSubjectRows,
  type PreviewRow,
} from "../imports/parse";
import { StructureService } from "../structure/structure.service";
import { AccountsService, type Actor, type AuthStateSink } from "../users/accounts.service";
import { DEMO_YEAR, classRows, studentRows, subjectRows, teacherRows } from "./demo-data";

export interface DemoSummary {
  subjects: number;
  classes: number;
  employees: number;
  students: number;
  accounts: number;
}

export class DemoAlreadySeededError extends Error {
  constructor() {
    super("The school already has students; the demo seed only fills an empty school.");
  }
}

// New accounts have no sessions or cached state to drop.
const NO_SESSIONS: AuthStateSink = { markRevoked: async () => {}, invalidate: async () => {} };

export async function seedDemoSchool(db: Db, actor: Actor): Promise<DemoSummary> {
  if (await db.student.count()) throw new DemoAlreadySeededError();

  const structure = new StructureService(db);
  let year = await db.academicYear.findFirst({ where: { status: "ACTIVE" } });
  if (!year) {
    const created = await structure.createYear({
      name: DEMO_YEAR.name,
      startDate: parseSchoolDate(DEMO_YEAR.startDate),
      endDate: parseSchoolDate(DEMO_YEAR.endDate),
    });
    await structure.activateYear(created.id);
    year = await db.academicYear.findUniqueOrThrow({ where: { id: created.id } });
  }
  const yearId = year.id;
  const settings = await db.schoolSettings.findFirst({ select: { studentAccountMinGrade: true } });
  const accounts = new AccountsService(db, NO_SESSIONS);
  let accountCount = 0;

  /** Commits every row in its own transaction, as an import does; the demo data has no invalid rows. */
  async function apply<T>(rows: PreviewRow<T>[], commit: (ctx: CommitContext, data: T) => Promise<unknown>) {
    const invalid = rows.find((r) => r.status === "ERROR");
    if (invalid) throw new Error(`demo row ${invalid.rowNumber} is invalid: ${JSON.stringify(invalid.messages)}`);
    for (const row of rows) {
      await db.$transaction(async (tx) => {
        const ctx: CommitContext = {
          tx,
          actor,
          accounts,
          validFrom: schoolDateFromDb(year!.startDate) as SchoolDate,
          minGrade: settings?.studentAccountMinGrade ?? 5,
          credentials: [],
        };
        await commit(ctx, row.data);
        accountCount += ctx.credentials.length;
      });
    }
    return rows.length;
  }

  const existingSubjects = await db.subject.findMany({ select: { name: true } });
  const subjects = await apply(
    parseSubjectRows(subjectRows(), { existingNameKeys: new Set(existingSubjects.map((s) => normalizeText(s.name))) }),
    commitSubjectRow,
  );
  const existingClasses = await db.classGroup.findMany({ where: { academicYearId: yearId }, select: { name: true } });
  const classes = await apply(
    parseClassRows(classRows(), {
      existingClassKeys: new Set(existingClasses.map((c) => classKey(c.name))),
      employeeIdByCode: new Map(),
    }),
    (ctx, d) => commitClassRow(ctx, d, yearId),
  );
  const employees = await apply(parseEmployeeRows(teacherRows(), await employeeLookup(db, yearId)), commitEmployeeRow);
  const students = await apply(parseStudentRows(studentRows(), await studentLookup(db, yearId)), commitStudentRow);
  return { subjects, classes, employees, students, accounts: accountCount };
}
