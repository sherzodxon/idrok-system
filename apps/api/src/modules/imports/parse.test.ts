import { describe, expect, it } from "vitest";
import {
  classKey,
  parseDate,
  parseEmployeeRows,
  parseStudentRows,
  type EmployeeLookup,
  type StudentLookup,
} from "./parse";

const students: StudentLookup = {
  classIdByKey: new Map([[classKey("7-A"), "class-7a"]]),
  studentIdByCode: new Map([["STD-0007", "student-7"]]),
  studentIdByNameDob: new Map([["demo|ali|2013-04-05", "student-ali"]]),
  studentNameCount: new Map([
    ["demo|ali", 1],
    ["demo|vali", 1],
  ]),
};
const row = (values: Record<string, string>, rowNumber = 3) => ({ rowNumber, values });

describe("parseDate", () => {
  it.each([
    ["2013-04-05", "2013-04-05"],
    ["05.04.2013", "2013-04-05"],
    ["5/4/2013", "2013-04-05"],
    ["31.02.2013", null],
    ["2013/04/05", null],
  ])("%s → %s", (input, expected) => expect(parseDate(input)).toBe(expected));
});

describe("classKey", () => {
  it("ignores case, spaces and dashes", () => {
    expect(classKey(" 7 - a ")).toBe(classKey("7-A"));
  });
});

describe("parseStudentRows", () => {
  it("normalises a valid row", () => {
    const [r] = parseStudentRows(
      [
        row({
          lastName: "  yangi ",
          firstName: "O'g'il",
          className: "7a",
          gender: "erkak",
          guardian1LastName: "Ona",
          guardian1FirstName: "Demo",
          guardian1Phone: "90 123 45 67",
          guardian1Relation: "Ona",
        }),
      ],
      students,
    );
    expect(r!.status).toBe("OK");
    expect(r!.data).toMatchObject({ lastName: "yangi", firstName: "Oʻgʻil", classGroupId: "class-7a", gender: "MALE" });
    expect(r!.data.guardians).toEqual([
      { lastName: "Ona", firstName: "Demo", phone: "+998901234567", relation: "MOTHER" },
    ]);
  });

  it("reports every problem of a row", () => {
    const [r] = parseStudentRows(
      [row({ firstName: "", className: "9-Z", dateOfBirth: "99.99.2013", gender: "x", guardian1Phone: "1" })],
      students,
    );
    expect(r!.status).toBe("ERROR");
    expect(r!.messages.map((m) => `${m.code}:${m.field}`)).toEqual(
      expect.arrayContaining([
        "REQUIRED:lastName",
        "REQUIRED:firstName",
        "INVALID_DATE:dateOfBirth",
        "INVALID_GENDER:gender",
        "UNKNOWN_CLASS:className",
        "INVALID_PHONE:guardian1Phone",
      ]),
    );
  });

  it("matches by code, then by name and birth date; warns on a same-name student", () => {
    const rows = parseStudentRows(
      [
        row({ studentCode: "std-0007", lastName: "Demo", firstName: "X", className: "7-A" }, 3),
        row({ lastName: "Demo", firstName: "Ali", dateOfBirth: "05.04.2013", className: "7-A" }, 4),
        row({ lastName: "Demo", firstName: "Vali", className: "7-A" }, 5),
        row({ studentCode: "STD-0007", lastName: "Demo", firstName: "Y", className: "7-A" }, 6),
      ],
      students,
    );
    expect(rows[0]!.data.matchedStudentId).toBe("student-7");
    expect(rows[1]!.data.matchedStudentId).toBe("student-ali");
    expect(rows[1]!.messages[0]!.code).toBe("MATCHED_EXISTING_STUDENT");
    expect(rows[2]!.data.matchedStudentId).toBeNull();
    expect(rows[2]!.messages[0]!.code).toBe("POSSIBLE_DUPLICATE_STUDENT");
    expect(rows[3]!.messages[0]).toMatchObject({ code: "DUPLICATE_IN_FILE", params: { row: 3 } });
  });

  it("rejects the same phone for both guardians", () => {
    const [r] = parseStudentRows(
      [
        row({
          lastName: "D",
          firstName: "D",
          className: "7-A",
          guardian1LastName: "A",
          guardian1FirstName: "A",
          guardian1Phone: "901234567",
          guardian2LastName: "B",
          guardian2FirstName: "B",
          guardian2Phone: "+998901234567",
        }),
      ],
      students,
    );
    expect(r!.messages.map((m) => m.code)).toContain("DUPLICATE_GUARDIAN_PHONE");
  });
});

describe("parseEmployeeRows", () => {
  const ctx: EmployeeLookup = {
    classIdByKey: new Map([[classKey("7-A"), "class-7a"]]),
    groupIdByKey: new Map([
      [classKey("7-A"), "tg-7a"],
      [classKey("7-B"), "tg-7b"],
    ]),
    subjectIdByKey: new Map([["matematika", "subj-math"]]),
    employeeIdByCode: new Map(),
    employeeIdByName: new Map(),
  };

  it("parses roles, homeroom and assignment lists", () => {
    const [r] = parseEmployeeRows(
      [
        row({
          lastName: "Demo",
          firstName: "Ustoz",
          roles: "teacher, CLASS_TEACHER",
          homeroomClass: "7-A",
          assignments: "Matematika: 7-A, 7-B",
        }),
      ],
      ctx,
    );
    expect(r!.status).toBe("OK");
    expect(r!.data.roles).toEqual(["TEACHER", "CLASS_TEACHER"]);
    expect(r!.data.homeroomClassId).toBe("class-7a");
    expect(r!.data.assignments.map((a) => a.teachingGroupId)).toEqual(["tg-7a", "tg-7b"]);
  });

  it("refuses privileged or unknown roles and unknown subjects", () => {
    const [r] = parseEmployeeRows(
      [row({ lastName: "D", firstName: "D", roles: "SUPER_ADMIN, WIZARD", assignments: "Kimyo: 7-A" })],
      ctx,
    );
    expect(r!.messages.map((m) => m.code)).toEqual(expect.arrayContaining(["UNKNOWN_ROLE", "UNKNOWN_SUBJECT"]));
  });
});
