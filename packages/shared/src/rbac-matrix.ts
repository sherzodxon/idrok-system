import { PERMISSIONS } from "./permissions";
import { ROLE_DEFAULT_PERMISSIONS, ROLE_SCOPE_NOTES } from "./role-defaults";
import { SYSTEM_ROLES } from "./roles";

const ROLE_LABELS: Record<(typeof SYSTEM_ROLES)[number], string> = {
  SUPER_ADMIN: "Super admin",
  SCHOOL_ADMIN: "Admin",
  DIRECTOR: "Direktor",
  DEPUTY_DIRECTOR: "Dir. o'rinbosari",
  METHODIST: "Uslubchi",
  TEACHER: "O'qituvchi",
  CLASS_TEACHER: "Sinf rahbari",
  STUDENT: "O'quvchi",
  GUARDIAN: "Vasiy",
};

export function renderRbacMatrix(): string {
  const roles = SYSTEM_ROLES;
  const lines: string[] = [
    "# RBAC matritsasi (M1)",
    "",
    "> Generatsiya qilingan fayl: `pnpm --filter @idrok/shared rbac:matrix > docs/architecture/rbac-matrix.md`.",
    "> Manba — `packages/shared/src/role-defaults.ts`; test fayl kod bilan mosligini tekshiradi.",
    "> Bu tizim rollarining **boshlang'ich** to'plami: maktab admini rollarni o'zgartira oladi (`roles.manage`).",
    "> Ruxsat — \"qaysi amal\"; ma'lumot doirasi (qaysi o'quvchilar) servislarda alohida tekshiriladi (pastdagi jadval).",
    "",
    `| Ruxsat | Modul | ${roles.map((r) => ROLE_LABELS[r]).join(" | ")} |`,
    `|---|---|${roles.map(() => ":-:").join("|")}|`,
  ];
  for (const p of PERMISSIONS) {
    const cells = roles.map((r) => (ROLE_DEFAULT_PERMISSIONS[r].includes(p.code) ? "✓" : ""));
    lines.push(`| \`${p.code}\` | ${p.module} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Ma'lumot doirasi", "", "| Rol | Kod | Doira |", "|---|---|---|");
  for (const r of roles) lines.push(`| ${ROLE_LABELS[r]} | \`${r}\` | ${ROLE_SCOPE_NOTES[r]} |`);
  lines.push("");
  return lines.join("\n");
}
