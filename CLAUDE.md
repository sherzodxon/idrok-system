# CLAUDE.md — Idrok System

Bu fayl har sessiyada o'qiladi. Bu yerdagi qoidalar barcha bosqichlar uchun majburiy.
Batafsil talablar: `docs/MASTER_SPEC.md` (to'liq texnik topshiriq), modul spec'lari: `docs/spec/*.md`, bosqichlar: `docs/ROADMAP.md`, xavfsizlik bazasi: `docs/spec/security-baseline.md` (barcha bosqichlar uchun majburiy).

## 1. Loyiha haqida

Idrok System — Idrok maktabi uchun yagona maktab boshqaruv platformasi (School ERP).
Registo'ning ERP imkoniyatlari va EdEx Test'ning test mexanizmi asosida **yangi repo'da, noldan** quriladi.

Qabul qilingan qarorlar (o'zgartirish faqat egasining ruxsati bilan):

| Qaror | Qiymat |
|---|---|
| Repo | Yangi monorepo. EdexTest'ga yozilmaydi |
| Ma'lumotlar | Hammasi noldan. EdexTest'dan **hech qanday ma'lumot ko'chirilmaydi** |
| EdexTest kodi | Faqat mantiq uchun referens (o'qish mumkin, nusxa olib moslashtirish mumkin) |
| Maktab | Bitta (Idrok), lekin multi-tenant'ga tayyor (`tenantId`) |
| Tillar | `uz` (asosiy, lotin), `ru`. Keyinchalik `uz-Cyrl` |
| Vaqt mintaqasi | `Asia/Tashkent` |
| Valyuta | UZS |
| Baholash formulasi | Maktab sozlaydi. Tizim default preset bilan keladi |
| Hosting (hozir) | Web (`apps/web`): Vercel. Backend + worker: Render. DB: Supabase PostgreSQL. Redis: Render Key Value (T-87) |
| Haqiqiy ma'lumot | VPS'ga ko'chguncha Render/Supabase'da faqat demo ma'lumot. Haqiqiy o'quvchi/vasiy ma'lumoti faqat VPS'da |
| Shaxsiy hujjatlar | Pasport, tug'ilganlik guvohnomasi, INN yig'ilmaydi va modelda yo'q |
| Login | O'quvchi: 5-sinfdan. Vasiy: telefon raqami (login) + admin bergan vaqtinchalik parol. Telegram — M7 |
| Hosting (keyin) | O'z VPS (Face ID production'dan oldin) |

## 2. Monorepo tuzilishi

```
apps/
  web/        Next.js (App Router), TypeScript, Tailwind
  api/        Express + TypeScript, REST /api/v1
  worker/     BullMQ worker'lar (api bilan bir kod bazasidan, alohida process)
  bridge/     (M6) Face ID lokal agent — hozircha yaratilmaydi
  mobile/     (M8) Expo — hozircha yaratilmaydi
packages/
  shared/     Zod sxemalar, DTO tiplar, enum'lar, permission ro'yxati
  db/         Prisma schema, migratsiyalar, seed
  config/     eslint, tsconfig, prettier umumiy sozlamalari
docs/
  MASTER_SPEC.md
  ROADMAP.md
  spec/       modul spec'lari
  architecture/  M0 natijalari
  progress/   har bosqich hisoboti (M0.md, M1.md, ...)
  prompts/    bosqich promptlari
  references/ Registo tahlili PDF, dizayn namunasi
```

Paket menejeri: pnpm workspaces + Turborepo.

## 3. Stack

- Frontend: Next.js App Router, React, TypeScript strict, Tailwind CSS + CSS variables, TanStack Query, React Hook Form + Zod, next-intl, Recharts.
- Backend: Node.js, Express, TypeScript strict, Prisma, PostgreSQL, Zod validatsiya, OpenAPI (zod'dan generatsiya).
- Queue: Redis + BullMQ.
- Test: Vitest (unit/integration), Supertest (API), Playwright (E2E).

### Supabase bilan ishlash

- Supabase faqat PostgreSQL sifatida ishlatiladi. **Supabase Auth, RLS va client SDK ishlatilmaydi.**
- `DATABASE_URL` — pooler (port 6543, `?pgbouncer=true&connection_limit=1` yoki mos qiymat).
- `DIRECT_URL` — to'g'ridan-to'g'ri ulanish, faqat migratsiyalar uchun.
- Fayllar storage abstraksiyasi (`StorageProvider` interfeysi) orqali saqlanadi. Hozir adapter: Supabase Storage yoki lokal disk. Keyin VPS/S3 adapteri qo'shiladi.

## 4. Buzilmas qoidalar

### Vaqt va sana
- DB'da barcha `timestamp`lar UTC'da saqlanadi.
- Kunga bog'liq har bir yozuvda **`schoolDate` (DATE)** maydoni bo'ladi. U **serverda** `Asia/Tashkent` bo'yicha hisoblanadi.
- Kunlik/haftalik/oylik limitlar, hisobotlar va agregatsiyalar `createdAt` bo'yicha emas, **`schoolDate` bo'yicha** hisoblanadi.
- Sana hisoblash uchun bitta util (`packages/shared/time`) ishlatiladi. Kod ichida `new Date().getDate()` kabi lokal hisob taqiqlanadi.

### Raqamlar
- Ballar, foizlar, pul: `Decimal` (Prisma `Decimal`). `Float` taqiqlanadi.
- Pul UZS'da butun son (tiyin yo'q).
- Yaxlitlash faqat bitta util orqali va sozlamada belgilangan qoida bo'yicha.

### Ledger va tarix
- Ball, coin, to'lov, kassa yozuvlari **hech qachon UPDATE yoki DELETE qilinmaydi**. Xato **reversal** (teskari) yozuv bilan tuzatiladi.
- Akademik ma'lumotlar o'chirilmaydi: `status` / `archivedAt` ishlatiladi.
- Yopilgan davr natijalari snapshot sifatida saqlanadi va sozlama o'zgarganda o'zgarmaydi.

### Bir vaqtdagi so'rovlar
- Limit tekshiruvi bor har bir yozish (ball, coin) **bitta DB transaction** ichida va **o'quvchi + schoolDate** bo'yicha lock bilan bajariladi (`pg_advisory_xact_lock` yoki `SELECT ... FOR UPDATE`).
- Tashqi so'rovlar (webhook, autosave, to'lov) idempotent: `idempotencyKey` yoki tabiiy unique kalit.

### Xavfsizlik
- Har bir tenant-scoped so'rovda `tenantId` **serverda** autentifikatsiyadan olinadi. Frontend yuborgan `tenantId`ga ishonilmaydi.
- Permission tekshiruvi har doim backendda. Frontend faqat UI'ni yashiradi.
- Muhim amal bilan uning `AuditLog` yozuvi bitta transaction'da saqlanadi.
- Logga parol, token, kalit, passport/INN chiqmaydi.
- Secret'lar faqat env'da. `.env.example` doim yangilanadi.
- Default-deny: autentifikatsiyasiz route faqat `apps/api/src/http/public-routes.ts` ro'yxatida, `route-guard.test.ts` buni tekshiradi.
- O'quvchi/vasiy DTO'larida to'g'ri javob ma'lumoti yo'q (`security-baseline.md` S4).
- Hech qaysi skript/log/API parolni qayta chiqarmaydi.

### UI
- Ranglar komponent ichida yozilmaydi (`bg-[#4E92CF]` taqiqlanadi). Faqat semantic token: `bg-primary`, `var(--color-primary)`.
- Barcha UI matnlari tarjima fayllarida (`uz`, `ru`). Kod ichida o'zbekcha/ruscha matn yozilmaydi.
- Har sahifada loading, empty, error holatlari bo'ladi.
- O'quvchi va vasiy sahifalari mobile-first.

### Auth (web + kelajakdagi mobil)
- Web: httpOnly secure cookie (access + refresh, rotation).
- Mobil va Telegram Mini App uchun: bearer access token + refresh token. Bitta auth servisida ikkala rejim.

## 5. Kod qoidalari

- Backend modul tuzilishi: `modules/<name>/{routes,controller,service,repository,schemas,tests}`.
- Business logic faqat `service`da. Controller faqat request/response.
- Hisob-kitoblar (ball, foiz, limit, davriy natija) faqat backendda. Frontend faqat ko'rsatadi.
- Sof hisoblash funksiyalari (formula, agregatsiya) DB'dan ajratilgan, alohida unit-test qilinadigan modulda.
- API xato formati: `{ error: { code, message, details? } }`. `code` — mashina o'qiydigan, `message` — tarjima kaliti.
- Ro'yxat endpointlari: `?page=&pageSize=&sort=&q=` va bir xil javob formati `{ items, total, page, pageSize }`.
- `any` taqiqlanadi (zarur bo'lsa `unknown` + tekshiruv).
- Kod identifikatorlari inglizcha. Commit xabarlari inglizcha, qisqa.

## 6. Ish tartibi

1. Bosqichni boshlashdan oldin: `docs/ROADMAP.md`dagi bosqich va unga tegishli `docs/spec/*.md`ni o'qi. Qisqa reja yoz.
2. Kichik qadamlar bilan ishla. Har qadamdan keyin ishlayotgan holat bo'lsin.
3. Bosqich oxirida majburiy: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — hammasi o'tishi kerak.
4. `docs/progress/Mx.md` yoz: nima qilindi, acceptance criteria holati (har biri ✅/❌), test natijalari, qolgan muammolar, ochiq savollar.
5. Bajarilmagan narsani bajarilgan deb yozma. Test yozilmagan modul tugallangan hisoblanmaydi.
6. Noaniq biznes qoidani o'zing qat'iy belgilama: uni sozlama qil va `docs/architecture/open-questions.md`ga yoz.
7. Spec'dagi talabni soddalashtirish yoki olib tashlash kerak bo'lsa — avval so'ra.

## 7. Qilinmaydigan ishlar

- Production DB'ni reset, `prisma migrate reset`, `db push --force` qilish.
- Mavjud migratsiyani tahrirlash (faqat yangi migratsiya).
- EdexTest repo'siga yoki uning bazasiga yozish.
- Joriy bosqichga kirmaydigan modulni "yo'l-yo'lakay" yozish.
- Serverless funksiyaga webhook/queue mantig'ini bog'lash.
