// Excel import column definitions. Labels live in ./labels.{uz,ru}.ts (translation files); the template stores the
// column keys in a hidden first row, so imports do not depend on the language of the headers (lesson-plan.md §4.2).

export type ImportKindCode =
  "STUDENTS_GUARDIANS" | "EMPLOYEES_ASSIGNMENTS" | "CLASS_GROUPS" | "SUBJECTS" | "CURRICULUM_PLAN" | "QUESTIONS";

export interface ImportColumn {
  key: string;
  required?: boolean;
  width?: number;
}

export const IMPORT_COLUMNS: Record<ImportKindCode, readonly ImportColumn[]> = {
  STUDENTS_GUARDIANS: [
    { key: "studentCode", width: 12 },
    { key: "lastName", required: true, width: 18 },
    { key: "firstName", required: true, width: 16 },
    { key: "middleName", width: 18 },
    { key: "dateOfBirth", width: 14 },
    { key: "gender", width: 8 },
    { key: "className", required: true, width: 8 },
    { key: "phone", width: 16 },
    { key: "address", width: 24 },
    { key: "createAccount", width: 10 },
    { key: "guardian1LastName", width: 18 },
    { key: "guardian1FirstName", width: 16 },
    { key: "guardian1Phone", width: 16 },
    { key: "guardian1Relation", width: 12 },
    { key: "guardian2LastName", width: 18 },
    { key: "guardian2FirstName", width: 16 },
    { key: "guardian2Phone", width: 16 },
    { key: "guardian2Relation", width: 12 },
  ],
  EMPLOYEES_ASSIGNMENTS: [
    { key: "employeeCode", width: 12 },
    { key: "lastName", required: true, width: 18 },
    { key: "firstName", required: true, width: 16 },
    { key: "middleName", width: 18 },
    { key: "phone", width: 16 },
    { key: "positionTitle", width: 18 },
    { key: "roles", width: 22 },
    { key: "homeroomClass", width: 10 },
    { key: "assignments", width: 40 },
  ],
  CLASS_GROUPS: [
    { key: "level", required: true, width: 10 },
    { key: "section", required: true, width: 10 },
    { key: "capacity", width: 10 },
    { key: "homeroomEmployeeCode", width: 14 },
  ],
  SUBJECTS: [
    { key: "name", required: true, width: 24 },
    { key: "shortName", width: 12 },
    { key: "code", width: 10 },
  ],
  // lesson-plan.md §4.2: № and date are information from the timetable (ROWS mode) and are not imported; the period,
  // when it names one, binds the topic to it.
  CURRICULUM_PLAN: [
    { key: "lessonNo", width: 6 },
    { key: "periodName", width: 14 },
    { key: "lessonDate", width: 12 },
    { key: "topic", required: true, width: 48 },
    { key: "hours", required: true, width: 8 },
    { key: "lessonType", width: 18 },
    { key: "objectives", width: 30 },
    { key: "homework", width: 30 },
    { key: "resources", width: 24 },
    { key: "notes", width: 24 },
  ],
  // tests.md §3: Savol | Turi | A–F | To'g'ri javob | Ball | Mavzu | Qiyinlik | Izoh (MATCHING only in the UI).
  QUESTIONS: [
    { key: "question", required: true, width: 48 },
    { key: "questionType", width: 16 },
    { key: "optionA", width: 20 },
    { key: "optionB", width: 20 },
    { key: "optionC", width: 20 },
    { key: "optionD", width: 20 },
    { key: "optionE", width: 20 },
    { key: "optionF", width: 20 },
    { key: "correct", required: true, width: 16 },
    { key: "points", width: 8 },
    { key: "questionTopic", width: 28 },
    { key: "difficulty", width: 12 },
    { key: "explanation", width: 30 },
  ],
};

export const RELATION_ALIASES: Record<string, "MOTHER" | "FATHER" | "GRANDPARENT" | "SIBLING" | "OTHER"> = {
  ona: "MOTHER",
  mother: "MOTHER",
  мать: "MOTHER",
  ota: "FATHER",
  father: "FATHER",
  отец: "FATHER",
  buvi: "GRANDPARENT",
  bobo: "GRANDPARENT",
  бабушка: "GRANDPARENT",
  дедушка: "GRANDPARENT",
  aka: "SIBLING",
  opa: "SIBLING",
  брат: "SIBLING",
  сестра: "SIBLING",
  boshqa: "OTHER",
  другое: "OTHER",
};
