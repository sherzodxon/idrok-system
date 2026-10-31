# API rejasi (M1–M5)

> Base: `/api/v1`. Barcha DTO'lar `packages/shared`dagi zod sxemalardan; OpenAPI 3.1 shulardan generatsiya qilinadi (`GET /api/v1/openapi.json`, dev'da Swagger UI).
> Permission kodlari `packages/shared/src/permissions.ts`da. "Scope" ustuni — permission'dan tashqari ma'lumot darajasidagi cheklov (service `policy`).

## 1. Umumiy konvensiyalar

### 1.1. Versiyalash
- URL versiyasi: `/api/v1`. Breaking o'zgarish = `/api/v2` (eski versiya kamida bitta mobil reliz sikli yashaydi).
- Breaking emas: yangi ixtiyoriy maydon, yangi endpoint, yangi enum qiymati (klientlar noma'lum enum'ni `UNKNOWN` deb ko'rsatadi).
- CI `openapi` job'i oldingi `openapi.json` bilan diff qiladi.

### 1.2. Javob va xato formati
- Muvaffaqiyat: obyekt yoki ro'yxat formati to'g'ridan-to'g'ri (wrapper'siz).
- Xato: `{ "error": { "code": "SCORE_LIMIT_EXCEEDED", "message": "errors.scores.limitExceeded", "details": { ... } } }`.
- `code` — mashina o'qiydigan (`packages/shared/src/errors.ts` ro'yxati), `message` — tarjima kaliti, `details` — kalit parametrlari.

| HTTP | Qachon | Misol `code` |
|---|---|---|
| 400 | zod validatsiya | `VALIDATION_ERROR` (`details.fields[]: { path, code }`) |
| 401 | token yo'q/eskirgan/revoke | `AUTH_REQUIRED`, `AUTH_TOKEN_EXPIRED`, `AUTH_SESSION_REVOKED` |
| 403 | ruxsat yo'q yoki scope tashqarisida | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED` |
| 404 | topilmadi **yoki boshqa tenant** (oshkor qilinmaydi) | `NOT_FOUND` |
| 409 | holat ziddiyati | `PERIOD_CLOSED`, `ATTEMPT_DEADLINE_PASSED`, `IDEMPOTENCY_KEY_REUSED`, `VERSION_CONFLICT` |
| 422 | biznes qoidasi | `SCORE_LIMIT_EXCEEDED`, `POLICY_INVALID`, `COIN_INSUFFICIENT_BALANCE` |
| 429 | rate limit | `RATE_LIMITED` (`details.retryAfterSec`) |
| 500 | kutilmagan | `INTERNAL_ERROR` (`details.requestId`) |

### 1.3. Ro'yxatlar
- Query: `?page=1&pageSize=20&sort=lastName,-createdAt&q=matn` + modulga xos filtrlar (`classGroupId=...`). `pageSize` ≤ 100.
- Javob: `{ items, total, page, pageSize }`.
- Katta jurnal/hisobot endpointlari (gradebook, stats) pagination'siz, lekin filtr majburiy.

### 1.4. Idempotency
- Yozish endpointlari `Idempotency-Key: <uuid>` header'ini qabul qiladi (mobil va sekin tarmoq uchun tavsiya). Server natijani `IdempotencyRecord`da 24 soat saqlaydi; bir xil kalit + boshqa tana → `409 IDEMPOTENCY_KEY_REUSED`.
- Ledger yozuvlari (`POST /scores`, coin) — har item ichida `idempotencyKey` majburiy (natural unique); takror so'rov birinchi natijani `200` bilan qaytaradi (`"duplicate": true`).
- Test javobi — `clientSeq` (monoton), hodisa — `clientEventId`.

### 1.5. Auth
- Web: cookie (`idrok_at`, `idrok_rt`) + `X-CSRF-Token` (unsafe metodlar). Mobil/Telegram: `Authorization: Bearer`.
- `tenantId` hech qayerda qabul qilinmaydi.
- `mustChangePassword = true` bo'lsa faqat `/auth/*` va `GET /me` ruxsat etiladi (`403 PASSWORD_CHANGE_REQUIRED`).

### 1.6. Sana va vaqt
- Kalendar kuni: `"YYYY-MM-DD"` (`SchoolDate`). Vaqt nuqtasi: ISO 8601 UTC (`2026-10-30T04:15:00.000Z`).
- Kun ichidagi vaqt (qo'ng'iroq): `"08:30"` (Toshkent devor soati) — DB'da daqiqa.
- Decimal'lar JSON'da **string** (`"8.50"`) — aniqlik yo'qolmasligi uchun.

### 1.7. Optimistic concurrency
- Tahrirlanadigan konfiguratsiya obyektlari (`SchoolSettings`, `ScoreSettings`, DRAFT policy, DRAFT reja) `updatedAt`ni `If-Match`/`version` sifatida qabul qiladi → `409 VERSION_CONFLICT`.

## 2. M1 — Core

### 2.1. Auth va profil

| Method | Path | Permission | Tavsif | Request → Response |
|---|---|---|---|---|
| POST | `/auth/login` | — (rate limit) | Kirish | `{ username, password, clientType }` → `{ user: MeDto, mustChangePassword }` (+ cookie yoki `{ accessToken, refreshToken, expiresIn }`) |
| POST | `/auth/refresh` | — | Rotation | cookie yoki `{ refreshToken }` → yangi juftlik |
| POST | `/auth/logout` | auth | Joriy sessiyani yopish | — → 204 |
| POST | `/auth/logout-all` | auth | Barcha sessiyalar | — → 204 |
| GET | `/auth/sessions` | auth | Faol sessiyalarim | → `SessionDto[]` |
| DELETE | `/auth/sessions/:id` | auth (o'ziniki) | Sessiyani revoke | → 204 |
| POST | `/auth/change-password` | auth | Parolni almashtirish (birinchi kirishda ham) | `{ currentPassword, newPassword }` → 204 |
| GET | `/me` | auth | Profil, rollar, permission'lar, profil bog'lanishlari (studentId, guardian farzandlari, employeeId) | → `MeDto` |
| PATCH | `/me/preferences` | auth | Tema, sidebar, til, density | `PreferencesDto` → `PreferencesDto` |
| GET | `/branding` | — (ochiq) | Login sahifasi va CSS variables uchun | → `BrandingDto` (host/slug bo'yicha) |

### 2.2. Foydalanuvchilar, rollar

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET | `/users` | `users.view` | Ro'yxat (`q`, `roleCode`, `status`) |
| POST | `/users` | `users.manage` | Yaratish (profilga bog'lash bilan) → `{ user, temporaryPassword }` (bir marta) |
| GET / PATCH | `/users/:id` | `users.view` / `users.manage` | |
| POST | `/users/:id/reset-password` | `users.manage` | Yangi vaqtinchalik parol (bir marta), sessiyalar revoke, audit |
| POST | `/users/:id/disable`, `/enable` | `users.manage` | |
| PUT | `/users/:id/roles` | `roles.assign` | `{ roleIds[] }` → audit, permission versiyasi oshadi |
| GET | `/permissions` | `roles.view` | Katalog (modul bo'yicha guruhlangan) |
| GET / POST | `/roles` | `roles.view` / `roles.manage` | |
| GET / PATCH | `/roles/:id` | `roles.view` / `roles.manage` | Tizim rolining `code`i o'zgarmaydi |
| PUT | `/roles/:id/permissions` | `roles.manage` | `{ permissionCodes[] }` → audit |
| POST | `/roles/:id/archive` | `roles.manage` | |

### 2.3. Sozlamalar va brending

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET / PUT | `/settings/school` | `settings.view` / `settings.manage` | `SchoolSettingsDto` (timezone, til, hafta boshi, ...) |
| GET / PUT | `/settings/branding` | `settings.view` / `branding.manage` | Ranglar (hex validatsiya, kontrast ogohlantirishi), nomlar, tema |
| POST | `/settings/branding/logo`, `/favicon` | `branding.manage` | multipart → `FileAsset` |

### 2.4. O'quv tuzilmasi

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET / POST | `/academic-years` | `academic_years.view` / `.manage` | |
| GET / PATCH | `/academic-years/:id` | ″ | |
| POST | `/academic-years/:id/activate` | `academic_years.manage` | Bitta ACTIVE (SQL), audit |
| GET / POST | `/grades` | `class_groups.view` / `.manage` | Parallellar |
| GET / POST | `/class-groups` | `class_groups.view` / `.manage` | `?academicYearId&gradeId`; POST avtomatik CLASS TeachingGroup yaratadi |
| GET / PATCH | `/class-groups/:id` | ″ | |
| GET | `/class-groups/:id/students` | `students.view` (scope: o'qituvchi — faqat biriktirilgan) | `?date=` holatiga ko'ra |
| GET / POST | `/teaching-groups` | `class_groups.view` / `.manage` | Guruhchalar |
| PUT | `/teaching-groups/:id/members` | `class_groups.manage` | `{ add: [{studentId, validFrom}], remove: [{studentId, validTo}] }` |
| GET / POST | `/subjects` | `subjects.view` / `.manage` | |
| PATCH | `/subjects/:id` | `subjects.manage` | |
| GET | `/teacher-assignments` | `teacher_assignments.view` | `?academicYearId&teacherId&teachingGroupId&subjectId` |
| POST | `/teacher-assignments` | `teacher_assignments.manage` | |
| POST | `/teacher-assignments/:id/end` | `teacher_assignments.manage` | `{ validTo }` |

### 2.5. Odamlar

| Method | Path | Permission | Scope / tavsif |
|---|---|---|---|
| GET | `/students` | `students.view` | O'qituvchi: faqat o'z guruhlari o'quvchilari. Filtr: `classGroupId`, `status`, `q` |
| POST | `/students` | `students.create` | `studentCode` serverda |
| GET | `/students/:id` | `students.view` | Profil + joriy sinf + vasiylar. Sezgir maydonlar maskalangan |
| GET | `/students/:id/sensitive` | `students.sensitive.view` | Ochiq ko'rinish, audit yoziladi |
| PATCH | `/students/:id` | `students.update` | |
| POST | `/students/:id/enrollments` | `students.update` | Sinfga qo'shish/o'tkazish (eski enrollment yopiladi) |
| POST | `/students/:id/archive` | `students.archive` | `status = LEFT/GRADUATED` |
| POST | `/students/:id/account` | `users.manage` | Login yaratish → vaqtinchalik parol |
| GET / POST | `/guardians` | `guardians.view` / `.manage` | `q` (ism, telefon) |
| GET / PATCH | `/guardians/:id` | ″ | |
| POST | `/students/:id/guardians` | `guardians.manage` | `{ guardianId \| newGuardian, relation, isPrimary }` |
| PATCH / DELETE | `/students/:id/guardians/:guardianId` | `guardians.manage` | DELETE = `revokedAt` |
| GET / POST | `/employees` | `employees.view` / `.manage` | |
| GET / PATCH | `/employees/:id` | ″ | |

### 2.6. Import / eksport, fayllar, audit

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET | `/imports/templates/:kind` | `imports.run` | Excel shablon (foydalanuvchi tilida, yashirin texnik qator) |
| POST | `/imports` | `imports.run` | multipart `{ kind, file, options }` → `ImportJobDto` (status UPLOADED → worker parse) |
| GET | `/imports/:id` | `imports.run` | Holat + summary |
| GET | `/imports/:id/rows` | `imports.run` | `?status=ERROR\|WARNING&page=` — preview qatorlari |
| POST | `/imports/:id/commit` | `imports.run` | Faqat `PREVIEW_READY` va `errorCount = 0` (yoki `skipErrors: true`) → worker commit |
| POST | `/imports/:id/cancel` | `imports.run` | |
| POST | `/exports` | `exports.run` + modul `view` | `{ kind, filters }` → job → `FileAsset` |
| GET | `/files/:id` | obyektga bog'liq | Ruxsat tekshiruvi bilan stream yoki 302 → imzolangan URL |
| GET | `/audit-logs` | `audit_logs.view` | `?entityType&entityId&actorUserId&from&to` |
| GET | `/dashboard` | auth | Rolga qarab vidjetlar (M1 da skelet: sanoqlar) |

## 3. M2 — Kalendar, jadval, darslar, reja (`lesson-plan.md`)

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET / POST | `/academic-years/:id/periods` | `calendar.manage` (GET: `lessons.view`) | Davrlar (ierarxiya bilan) |
| PATCH | `/periods/:id` | `calendar.manage` | DRAFT'da sanalar; ACTIVE qilish → PolicyBinding (M3) |
| POST | `/periods/:id/activate` | `calendar.manage` | |
| GET / PUT | `/academic-years/:id/school-week` | `calendar.manage` | `{ workingWeekdays }` |
| GET / POST | `/academic-years/:id/calendar-days` | `calendar.manage` | `?from&to` |
| PATCH / DELETE | `/calendar-days/:id` | `calendar.manage` | O'zgarish darslarga ta'sir qilsa → "diff" kerak (pastda) |
| GET / POST | `/shifts`, `/rooms` | `calendar.manage` / `timetable.manage` | |
| GET / POST | `/academic-years/:id/bell-schedules` | `calendar.manage` | slotlar bilan |
| GET / POST | `/academic-years/:id/timetables` | `timetable.view` / `.manage` | Yangi DRAFT (oldingi versiyadan nusxa ixtiyoriy) |
| GET | `/timetables/:id` | `timetable.view` | `?view=class\|teacher\|room&id=` |
| PUT | `/timetables/:id/entries` | `timetable.manage` | DRAFT: bulk upsert → `{ entries, conflicts[] }` (o'qituvchi/guruh/xona bir vaqtda) |
| POST | `/timetables/:id/publish` | `timetable.publish` | `{ validFrom }` → generatsiya diff preview qaytaradi |
| POST | `/academic-years/:id/lesson-generation/preview` | `timetable.publish` | Kalendar/jadval o'zgarishidan keyin: `{ add[], cancel[], keep, blocked[] }` |
| POST | `/academic-years/:id/lesson-generation/apply` | `timetable.publish` | `{ previewHash }` → job; audit |
| GET | `/lesson-sessions` | `lessons.view` (scope: o'qituvchi — o'ziniki) | `?teachingGroupId&subjectId&from&to&teacherId` |
| GET | `/me/lessons/today` | `lessons.view` | "Bugungi darslarim" (mavzu bilan) |
| POST | `/lesson-sessions` | `timetable.manage` | MANUAL sessiya |
| POST | `/lesson-sessions/:id/held` | `lessons.mark` (scope) | `{ planItemId?, actualTopicNote? }` |
| POST | `/lesson-sessions/:id/cancel` | `timetable.manage` | `{ reason }` → reflow taklifi |
| GET | `/reports/lesson-counts` | `curriculum.view` | "Rejada 18 soat, jadvalda 17 dars" |
| GET | `/topics` | `curriculum.view` | `?subjectId&gradeId&q` |
| POST | `/topics` | `curriculum.create` | |
| GET / POST | `/curriculum-plans` | `curriculum.view` / `curriculum.create` (scope: o'z fanlari) | `?academicYearId&subjectId&gradeId&status` |
| GET / PUT | `/curriculum-plans/:id` | ″ | PUT faqat DRAFT: `{ title, items[] }` |
| POST | `/curriculum-plans/:id/new-version` | `curriculum.create` | APPROVED → yangi DRAFT |
| POST | `/curriculum-plans/:id/submit` | `curriculum.create` | `planApprovalRequired=false` → avtomatik APPROVED |
| POST | `/curriculum-plans/:id/approve`, `/reject` | `curriculum.approve` | reject: `{ note }` |
| GET | `/curriculum-plans/template` | `curriculum.export` | `?academicYearId&subjectId&teachingGroupId\|gradeId` → .xlsx |
| POST | `/curriculum-plans/import` | `curriculum.create` | ImportJob (`kind=CURRICULUM_PLAN`, `mode: ROWS\|TOPICS`) |
| POST | `/curriculum-plans/:id/assignments` | `curriculum.create` | `{ teachingGroupIds[] }` → joylash preview + ogohlantirishlar |
| POST | `/plan-assignments/:id/reflow/preview`, `/apply` | `curriculum.create` | §4.6 |
| GET | `/curriculum-plans/:id/export` | `curriculum.export` | |

## 4. M3 — Ball engine (`scoring.md` §8)

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET | `/lesson-sessions/:id/journal` | `gradebook.view` (scope) | O'quvchilar, davomat, yozuvlar, har o'quvchi uchun qolgan limit (`remainingToday`) |
| PUT | `/lesson-sessions/:id/attendance` | `attendance.mark` (scope) | Bulk `[{ studentId, status, note? }]` → audit |
| POST | `/scores` | `scores.create` (scope) | `{ items: [{ lessonSessionId, studentId, criterionId?, points, note?, idempotencyKey }] }` → `{ results: [{ idempotencyKey, status: CREATED\|DUPLICATE\|REJECTED, entry?, error? }] }`. Har item alohida transaction (bitta limit xatosi boshqalarni to'xtatmaydi) |
| POST | `/scores/:id/reverse` | o'z yozuvi `lateEntryDays` ichida — `scores.create`; keyin `scores.correct` | `{ reason }` → REVERSAL |
| GET | `/scores` | `gradebook.view` (scope) / self | `?studentId&subjectId&from&to` |
| GET | `/gradebook` | `gradebook.view` (scope) | `?teachingGroupId&subjectId&periodId` → o'quvchi × sessiya matritsasi |
| GET | `/students/:id/progress` | `assessment.view` yoki self/guardian scope | `?view=DAY\|WEEK\|MONTH\|PERIOD&date=` → fanlar foizi, umumiy (`dailyView`ga qarab), grafik nuqtalari |
| GET / POST | `/assessment/policies` | `assessment.view` / `.manage` | |
| POST | `/assessment/policies/:id/versions` | `assessment.manage` | DRAFT versiya `{ config }` |
| PUT | `/assessment/policy-versions/:id` | `assessment.manage` | faqat DRAFT |
| POST | `/assessment/policy-versions/:id/validate` | `assessment.manage` | `{ valid, issues[] }` (komponentlar yig'indisi, bandlar) — UI jonli tekshiruvi uchun |
| POST | `/assessment/policy-versions/:id/publish` | `assessment.manage` | validatsiya + muzlatish |
| POST | `/periods/:id/bind-policy` | `assessment.manage` | `{ policyVersionId, subjectId?, reason }` — faol davrga qo'llash, DRAFT'lar qayta hisob |
| POST | `/periods/:id/prepare-close` | `assessment.approve` | → `PeriodCloseRun` (to'liqmaslik hisoboti) |
| POST | `/periods/:id/close` | `assessment.approve` | `{ closeRunId }` → CLOSED, FINAL, audit |
| POST | `/periods/:id/recompute` | `assessment.reopen` | `{ studentIds?, subjectIds?, reason }` → yangi FINAL version |
| GET | `/period-results` | `assessment.view` (scope) | `?periodId&teachingGroupId&subjectId` |
| GET | `/reports/missing-scores` | `assessment.view` | "Kim ball qo'ymagan" (o'qituvchi bo'yicha PENDING sessiyalar) |
| CRUD | `/score-criteria` | `assessment.manage` | |
| CRUD | `/score-limit-rules` | `assessment.manage` | DELETE = `isActive=false` |
| GET / PUT | `/settings/scores` | `assessment.manage` | `ScoreSettings` |
| CRUD | `/grade-scales` | `assessment.manage` | bandlar validatsiyasi |
| PUT | `/periods/:id/manual-scores` | `assessment.manual.enter` (scope) | `[{ studentId, subjectId, componentKey, points }]` (Q-12) |

## 5. M4 — Test tizimi (`tests.md` §9)

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET | `/question-bank/questions` | `questions.manage` | O'z banki + `sharedWithSubject`. `?subjectId&gradeId&topicId&noTopic&difficulty&type&q` |
| POST | `/question-bank/questions` | `questions.manage` | savol + 1-versiya |
| GET | `/question-bank/questions/:id` | ″ | versiyalar bilan |
| PUT | `/question-bank/questions/:id` | `questions.manage` (egasi) | yangi versiya |
| POST | `/question-bank/questions/:id/archive` | ″ | |
| POST | `/question-bank/import` | `questions.manage` | ImportJob (`QUESTIONS`): preview (dublikat, noto'g'ri javob) → commit |
| GET | `/question-bank/export` | `questions.manage` | |
| GET | `/question-bank/used-in-group` | `questions.manage` | `?teachingGroupId&questionIds[]` → "avval berilgan" |
| CRUD | `/test-types` | `test_types.manage` | |
| GET | `/tests` | `tests.create` (o'zi + hamkasblar fan bo'yicha) / `tests.results.view` | `?subjectId&gradeId&status&format&purpose` |
| POST | `/tests` | `tests.create` | DRAFT |
| GET / PUT | `/tests/:id` | `tests.create` (egasi) | PUT faqat DRAFT (vaqtlar — CLOSED bo'lmaguncha, §5) |
| PUT | `/tests/:id/questions` | `tests.create` | `{ manual: [{questionVersionId, points}] } \| { pool: rules }` |
| PUT | `/tests/:id/assignments` | `tests.create` | `{ teachingGroupIds[], studentIds[] }` |
| POST | `/tests/:id/publish` | `tests.publish` | Server validatsiyasi (§4.1) → SCHEDULED/OPEN + delayed job'lar |
| POST | `/tests/:id/close` | `tests.publish` | Qo'lda yopish; IN_PROGRESS → `ADMIN_CLOSED` |
| PATCH | `/tests/:id/schedule` | `tests.publish` | `{ startsAt?, endsAt?, applyToInProgress?: boolean, reason }` |
| POST | `/tests/:id/overrides` | `tests.reopen` | `{ studentIds[], startsAt, endsAt, timeLimitMinutes?, reason }` |
| DELETE | `/tests/:id/overrides/:overrideId` | `tests.reopen` | `cancelledAt` |
| GET | `/me/tests` | `tests.take` | O'quvchi: fanlar bo'yicha holatlar (boshlanmagan / ochiq / davom etmoqda / yakunlangan / qayta ochilgan) |
| POST | `/tests/:id/start` | `tests.take` (assigned) | Idempotent → `AttemptDto` (savollar javobsiz, `deadline`, `serverNow`, saqlangan javoblar, `currentIndex`) |
| GET | `/attempts/:id` | egasi | Lazy finalize; `AttemptDto` |
| PUT | `/attempts/:id/answers/:testQuestionId` | egasi | `{ answer, clientSeq }` → `{ savedAt }` / `409 ATTEMPT_DEADLINE_PASSED` / `409 STALE_CLIENT_SEQ` (e'tiborsiz) |
| PUT | `/attempts/:id/position` | egasi | `{ currentIndex }` |
| POST | `/attempts/:id/events` | egasi | `{ clientEventId, type, clientTs }` → `{ counted, violationCount, remaining, finished? }` |
| POST | `/attempts/:id/submit` | egasi | `{}` (finishReason qabul qilinmaydi) → `AttemptResultDto` (`showResultToStudent`ga qarab; to'g'ri javoblar `revealCorrectAnswers` bo'lmasa yo'q) |
| POST | `/attempts/:id/reopen` | `tests.reopen` | `{ deadline \| extraMinutes, reason }` → audit |
| GET | `/tests/:id/results` | `tests.results.view` (scope) | o'quvchilar, ball, foiz, finishReason, buzilishlar |
| GET | `/tests/:id/attempts/:attemptId` | `tests.results.view` | to'liq ko'rinish (javoblar, hodisalar jurnali) |
| PUT | `/tests/:id/offline-results` | `tests.results.enter` (scope) | Bulk `[{ studentId, status, rawScore? }]` → `{ saved, notEntered[] }` |
| GET | `/tests/:id/stats`, `/tests/:id/questions-stats` | `tests.results.view` | §8 |
| GET | `/tests/:id/results/export` | `tests.results.view` | `?scales=5,10` |
| GET | `/students/:id/topic-mastery` | `tests.results.view` / self / guardian | `?subjectId` |
| GET | `/students/:id/tests` | ″ | o'quvchi profilidagi test tarixi |

## 6. M5 — Coin

| Method | Path | Permission | Tavsif |
|---|---|---|---|
| GET / PUT | `/coins/settings` | `coins.settings.manage` | `CoinSettings` (audit) |
| CRUD | `/coins/criteria` | `coins.criteria.manage` | DELETE → `isActive=false` (tranzaksiyasi bo'lsa) |
| PUT | `/coins/criteria/:id/teachers` | `coins.criteria.manage` | `{ teacherIds[] }` |
| CRUD | `/coins/limits` | `coins.limits.manage` | DELETE → `isActive=false` |
| POST | `/coins/transactions` | `coins.give` (scope: biriktirilgan o'quvchi, mezon ruxsati) | `{ studentId, criterionId, type?, amount, idempotencyKey }` → `{ transaction, balance }` / `422 COIN_LIMIT_EXCEEDED { reasons[] }` |
| POST | `/coins/adjustments` | `coins.adjust` | `{ studentId, amount, reason, idempotencyKey }` |
| POST | `/coins/transactions/:id/reverse` | `coins.reverse` | `{ reason }` |
| POST | `/coins/transactions/:id/correct` | `coins.reverse` | `{ amount, reason }` (faqat kamaytirish) |
| GET | `/coins/transactions` | `coins.view` | `?studentId&teacherId&criterionId&type&from&to` |
| GET | `/coins/students/:id/summary` | `coins.view` / self / guardian | balans, yig'ilgan, jarima, sarflangan, grafik |
| GET | `/coins/teacher/students` | `coins.give` | o'qituvchining o'quvchilari + balans + qolgan limit |
| GET | `/coins/teacher/students/:id/capacity` | `coins.give` | `remainingCapacity` |
| GET | `/coins/overview/*` | `coins.view` | summary, breakdown (o'qituvchi/mezon/fan), ranking, teacher activity |
| GET | `/coins/audit` | `coins.view` + `audit_logs.view` | |
| CRUD | `/coin-shop/products` | `coin_shop.manage` | rasm FileAsset |
| GET | `/coin-shop/catalog` | `coin_shop.order` | o'quvchi: ko'rinadigan, "menga yetadi" |
| POST | `/coin-shop/orders` | `coin_shop.order` | `{ productId, idempotencyKey }` → PENDING + PURCHASE tranzaksiya (zaxira va balans lock ostida) |
| POST | `/coin-shop/orders/:id/cancel` | egasi (PENDING) | REFUND |
| GET | `/coin-shop/orders` | `coin_orders.process` / self | `?status` |
| POST | `/coin-shop/orders/:id/approve`, `/reject`, `/deliver` | `coin_orders.process` | reject → REFUND |
| CRUD | `/coins/auto-rules` | `coins.settings.manage` | TEST_RESULT qoidalari |

## 7. Permission katalogi (boshlang'ich)

| Modul | Kodlar |
|---|---|
| users/roles | `users.view`, `users.manage`, `roles.view`, `roles.manage`, `roles.assign` |
| settings | `settings.view`, `settings.manage`, `branding.manage` |
| structure | `academic_years.view`, `academic_years.manage`, `class_groups.view`, `class_groups.manage`, `subjects.view`, `subjects.manage`, `teacher_assignments.view`, `teacher_assignments.manage` |
| people | `students.view`, `students.create`, `students.update`, `students.archive`, `students.sensitive.view`, `guardians.view`, `guardians.manage`, `employees.view`, `employees.manage` |
| infra | `imports.run`, `exports.run`, `audit_logs.view` |
| M2 | `calendar.manage`, `timetable.view`, `timetable.manage`, `timetable.publish`, `lessons.view`, `lessons.mark`, `curriculum.view`, `curriculum.create`, `curriculum.approve`, `curriculum.export` |
| M3 | `attendance.mark`, `scores.create`, `scores.correct`, `scores.late_entry`, `gradebook.view`, `assessment.view`, `assessment.manage`, `assessment.manual.enter`, `assessment.approve`, `assessment.reopen` |
| M4 | `questions.manage`, `tests.create`, `tests.publish`, `tests.reopen`, `tests.results.view`, `tests.results.enter`, `test_types.manage`, `tests.take` |
| M5 | `coins.view`, `coins.give`, `coins.adjust`, `coins.reverse`, `coins.settings.manage`, `coins.criteria.manage`, `coins.limits.manage`, `coin_shop.manage`, `coin_shop.order`, `coin_orders.process` |
| portal | `portal.student`, `portal.guardian` (self-scope endpointlari: `/me/*`, `/students/:id/progress` faqat o'zi/farzandi) |

Spec'larga qo'shilganlar: `attendance.mark` (spec §8 da davomat ruxsati yo'q edi), `assessment.manual.enter`, `tests.take`, `students.sensitive.view`, M1 va M5 kodlari (spec'da ro'yxat yo'q).
