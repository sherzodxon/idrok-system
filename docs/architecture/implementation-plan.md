# Amalga oshirish rejasi

> Har qadam — alohida PR, oxirida `pnpm lint && pnpm typecheck && pnpm test && pnpm build` yashil.
> Bosqich oxirida `docs/progress/Mx.md`. Acceptance — `ROADMAP.md` va spec'lar.

## M1 — Core platforma (8 qadam)

### 1. Monorepo scaffold va CI
- **Nima:** pnpm workspaces + Turborepo; `apps/web`, `apps/api`, `apps/worker`, `packages/{shared,db,config}`; TypeScript strict, ESLint (boundary qoidalari, `no-restricted-syntax` sana/rang taqiqlari), Prettier; Vitest; `docker-compose.yml` (postgres:16, redis:7); `.env.example`; GitHub Actions (lint/typecheck/unit/integration/build); Prisma versiyasini tanlash (6.x vs 7.x — Supabase pooler + interactive transaction + `pg_advisory_xact_lock` smoke testi).
- **Tekshiruv:** CI yashil; `pnpm dev` uchala ilovani ko'taradi; `/api/v1/healthz`, `/readyz` (DB+Redis) 200; lint taqiqlangan namunani (`bg-[#fff]`, `new Date().getDate()`) haqiqatan ushlaydi (lint testi).

### 2. `packages/shared` asoslari va DB poydevori
- **Nima:** `time` (SchoolDate API, `architecture.md` §7), `decimal` (yaxlitlash), `errors` (kodlar), `permissions`, `roles`, `text.normalize`; `packages/db`: M1 modellari (Tenant, Settings, Branding, User, AuthSession, Role/Permission, AuditLog, FileAsset, ImportJob/Row, IdempotencyRecord, OutboxEvent), birinchi migratsiya + SQL invariantlar, tenant extension, invariantlar testi.
- **Tekshiruv:** `time` unit testlari `TZ=UTC` va `TZ=Asia/Tashkent` matritsasida (23:30/00:30 chegaralari, oy/hafta oralig'i); tenant extension testlari (kontekstsiz so'rov → xato, begona tenant → topilmaydi, `create` tenantId'ni majburlaydi); DMMF "har model tenantId yoki allowlist" testi; SQL invariantlar mavjudligi testi.

### 3. API yadrosi: auth, RBAC, audit
- **Nima:** Express app (middleware zanjiri), ALS kontekst, xato formati, zod validatsiya, OpenAPI generatsiya; auth (login cookie/bearer, refresh rotation + reuse detection, logout/logout-all, sessiyalar, parol almashtirish, `mustChangePassword`, rate limit Redis'da), argon2id; RBAC (`requirePermission`, permission keshi va versiyasi), seed (permissions sinxroni, tizim rollari, demo tenant, admin); `AuditLog` servis (tx ichida); `IdempotencyRecord` middleware.
- **Tekshiruv:** Supertest: login → refresh → eski refresh qayta → 401 + sessiya revoke; 6-noto'g'ri urinish → 429; `mustChangePassword` bilan boshqa endpoint → 403; cookie rejimida CSRF'siz POST → 403; bearer rejimida ishlaydi; rol o'zgarsa keyingi so'rovda yangi ruxsatlar; audit yozuvi rollback bo'lganda ham yo'q (tx).

### 4. O'quv tuzilmasi va odamlar (API)
- **Nima:** AcademicYear, Grade, ClassGroup (+auto CLASS TeachingGroup), TeachingGroup/Member, Subject, Employee, TeacherAssignment, Student (studentCode generatsiyasi, sezgir maydon shifrlash), Guardian, StudentGuardian, StudentEnrollment (+ CLASS a'zolik sinxroni); ma'lumot darajasidagi policy'lar (o'qituvchi — o'z guruhlari, vasiy — o'z farzandi, o'quvchi — o'zi); ro'yxat konvensiyasi.
- **Tekshiruv:** ROADMAP acceptance: "o'qituvchi faqat o'z sinf/fanlarini, vasiy faqat o'z farzandini ko'radi" — jadvalli API testlari (ruxsatli/ruxsatsiz × har endpoint); tenant isolation testlari (A/B); enrollment o'tkazish tarixni saqlaydi; partial unique (bitta ACTIVE enrollment) poygada ham ishlaydi.

### 5. Worker, storage va Excel import
- **Nima:** `apps/worker` (BullMQ, outbox relay, retry/failed, cleanup cron); `StorageProvider` (LocalDisk + Supabase); FileAsset yuklash (MIME magic, hajm); ImportJob oqimi: shablon (uz/ru, yashirin texnik qator) → parse (worker) → preview (qator holatlari) → commit (worker, tx bo'laklari bilan) — 4 tur: o'quvchilar+vasiylar, xodimlar+biriktirishlar, sinflar, fanlar; eksport (Excel) job.
- **Tekshiruv:** 300 o'quvchi + 600 vasiy + 40 o'qituvchi fayli: preview < 30 s, xatoli qatorlar aniq sabab bilan, commit idempotent (ikki marta bosish dublikat yaratmaydi), qayta import mavjudlarni moslaydi (Q-33 qoidasi bo'yicha); worker o'chirilgan holda job navbatda kutadi va keyin bajariladi; outbox: tx rollback → hodisa yo'q.

### 6. Web shell: layout, tema, brending, i18n
- **Nima:** Next.js App Router, `next-intl` (uz/ru), tokenlar (light/dark), runtime brending (SSR'da CSS variables), ThemeToggle (LIGHT/DARK/SYSTEM, `UserPreference`), AppShell (collapsible sidebar, holat saqlanadi, mobil drawer), PortalShell (tab-bar), RoleContextSwitcher, login/parol almashtirish sahifalari, API client (cookie + CSRF, 401 → refresh → qayta), TanStack Query, umumiy komponentlar (M1 qatori `ui-structure.md` §6), QueryBoundary (loading/empty/error).
- **Tekshiruv:** Playwright: login → majburiy parol almashtirish → dashboard; brending rangini o'zgartirish butun UI'ni yangilaydi (screenshot test, ROADMAP acceptance); tema almashadi va saqlanadi; mobil 375px'da gorizontal scroll yo'q; `uz`/`ru` kalitlar tengligi CI'da.

### 7. Admin sahifalari (M1 obyektlari)
- **Nima:** Sozlamalar (maktab, brending, foydalanuvchilar, rollar va ruxsatlar matritsasi, audit jurnali); o'quv yillari, sinflar, guruhchalar, fanlar, biriktirishlar matritsasi; o'quvchilar/vasiylar/xodimlar ro'yxati + profil + drawer formalar; import ustasi va tarixi; rolga qarab dashboard skeleti (admin, o'qituvchi, o'quvchi, vasiy).
- **Tekshiruv:** Playwright: admin Excel orqali 300 o'quvchi va 40 o'qituvchini xatolarni ko'rib import qiladi (ROADMAP acceptance); har sahifada loading/empty/error holatlari (Storybook yoki komponent testlari); permission'siz menyu ko'rinmaydi.

### 8. Seed, hardening va M1 hisobot
- **Nima:** demo maktab seed (yil, 2 smena, 10 sinf, 300 o'quvchi, vasiylar, 40 o'qituvchi, biriktirishlar); xavfsizlik headerlari va CSP; log redaction testlari; staging deploy (Render api/worker/web, Supabase, Key Value `noeviction`), migratsiya pipeline; `docs/progress/M1.md`.
- **Tekshiruv:** staging'da smoke (login, ro'yxatlar, import); log'da parol/token yo'q (test); ROADMAP M1 acceptance'ning har bandi ✅ yoki ❌ bilan hisobotda.

## M2 — Kalendar, jadval, dars rejasi (yuqori daraja)

1. Davrlar, ish haftasi, kalendar kunlari, smena va qo'ng'iroq jadvali (CRUD + UI).
2. Timetable versiyalari, muharrir (sinf/o'qituvchi/xona), to'qnashuv tekshiruvi, publish.
3. `domain/lessons.generateLessonSessions` + diff (sof, spec acceptance 1–5) → preview/apply job, regeneratsiya qoidalari.
4. Topic, CurriculumPlan/PlanItem versiyalari, tasdiqlash oqimi.
5. Excel shablon + import (ikki rejim), `domain/curriculum.placeTopics` (acceptance 6, 8–10), PlanAssignment.
6. Reflow (acceptance 7), "o'tildi" belgisi, "Bugungi darslarim", o'quvchi/vasiy haftalik jadvali, "darslar soni" hisoboti; acceptance 11–12 (ruxsat, versiya).

## M3 — Ball engine

1. `domain/scoring` sof funksiyalari + spec §10 acceptance 1–16 unit testlari (birinchi bo'lib, UI'siz).
2. LessonAttendance, ScoreCriterion, ScoreSettings, ScoreLimitRule CRUD.
3. `POST /scores` (lock, limitlar, idempotency, HELD), reverse; integration acceptance 17–24 (parallel so'rovlar testi bilan).
4. AssessmentPolicy versiyalari, validate/publish, PolicyBinding, GradeScale, default preset seed.
5. Jurnal UI (GradebookGrid), telefon tez rejimi, progress endpointi va o'quvchi/vasiy sahifalari.
6. Davrni yopish (prepare → close, snapshot, stale/recompute), ManualAssessmentScore, "kim ball qo'ymagan".

## M4 — Test tizimi

1. Savollar banki (4 tur, versiyalash, mavzu, dublikat hash), Excel import/eksport.
2. Test CRUD, tanlash (qo'lda/pool), assignment, publish validatsiyasi, open/close job'lari.
3. Attempt: start (deadline, tartiblar), answers (clientSeq), events (dedupe, threshold), submit, lazy finalize + delayed job; `domain/tests.gradeAnswer`; acceptance 1–11.
4. Test yechish UI (taymer, offline navbat, navigator), natija sahifasi.
5. Override/retake, reopen, offline natija kiritish, weighted → davriy natija integratsiyasi (scoring §5.2), acceptance 12–16.
6. Statistika (test, savol, mavzu), eksport, o'quvchi profilidagi test tarixi.

## M5 — Coin

1. CoinSettings, mezonlar (+o'qituvchi ruxsati), limitlar — `domain/coins` (EdexTest limit dvigatelini `schoolDate`ga moslab) + unit testlar.
2. Tranzaksiyalar: o'qituvchi baholashi (lock, limit, qarz chegarasi), admin tuzatish, reverse/correction; parallel so'rovlar testi; `coins.reconcile` job.
3. O'qituvchi "tez baholash" UI, o'quvchi coin sahifasi, admin dashboard va tranzaksiyalar.
4. Do'kon: mahsulotlar, buyurtma (zaxira + balans lock), tasdiq/rad/topshirish, refund.
5. O'qituvchi faolligi, avtomatik coin (TEST_RESULT, `sourceRef` idempotent), audit sahifasi.

## Xavflar va kamaytirish

| # | Xavf | Ta'sir | Kamaytirish |
|---|---|---|---|
| 1 | Shaxsiy ma'lumotlarni lokalizatsiya qonuni (Render/Supabase xorijda) | Production'ga chiqish to'xtashi | Q-30: haqiqiy ma'lumot kiritishdan oldin yurist xulosasi; staging'da faqat sun'iy ma'lumot; arxitektura VPS'ga ko'chishga tayyor (Docker, StorageProvider, standart Postgres) |
| 2 | Supabase pooler (transaction rejim) + Prisma interactive transaction/advisory lock nozikliklari | Limit poygalari, "prepared statement" xatolari | M1 1-qadam smoke test; faqat `xact` lock va `SET LOCAL`; parallel limit testlari CI'da haqiqiy Postgres bilan |
| 3 | Redis eviction BullMQ job'larini yo'qotishi | Test yakunlanmay qolishi, import osilib qolishi | `noeviction`; har delayed job'ga lazy fallback; outbox; `readyz` Redis siyosatini tekshiradi |
| 4 | Biznes qoidalari aniq emas (limitlar, chorak tarkibi, ...) | M3 kechikishi | Hammasi sozlama + default preset; `open-questions.md` M3 dan oldin yopiladi |
| 5 | Jurnal UI murakkabligi va unumdorligi (30 o'quvchi × 60 sessiya) | Sekin, xatoli kiritish | Virtual grid, server tasdiqli saqlash, bulk endpoint; M3 da birinchi navbatda prototip va foydalanuvchi testi |
| 6 | Vaqt xatolari (TZ) qaytishi | Limit/hisobot xatolari | Bitta `time` modul, lint taqiqlari, TZ matritsali testlar |
| 7 | Tenant izolyatsiyasidagi bo'shliq (raw SQL, yangi model) | Ma'lumot sizishi | Fail-closed extension, DMMF qamrov testi, raw SQL faqat repository'da, A/B testlar |
| 8 | Bitta dasturchi + Claude: scope kengayishi | Muddat | ROADMAP qat'iy; "yo'l-yo'lakay modul" yo'q (`CLAUDE.md` §7); har bosqich acceptance bilan yopiladi |
| 9 | Excel import sifati (turli formatlar, ism yozilishi) | Dublikat o'quvchilar | Preview + moslash qoidalari (Q-33), qayta import idempotent, normalizatsiya util |
| 10 | Mobil va Telegram uchun auth (M7–M8) keyin qo'shilganda buzilish | Qayta ishlash | Bearer rejimi M1 da yoziladi va testlanadi |
| 11 | EdexTest'dan foydalanuvchilarning eski parollari/ma'lumotlari kutilishi | Kutish noto'g'riligi | Qaror: hech narsa ko'chirilmaydi — foydalanuvchilarga yangi akkaunt va vaqtinchalik parol (kommunikatsiya rejasi maktab bilan) |
| 12 | Render Key Value / Supabase bepul tariflari limitlari | Uzilishlar | Staging va production alohida, production'da pullik tarif va PITR |
