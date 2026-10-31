# Idrok System — Roadmap

Har bosqich oxirida ishlaydigan, test qilingan natija bo'ladi. Keyingi bosqichga oldingisining acceptance criteria'si to'liq bajarilgandan keyin o'tiladi.

Umumiy "Done" ta'rifi (har bosqich uchun):
- `lint`, `typecheck`, `test`, `build` o'tadi.
- Yangi endpointlar OpenAPI'da hujjatlangan va permission bilan himoyalangan.
- Yangi UI matnlari `uz` va `ru`da bor.
- `docs/progress/Mx.md` yozilgan.

---

## M0 — Audit va arxitektura (kod yozilmaydi)

**Maqsad:** EdexTest mantig'ini o'rganish va yakuniy arxitekturani tasdiqlashga tayyorlash.

Natijalar (`docs/architecture/`):
- `edextest-audit.md` — qayta ishlatiladigan mantiq, kamchiliklar, saboqlar.
- `architecture.md` — monorepo, servislar, deploy sxemasi.
- `data-model.md` + `schema.draft.prisma` — M1–M5 modellari, munosabatlar, indekslar.
- `api-plan.md` — M1–M5 endpointlari.
- `ui-structure.md` — rollar bo'yicha navigatsiya va sahifalar.
- `open-questions.md` — maktab qarori kerak bo'lgan masalalar.

**Acceptance:** egasi hujjatlarni ko'rib tasdiqlaydi.

---

## M1 — Core platforma

Scope:
- Monorepo scaffold, CI (GitHub Actions: lint/typecheck/test/build).
- Tenant, SchoolSettings, SchoolBranding (runtime CSS variables, LIGHT/DARK/SYSTEM).
- Auth: login/logout, refresh rotation, cookie + bearer rejim, parolni almashtirish, login rate limit, birinchi kirishda parol almashtirish.
- RBAC: Role, Permission, UserRole (bir foydalanuvchida bir nechta rol).
- AcademicYear, Grade (parallel: 7-sinf), ClassGroup (7-A), TeachingGroup (sinf yoki guruhcha), Subject, TeacherAssignment.
- Student, Guardian, StudentGuardian, Employee (minimal: o'qituvchi uchun yetarli).
- **Excel import** (preview → tasdiqlash): o'quvchilar + vasiylar, o'qituvchilar + biriktirishlar, sinflar, fanlar.
- i18n (`uz`, `ru`), layout: collapsible sidebar, mobil drawer, rolga qarab dashboard skeleti.
- AuditLog infratuzilmasi.
- Seed skript (demo maktab).

Acceptance:
- Admin Excel orqali 300 o'quvchi va 40 o'qituvchini xatolarni ko'rib import qila oladi.
- O'qituvchi faqat o'z sinf/fanlarini, vasiy faqat o'z farzandini ko'radi (API test bilan).
- Tenant isolation testlari o'tadi.
- Brending rangini o'zgartirish butun UI'ni yangilaydi.

---

## M2 — Kalendar, dars jadvali, dars rejasi

Spec: `docs/spec/lesson-plan.md`

Scope: AcademicPeriod (chorak/yarim yillik), maktab kalendari (dam olish kunlari), qo'ng'iroq jadvali, qo'lda haftalik dars jadvali (versiyalangan), LessonSession generatsiyasi, kalendar-tematik reja (shablon + sinfga qo'llash), Excel shablon va import, tasdiqlash, mavzularni surish.

Acceptance: spec'dagi acceptance testlari.

---

## M3 — Ball engine

Spec: `docs/spec/scoring.md`

Scope: ScoreCriterion, ScoreEntry (darsga va mavzuga bog'langan), limitlar, kunlik/davriy agregatsiya, AssessmentPolicy (versiyalangan, default preset), GradeScale (5 ballik), davrni yopish va snapshot, o'qituvchi jurnali UI, o'quvchi/vasiy ko'rinishi.

Acceptance: spec'dagi hisoblash misollari unit-test sifatida o'tadi.

---

## M4 — Test tizimi

Spec: `docs/spec/tests.md`

Scope: savollar banki (mavzu teglari, Excel import), online test (autosave, server taymer, anti-cheat, retake), offline test, weighted test → davriy baho, statistika.

---

## M5 — Coin

Scope: CoinCriterion, CoinLimit, CoinTransaction (ledger), o'qituvchi faolligi, Coin Shop va buyurtmalar, coin debt (ixtiyoriy), avtomatik coin qoidalari (test natijasi; davomat M6'dan keyin ulanadi). Hamma narsa noldan.

---

## M6 — Face ID pilot

Scope: Device, FaceProfile, FaceSyncJob, Hikvision ISAPI, webhook (qurilma bo'yicha alohida kalit), Bridge (Windows Service), SCHOOL_ATTENDANCE, kechikish oraliqlari, Face Check sahifasi.
Shart: 1 qurilma, 20 o'quvchi, 1 hafta xatosiz ishlashdan oldin kengaytirilmaydi. Biometrika production'ga chiqishidan oldin hosting va huquqiy masala hal qilinadi.

---

## M7 — Vasiy portali va Telegram

Scope: vasiy kabineti (web, mobile-first), Telegram bot, vasiyni bog'lash (contact share → telefon mosligi yoki bir martalik deep-link kod), Telegram Mini App, bildirishnomalar (davomat, ball, test, coin), SMS zaxira, ommaviy xabar.

---

## M8 — Mobil ilova

Scope: Expo ilova (o'quvchi, vasiy, o'qituvchi), push (FCM), `packages/shared`dan tiplar, OpenAPI client.

---

## Keyingi bosqichlar

- AI feedback (mavzu bo'yicha o'zlashtirish asosida, avval o'qituvchi tasdiqlaydigan rejim).
- Avtomatik dars jadvali (OR-Tools CP-SAT microservice).
- Moliya, HR va KPI, CRM, kutubxona, inventar, hisobotlar.
- Production hardening, VPS ga ko'chish.
