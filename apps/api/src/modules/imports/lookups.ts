// Lookup context for the pure import parsers, loaded inside the tenant context.
import type { Db } from "@idrok/db";
import { normalizeText } from "@idrok/shared";
import { schoolDateFromDb } from "@idrok/shared/time";
import { classKey, type EmployeeLookup, type StudentLookup } from "./parse";

export async function classesOfYear(db: Db, academicYearId: string) {
  const classes = await db.classGroup.findMany({
    where: { academicYearId, archivedAt: null },
    select: {
      id: true,
      name: true,
      teachingGroups: { where: { archivedAt: null }, select: { id: true, kind: true, name: true } },
    },
  });
  return classes;
}

export async function studentLookup(db: Db, academicYearId: string): Promise<StudentLookup> {
  const [classes, students] = await Promise.all([
    classesOfYear(db, academicYearId),
    db.student.findMany({
      select: { id: true, studentCode: true, firstName: true, lastName: true, dateOfBirth: true },
    }),
  ]);
  const studentNameCount = new Map<string, number>();
  const studentIdByNameDob = new Map<string, string>();
  for (const s of students) {
    const base = `${normalizeText(s.lastName)}|${normalizeText(s.firstName)}`;
    studentNameCount.set(base, (studentNameCount.get(base) ?? 0) + 1);
    if (s.dateOfBirth) studentIdByNameDob.set(`${base}|${schoolDateFromDb(s.dateOfBirth)}`, s.id);
  }
  return {
    classIdByKey: new Map(classes.map((c) => [classKey(c.name), c.id])),
    studentIdByCode: new Map(students.map((s) => [s.studentCode.toUpperCase(), s.id])),
    studentIdByNameDob,
    studentNameCount,
  };
}

export async function employeeLookup(db: Db, academicYearId: string): Promise<EmployeeLookup> {
  const [classes, subjects, employees] = await Promise.all([
    classesOfYear(db, academicYearId),
    db.subject.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
    db.employee.findMany({ select: { id: true, employeeCode: true, firstName: true, lastName: true } }),
  ]);
  const groupIdByKey = new Map<string, string>();
  for (const c of classes) {
    for (const g of c.teachingGroups) groupIdByKey.set(classKey(g.kind === "CLASS" ? c.name : g.name), g.id);
  }
  return {
    classIdByKey: new Map(classes.map((c) => [classKey(c.name), c.id])),
    groupIdByKey,
    subjectIdByKey: new Map(subjects.map((s) => [normalizeText(s.name), s.id])),
    employeeIdByCode: new Map(employees.filter((e) => e.employeeCode).map((e) => [e.employeeCode!, e.id])),
    employeeIdByName: new Map(
      employees.map((e) => [`${normalizeText(e.lastName)}|${normalizeText(e.firstName)}`, e.id]),
    ),
  };
}
