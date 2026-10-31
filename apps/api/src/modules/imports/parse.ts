// Pure row validation for imports (no DB): the processor loads a lookup context, these functions turn sheet rows into
// preview rows with normalised data and message codes (translated in the web app as imports.messages.<code>).
import { RELATION_ALIASES, SYSTEM_ROLES, cleanName, normalizeText, normalizeUzPhone } from "@idrok/shared";
import { isSchoolDate } from "@idrok/shared/time";
import type { SheetRow } from "./excel";

export interface Message {
  code: string;
  field?: string;
  params?: Record<string, unknown>;
}
export interface PreviewRow<T> {
  rowNumber: number;
  status: "OK" | "WARNING" | "ERROR";
  data: T;
  messages: Message[];
}

const status = (messages: Message[], errors: Message[]): PreviewRow<unknown>["status"] =>
  errors.length ? "ERROR" : messages.length ? "WARNING" : "OK";

const MAX_TEXT = 120;

function name(value: string, field: string, required: boolean, errors: Message[]): string | null {
  if (!value) {
    if (required) errors.push({ code: "REQUIRED", field });
    return null;
  }
  if (value.length > MAX_TEXT) errors.push({ code: "TOO_LONG", field, params: { max: MAX_TEXT } });
  return cleanName(value);
}

/** "2014-03-05", "05.03.2014", "5/3/2014" (day first). */
export function parseDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
  const s = iso ? value : dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : null;
  return s && isSchoolDate(s) ? s : null;
}

function yesNo(value: string): boolean | null {
  const v = normalizeText(value);
  if (!v) return null;
  if (["ha", "yes", "да", "1", "true", "+"].includes(v)) return true;
  if (["yo'q", "yoq", "no", "нет", "0", "false", "-"].includes(v)) return false;
  return null;
}

function gender(value: string): "MALE" | "FEMALE" | null | "INVALID" {
  const v = normalizeText(value);
  if (!v) return null;
  if (["e", "erkak", "m", "male", "м", "муж"].includes(v)) return "MALE";
  if (["a", "ayol", "f", "female", "ж", "жен", "q", "qiz"].includes(v)) return "FEMALE";
  return "INVALID";
}

export const classKey = (value: string) => normalizeText(value).replace(/\s|-/g, "").toUpperCase();

// ------------------------------------------------------------------ students + guardians

export interface StudentRowData {
  studentCode: string | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
  dateOfBirth: string | null;
  gender: "MALE" | "FEMALE" | null;
  classGroupId: string | null;
  className: string;
  phone: string | null;
  address: string | null;
  createAccount: boolean | null;
  guardians: {
    lastName: string;
    firstName: string;
    phone: string;
    relation: "MOTHER" | "FATHER" | "GRANDPARENT" | "SIBLING" | "OTHER";
  }[];
  /** Existing student this row updates (matched by code, or by name + date of birth). */
  matchedStudentId: string | null;
}

export interface StudentLookup {
  classIdByKey: Map<string, string>;
  studentIdByCode: Map<string, string>;
  /** normalised "last|first|dob" → id */
  studentIdByNameDob: Map<string, string>;
  /** normalised "last|first" → count of existing students with that name */
  studentNameCount: Map<string, number>;
}

export function parseStudentRows(rows: SheetRow[], ctx: StudentLookup): PreviewRow<StudentRowData>[] {
  const seenCodes = new Map<string, number>();
  return rows.map(({ rowNumber, values: v }) => {
    const errors: Message[] = [];
    const warnings: Message[] = [];
    const lastName = name(v.lastName ?? "", "lastName", true, errors) ?? "";
    const firstName = name(v.firstName ?? "", "firstName", true, errors) ?? "";
    const middleName = name(v.middleName ?? "", "middleName", false, errors);
    const dateOfBirth = v.dateOfBirth ? parseDate(v.dateOfBirth) : null;
    if (v.dateOfBirth && !dateOfBirth) errors.push({ code: "INVALID_DATE", field: "dateOfBirth" });
    const g = gender(v.gender ?? "");
    if (g === "INVALID") errors.push({ code: "INVALID_GENDER", field: "gender" });
    const className = (v.className ?? "").trim();
    const classGroupId = className ? (ctx.classIdByKey.get(classKey(className)) ?? null) : null;
    if (!className) errors.push({ code: "REQUIRED", field: "className" });
    else if (!classGroupId) errors.push({ code: "UNKNOWN_CLASS", field: "className", params: { value: className } });
    const phone = v.phone ? normalizeUzPhone(v.phone) : null;
    if (v.phone && !phone) errors.push({ code: "INVALID_PHONE", field: "phone" });
    const createAccount = yesNo(v.createAccount ?? "");
    if (v.createAccount && createAccount === null) errors.push({ code: "INVALID_YES_NO", field: "createAccount" });

    const guardians: StudentRowData["guardians"] = [];
    for (const n of [1, 2] as const) {
      const ln = v[`guardian${n}LastName`] ?? "";
      const fn = v[`guardian${n}FirstName`] ?? "";
      const ph = v[`guardian${n}Phone`] ?? "";
      const rel = v[`guardian${n}Relation`] ?? "";
      if (!ln && !fn && !ph && !rel) continue;
      const field = `guardian${n}`;
      const gPhone = normalizeUzPhone(ph);
      if (!ph) errors.push({ code: "REQUIRED", field: `${field}Phone` });
      else if (!gPhone) errors.push({ code: "INVALID_PHONE", field: `${field}Phone` });
      const glast = name(ln, `${field}LastName`, true, errors);
      const gfirst = name(fn, `${field}FirstName`, true, errors);
      const relation = rel ? RELATION_ALIASES[normalizeText(rel)] : "OTHER";
      if (!relation) errors.push({ code: "INVALID_RELATION", field: `${field}Relation` });
      if (gPhone && glast && gfirst && relation)
        guardians.push({ lastName: glast, firstName: gfirst, phone: gPhone, relation });
    }
    if (guardians.length === 2 && guardians[0]!.phone === guardians[1]!.phone) {
      errors.push({ code: "DUPLICATE_GUARDIAN_PHONE", field: "guardian2Phone" });
    }

    // Matching (Q-33): code first, then exact name + date of birth; a same-name student without a date is only a warning.
    const code = (v.studentCode ?? "").trim().toUpperCase() || null;
    let matchedStudentId: string | null = null;
    if (code) {
      const prev = seenCodes.get(code);
      if (prev) errors.push({ code: "DUPLICATE_IN_FILE", field: "studentCode", params: { row: prev } });
      seenCodes.set(code, rowNumber);
      matchedStudentId = ctx.studentIdByCode.get(code) ?? null;
      if (!matchedStudentId)
        errors.push({ code: "UNKNOWN_STUDENT_CODE", field: "studentCode", params: { value: code } });
    } else if (lastName && firstName) {
      const base = `${normalizeText(lastName)}|${normalizeText(firstName)}`;
      if (dateOfBirth) matchedStudentId = ctx.studentIdByNameDob.get(`${base}|${dateOfBirth}`) ?? null;
      if (matchedStudentId) warnings.push({ code: "MATCHED_EXISTING_STUDENT" });
      else if ((ctx.studentNameCount.get(base) ?? 0) > 0) warnings.push({ code: "POSSIBLE_DUPLICATE_STUDENT" });
    }

    const messages = [...errors, ...warnings];
    return {
      rowNumber,
      status: status(messages, errors),
      messages,
      data: {
        studentCode: code,
        lastName,
        firstName,
        middleName,
        dateOfBirth,
        gender: g === "INVALID" ? null : g,
        classGroupId,
        className,
        phone,
        address: v.address ? v.address.slice(0, 300) : null,
        createAccount,
        guardians,
        matchedStudentId,
      },
    };
  });
}

// ------------------------------------------------------------------ employees + assignments

export interface EmployeeRowData {
  employeeCode: string | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
  phone: string | null;
  positionTitle: string | null;
  roles: string[];
  homeroomClassId: string | null;
  assignments: { subjectId: string; teachingGroupId: string; label: string }[];
  matchedEmployeeId: string | null;
}

export interface EmployeeLookup {
  classIdByKey: Map<string, string>;
  /** class key or subgroup name key → teaching group id */
  groupIdByKey: Map<string, string>;
  subjectIdByKey: Map<string, string>;
  employeeIdByCode: Map<string, string>;
  employeeIdByName: Map<string, string>;
}

export function parseEmployeeRows(rows: SheetRow[], ctx: EmployeeLookup): PreviewRow<EmployeeRowData>[] {
  const seenCodes = new Map<string, number>();
  return rows.map(({ rowNumber, values: v }) => {
    const errors: Message[] = [];
    const warnings: Message[] = [];
    const lastName = name(v.lastName ?? "", "lastName", true, errors) ?? "";
    const firstName = name(v.firstName ?? "", "firstName", true, errors) ?? "";
    const middleName = name(v.middleName ?? "", "middleName", false, errors);
    const phone = v.phone ? normalizeUzPhone(v.phone) : null;
    if (v.phone && !phone) errors.push({ code: "INVALID_PHONE", field: "phone" });

    const roles = (v.roles ?? "")
      .split(/[,;\s]+/)
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    const unknownRoles = roles.filter(
      (r) =>
        !(SYSTEM_ROLES as readonly string[]).includes(r) || r === "SUPER_ADMIN" || r === "STUDENT" || r === "GUARDIAN",
    );
    if (unknownRoles.length)
      errors.push({ code: "UNKNOWN_ROLE", field: "roles", params: { value: unknownRoles.join(", ") } });

    let homeroomClassId: string | null = null;
    if (v.homeroomClass) {
      homeroomClassId = ctx.classIdByKey.get(classKey(v.homeroomClass)) ?? null;
      if (!homeroomClassId)
        errors.push({ code: "UNKNOWN_CLASS", field: "homeroomClass", params: { value: v.homeroomClass } });
    }

    // "Matematika: 7-A, 7-B; Fizika: 8-A"
    const assignments: EmployeeRowData["assignments"] = [];
    for (const part of (v.assignments ?? "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)) {
      const [subjectName, groups] = part.split(":").map((p) => p?.trim() ?? "");
      const subjectId = subjectName ? ctx.subjectIdByKey.get(normalizeText(subjectName)) : undefined;
      if (!subjectId || !groups) {
        errors.push({
          code: subjectId ? "INVALID_ASSIGNMENT" : "UNKNOWN_SUBJECT",
          field: "assignments",
          params: { value: part },
        });
        continue;
      }
      for (const g of groups
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)) {
        const teachingGroupId = ctx.groupIdByKey.get(classKey(g));
        if (!teachingGroupId) errors.push({ code: "UNKNOWN_GROUP", field: "assignments", params: { value: g } });
        else assignments.push({ subjectId, teachingGroupId, label: `${subjectName}: ${g}` });
      }
    }

    const code = (v.employeeCode ?? "").trim() || null;
    let matchedEmployeeId: string | null = null;
    if (code) {
      const prev = seenCodes.get(code);
      if (prev) errors.push({ code: "DUPLICATE_IN_FILE", field: "employeeCode", params: { row: prev } });
      seenCodes.set(code, rowNumber);
      matchedEmployeeId = ctx.employeeIdByCode.get(code) ?? null;
    }
    if (!matchedEmployeeId && lastName && firstName) {
      matchedEmployeeId = ctx.employeeIdByName.get(`${normalizeText(lastName)}|${normalizeText(firstName)}`) ?? null;
    }
    if (matchedEmployeeId) warnings.push({ code: "MATCHED_EXISTING_EMPLOYEE" });

    const messages = [...errors, ...warnings];
    return {
      rowNumber,
      status: status(messages, errors),
      messages,
      data: {
        employeeCode: code,
        lastName,
        firstName,
        middleName,
        phone,
        positionTitle: v.positionTitle ? v.positionTitle.slice(0, 80) : null,
        roles: roles.length ? roles : ["TEACHER"],
        homeroomClassId,
        assignments,
        matchedEmployeeId,
      },
    };
  });
}

// ------------------------------------------------------------------ classes, subjects

export interface ClassRowData {
  level: number;
  section: string;
  capacity: number | null;
  homeroomEmployeeId: string | null;
  exists: boolean;
}

export function parseClassRows(
  rows: SheetRow[],
  ctx: { existingClassKeys: Set<string>; employeeIdByCode: Map<string, string> },
): PreviewRow<ClassRowData>[] {
  const seen = new Set<string>();
  return rows.map(({ rowNumber, values: v }) => {
    const errors: Message[] = [];
    const warnings: Message[] = [];
    const level = Number(v.level);
    if (!Number.isInteger(level) || level < 0 || level > 11) errors.push({ code: "INVALID_LEVEL", field: "level" });
    const section = (v.section ?? "").trim().toUpperCase();
    if (!section || section.length > 10) errors.push({ code: section ? "TOO_LONG" : "REQUIRED", field: "section" });
    const capacity = v.capacity ? Number(v.capacity) : null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 60))
      errors.push({ code: "INVALID_NUMBER", field: "capacity" });
    let homeroomEmployeeId: string | null = null;
    if (v.homeroomEmployeeCode) {
      homeroomEmployeeId = ctx.employeeIdByCode.get(v.homeroomEmployeeCode.trim()) ?? null;
      if (!homeroomEmployeeId) errors.push({ code: "UNKNOWN_EMPLOYEE_CODE", field: "homeroomEmployeeCode" });
    }
    const key = classKey(`${level}${section}`);
    if (seen.has(key)) errors.push({ code: "DUPLICATE_IN_FILE", field: "section" });
    seen.add(key);
    const exists = ctx.existingClassKeys.has(key);
    if (exists) warnings.push({ code: "ALREADY_EXISTS" });
    const messages = [...errors, ...warnings];
    return {
      rowNumber,
      status: status(messages, errors),
      messages,
      data: { level, section, capacity, homeroomEmployeeId, exists },
    };
  });
}

export interface SubjectRowData {
  name: string;
  shortName: string | null;
  code: string | null;
  exists: boolean;
}

export function parseSubjectRows(
  rows: SheetRow[],
  ctx: { existingNameKeys: Set<string> },
): PreviewRow<SubjectRowData>[] {
  const seen = new Set<string>();
  return rows.map(({ rowNumber, values: v }) => {
    const errors: Message[] = [];
    const warnings: Message[] = [];
    const subjectName = name(v.name ?? "", "name", true, errors) ?? "";
    const key = normalizeText(subjectName);
    if (key && seen.has(key)) errors.push({ code: "DUPLICATE_IN_FILE", field: "name" });
    seen.add(key);
    const exists = ctx.existingNameKeys.has(key);
    if (exists) warnings.push({ code: "ALREADY_EXISTS" });
    const messages = [...errors, ...warnings];
    return {
      rowNumber,
      status: status(messages, errors),
      messages,
      data: {
        name: subjectName,
        shortName: v.shortName?.slice(0, 20) || null,
        code: v.code?.slice(0, 20) || null,
        exists,
      },
    };
  });
}
