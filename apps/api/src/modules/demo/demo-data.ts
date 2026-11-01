// Synthetic demo school (Q-30): invented names, phones on the unused "+998 00" operator code, so no row can belong to
// a real person. Pure and deterministic — the same rows on every run. Rows use the import template's column keys, so
// they go through the same parsers and commit code as an Excel import.
import type { SheetRow } from "../imports/excel";

export const DEMO_YEAR = { name: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" } as const;

/** 10 classes; 1–4 have no student logins by default (minGrade 5), which the demo should show too. */
export const DEMO_CLASSES = ["1-A", "2-A", "3-A", "4-A", "5-A", "5-B", "6-A", "7-A", "8-A", "9-A"] as const;
export const STUDENTS_PER_CLASS = 30;
export const TEACHER_COUNT = 40;

export const DEMO_SUBJECTS = [
  "Matematika",
  "Ona tili",
  "Ingliz tili",
  "Rus tili",
  "Tarix",
  "Biologiya",
  "Fizika",
  "Kimyo",
  "Informatika",
  "Jismoniy tarbiya",
] as const;

const LAST = [
  "Aliyev",
  "Karimov",
  "Rahimov",
  "Usmonov",
  "Yusupov",
  "Nazarov",
  "Saidov",
  "Tursunov",
  "Qodirov",
  "Ergashev",
];
const FIRST_M = ["Aziz", "Bekzod", "Doniyor", "Jasur", "Otabek", "Sardor", "Temur", "Umid", "Shohruh", "Islom"];
const FIRST_F = [
  "Aziza",
  "Dilnoza",
  "Gulnora",
  "Kamola",
  "Madina",
  "Nilufar",
  "Sevara",
  "Zarina",
  "Malika",
  "Shahnoza",
];
const pad = (n: number, w: number) => String(n).padStart(w, "0");
/** Feminine surname form: Aliyev → Aliyeva. */
const fem = (last: string) => `${last}a`;
/** "+998 00 …" — no operator uses code 00. */
export const demoPhone = (n: number) => `+99800${pad(n, 7)}`;

const rows = (values: Record<string, string>[]): SheetRow[] => values.map((v, i) => ({ rowNumber: i + 3, values: v }));

export const subjectRows = () => rows(DEMO_SUBJECTS.map((name) => ({ name })));

export const classRows = () =>
  rows(
    DEMO_CLASSES.map((c) => {
      const [level, section] = c.split("-");
      return { level: level!, section: section!, capacity: String(STUDENTS_PER_CLASS + 2) };
    }),
  );

/**
 * 40 teachers. The first 10 are class teachers of the 10 classes. Every class gets every subject from exactly one
 * teacher: teacher k teaches subject k % 10 in the classes c with c % 4 === floor(k / 10), i.e. 2–3 classes each.
 */
export function teacherRows(): SheetRow[] {
  return rows(
    Array.from({ length: TEACHER_COUNT }, (_, k) => {
      const female = k % 3 !== 0;
      const subject = DEMO_SUBJECTS[k % DEMO_SUBJECTS.length]!;
      const band = Math.floor(k / DEMO_SUBJECTS.length); // 0..3
      const classes = DEMO_CLASSES.filter((_, c) => c % 4 === band);
      const last = LAST[(k * 7) % LAST.length]!;
      return {
        employeeCode: `DEMO-T${pad(k + 1, 3)}`,
        lastName: female ? fem(last) : last,
        firstName: (female ? FIRST_F : FIRST_M)[(k * 3) % 10]!,
        phone: demoPhone(9_000_000 + k),
        positionTitle: "O'qituvchi",
        roles: k < DEMO_CLASSES.length ? "TEACHER, CLASS_TEACHER" : "TEACHER",
        homeroomClass: k < DEMO_CLASSES.length ? DEMO_CLASSES[k]! : "",
        assignments: `${subject}: ${classes.join(", ")}`,
      };
    }),
  );
}

/** 300 students, two guardians each (mother and father share the child's surname). */
export function studentRows(): SheetRow[] {
  return rows(
    Array.from({ length: DEMO_CLASSES.length * STUDENTS_PER_CLASS }, (_, i) => {
      const c = Math.floor(i / STUDENTS_PER_CLASS);
      const level = Number(DEMO_CLASSES[c]!.split("-")[0]);
      const female = i % 2 === 1;
      const last = LAST[(i * 3 + c) % LAST.length]!;
      const birthYear = 2026 - 7 - level + 1;
      return {
        lastName: female ? fem(last) : last,
        firstName: (female ? FIRST_F : FIRST_M)[(i * 7 + c) % 10]!,
        dateOfBirth: `${birthYear}-${pad((i % 12) + 1, 2)}-${pad((i % 28) + 1, 2)}`,
        gender: female ? "A" : "E",
        className: DEMO_CLASSES[c]!,
        guardian1LastName: fem(last),
        guardian1FirstName: FIRST_F[(i + 3) % 10]!,
        guardian1Phone: demoPhone(1_000_000 + i * 2),
        guardian1Relation: "ona",
        guardian2LastName: last,
        guardian2FirstName: FIRST_M[(i + 5) % 10]!,
        guardian2Phone: demoPhone(1_000_000 + i * 2 + 1),
        guardian2Relation: "ota",
      };
    }),
  );
}
