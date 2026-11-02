# RBAC matritsasi (M1)

> Generatsiya qilingan fayl: `pnpm --filter @idrok/shared rbac:matrix > docs/architecture/rbac-matrix.md`.
> Manba — `packages/shared/src/role-defaults.ts`; test fayl kod bilan mosligini tekshiradi.
> Bu tizim rollarining **boshlang'ich** to'plami: maktab admini rollarni o'zgartira oladi (`roles.manage`).
> Ruxsat — "qaysi amal"; ma'lumot doirasi (qaysi o'quvchilar) servislarda alohida tekshiriladi (pastdagi jadval).

| Ruxsat | Modul | Super admin | Admin | Direktor | Dir. o'rinbosari | Uslubchi | O'qituvchi | Sinf rahbari | O'quvchi | Vasiy |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `users.view` | users | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `users.manage` | users | ✓ | ✓ |  |  |  |  |  |  |  |
| `roles.view` | roles | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `roles.manage` | roles | ✓ | ✓ |  |  |  |  |  |  |  |
| `roles.assign` | roles | ✓ | ✓ |  |  |  |  |  |  |  |
| `settings.view` | settings | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `settings.manage` | settings | ✓ | ✓ |  |  |  |  |  |  |  |
| `branding.manage` | settings | ✓ | ✓ |  |  |  |  |  |  |  |
| `academic_years.view` | structure | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `academic_years.manage` | structure | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `class_groups.view` | structure | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `class_groups.manage` | structure | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `subjects.view` | structure | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `subjects.manage` | structure | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `teacher_assignments.view` | structure | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `teacher_assignments.manage` | structure | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `students.view` | people | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `students.create` | people | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `students.update` | people | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `students.archive` | people | ✓ | ✓ |  |  |  |  |  |  |  |
| `guardians.view` | people | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  |  |
| `guardians.manage` | people | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `employees.view` | people | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| `employees.manage` | people | ✓ | ✓ |  |  |  |  |  |  |  |
| `imports.run` | infra | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `exports.run` | infra | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |  |
| `audit_logs.view` | infra | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |
| `calendar.manage` | calendar | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `timetable.view` | calendar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `timetable.manage` | calendar | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `timetable.publish` | calendar | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `lessons.view` | calendar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `lessons.mark` | calendar | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `curriculum.view` | curriculum | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `curriculum.create` | curriculum | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `curriculum.approve` | curriculum | ✓ | ✓ |  | ✓ | ✓ |  |  |  |  |
| `curriculum.export` | curriculum | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `scores.create` | assessment | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `scores.correct` | assessment | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `scores.late_entry` | assessment | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `gradebook.view` | assessment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `assessment.view` | assessment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `assessment.manage` | assessment | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `assessment.manual_entry` | assessment | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `assessment.approve` | assessment | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `assessment.reopen` | assessment | ✓ | ✓ |  |  |  |  |  |  |  |
| `questions.manage` | tests | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `questions.export` | tests | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `tests.create` | tests | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `tests.publish` | tests | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `tests.reopen` | tests | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `tests.results.view` | tests | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `tests.results.enter` | tests | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |
| `test_types.manage` | tests | ✓ | ✓ |  | ✓ |  |  |  |  |  |
| `portal.student` | portal |  |  |  |  |  |  |  | ✓ |  |
| `portal.guardian` | portal |  |  |  |  |  |  |  |  | ✓ |

## Ma'lumot doirasi

| Rol | Kod | Doira |
|---|---|---|
| Super admin | `SUPER_ADMIN` | Platforma texnik admini (seed orqali). Maktab ma'lumoti bo'yicha SCHOOL_ADMIN bilan bir xil |
| Admin | `SCHOOL_ADMIN` | Butun maktab |
| Direktor | `DIRECTOR` | Butun maktab, faqat ko'rish va eksport |
| Dir. o'rinbosari | `DEPUTY_DIRECTOR` | Butun maktab; foydalanuvchi va rollarni boshqarmaydi |
| Uslubchi | `METHODIST` | Butun maktab: o'quv tuzilmasi va jadvalni ko'rish, dars rejalarini tasdiqlash |
| O'qituvchi | `TEACHER` | Faqat o'ziga biriktirilgan guruhlar va ularning o'quvchilari |
| Sinf rahbari | `CLASS_TEACHER` | O'qituvchi doirasi + o'z sinfi o'quvchilari va ularning vasiylari |
| O'quvchi | `STUDENT` | Faqat o'zi |
| Vasiy | `GUARDIAN` | Faqat o'z farzand(lar)i (`StudentGuardian`, `canViewData`) |

Maktab yaratgan (tizimdan tashqari) rollar butun maktab doirasida ishlaydi — ruxsatlar to'plami bilan cheklanadi.
Bir nechta roli bor foydalanuvchida eng keng doira amal qiladi (masalan O'qituvchi + Direktor → butun maktab).
