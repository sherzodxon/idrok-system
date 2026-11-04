# Deploy (Render + Supabase) — staging

> Staging'da **faqat sun'iy demo ma'lumot** (Q-30). Haqiqiy o'quvchi/vasiy ma'lumoti faqat VPS'ga ko'chgandan keyin.
> Bu yo'riqnomadagi secret'larni (parollar, kalitlar) faqat egasi kiritadi — ular repo'ga, chatga yoki log'ga yozilmaydi.

Tarkib: [0. Oldindan](#0-oldindan) · [1. Supabase](#1-supabase) · [2. Render Blueprint](#2-render-blueprint) ·
[3. Domen](#3-domen-va-cookie) · [4. Birinchi deploy](#4-birinchi-deploy) · [5. Seed](#5-seed) · [6. Smoke](#6-smoke-tekshiruv) ·
[7. Migratsiyalar](#7-migratsiya-pipeline) · [8. Secret'lar](#8-secretlar) · [TRUST_PROXY](#klient-ip-va-trust_proxy-security-baselinemd-s2) · [Redis](#redis-render-key-value)

## Lokal ishga tushirish (Render/Supabase'siz)

Docker kerak emas. Bitta buyruq: doimiy embedded PostgreSQL (`.localdb/`, port 54339), xotiradagi Redis, demo maktab
(birinchi marta), keyin API (4000), worker va web (3000, `next dev`).

```bash
pnpm --filter @idrok/e2e local
```

- Kirish: `http://localhost:3000`. `admin`, birinchi demo o'qituvchi va birinchi demo vasiy hisoblari lokal parolni oladi
  (`LOCAL_PASSWORD` env, bo'lmasa `e2e/support/users.ts`dagi demo parol). Skript faqat login'larni chiqaradi.
- Ma'lumot keyingi ishga tushirishda saqlanadi. Toza demo uchun to'xtatib, `.localdb/` papkasini o'chiring.
- Faqat sun'iy ma'lumot (Q-30). API kodi o'zgarsa, skriptni qayta ishga tushiring (web avtomatik yangilanadi).

## Arxitektura

```
brauzer ──https──▶ app.<domen>  (idrok-web, Next.js)  ──private──▶ idrok-api (SSR: brending)
        ──https──▶ api.<domen>  (idrok-api, Express)  ──▶ Supabase Postgres (pooler 6543)
                                                      ──▶ idrok-redis (Key Value, noeviction)
                   idrok-worker (BullMQ: import, outbox) ──▶ o'sha DB, Redis, Supabase Storage
```

Barcha servislar `render.yaml` (Blueprint) da: `idrok-redis`, `idrok-api`, `idrok-worker`, `idrok-web`; region — Frankfurt.

## 0. Oldindan

| Kerak | Nega |
|---|---|
| GitHub repo (Render ulanadi) | Blueprint `render.yaml`ni repo'dan o'qiydi |
| Render akkaunti, to'lov kartasi | `worker`, `preDeployCommand` va Shell faqat pullik (Starter) rejalarda |
| Supabase akkaunti | PostgreSQL + Storage |
| **O'z domeningiz** (masalan `idrok.uz`) va DNS boshqaruvi | Pastda, [3-bo'lim](#3-domen-va-cookie) — usiz login ishlamaydi |

## 1. Supabase

1. **New project**: region **Frankfurt (eu-central-1)**, kuchli DB parol (parol menejerida saqlang).
2. **Project Settings → Database → Connection string**:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL`. Oxiriga `?pgbouncer=true&connection_limit=1` qo'shing
     (`connection_limit` Prisma'ning har ulanishi uchun; jarayon ichidagi pool hajmi `DATABASE_POOL_MAX`).
   - **Session pooler** (port `5432`, pooler host) → `DIRECT_URL`. Migratsiyalar shu orqali ishlaydi.
     ("Direct connection" hosti faqat IPv6 — Render'dan ulanmaydi; IPv4 add-on bo'lsa uni ishlatsa ham bo'ladi.)
3. **Storage → New bucket**: nomi `idrok-files`, **Private** (public emas).
4. **Project Settings → API**: `Project URL` → `SUPABASE_URL`, `service_role` kalit → `SUPABASE_SERVICE_ROLE_KEY`.
   Bu kalit faqat serverda (API, worker); brauzerga hech qachon bermang.
5. Supabase Auth, RLS siyosatlari va client SDK **ishlatilmaydi** (CLAUDE.md §3) — hech narsa yoqmang.

## 2. Render Blueprint

1. Render → **New → Blueprint** → GitHub repo → `main` branch. Render `render.yaml`ni topadi.
2. `sync: false` qiymatlarni so'raydi — quyidagicha to'ldiring (domen [3-bo'limda](#3-domen-va-cookie)):

| O'zgaruvchi | Qayerda | Qiymat |
|---|---|---|
| `DATABASE_URL` | `idrok-server` guruhi | 1-bo'lim, Transaction pooler |
| `DIRECT_URL` | `idrok-server` | 1-bo'lim, Session pooler |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `idrok-server` | 1-bo'lim, 4-band |
| `CORS_ORIGINS` | `idrok-api` | `https://app.<domen>` |
| `COOKIE_DOMAIN` | `idrok-api` | `<domen>` (masalan `staging.idrok.uz`, agar `app.staging.idrok.uz` / `api.staging.idrok.uz`) |
| `API_PUBLIC_URL` | `idrok-web` | `https://api.<domen>/api/v1` |
| `API_INTERNAL_URL` | `idrok-web` | `http://idrok-api:10000/api/v1` (Render private network; port — `idrok-api` servisidagi `PORT`, default `10000`). Bo'sh qolsa `API_PUBLIC_URL` ishlatiladi |

`JWT_SECRET` Render tomonidan tasodifiy yaratiladi (`generateValue`) va API hamda worker'da bir xil bo'ladi.
Qolgan qiymatlar (`TRUST_PROXY=1`, `COOKIE_SECURE=true`, `STORAGE_DRIVER=supabase`, ...) `render.yaml`da.
To'liq ro'yxat va tavsif: `.env.example`.

3. **Apply**. Render to'rtta servisni yaratadi va build boshlaydi.

> Build `corepack enable` bilan pnpm'ni `package.json`dagi `packageManager` versiyasida yoqadi. Agar Render'da
> `corepack enable` ruxsat xatosi bersa, build buyrug'ining boshini `npm install -g pnpm@12.16.1 &&` ga almashtiring.

## 3. Domen va cookie

Login cookie'lari `SameSite=Lax` va `COOKIE_DOMAIN` ota-domenda o'rnatiladi. `*.onrender.com` — "public suffix":
`idrok-web.onrender.com` va `idrok-api.onrender.com` brauzer uchun **ikki xil sayt**, shuning uchun
`onrender.com` manzillari bilan sessiya ishlamaydi. Bitta domen ostidagi ikki subdomen kerak:

1. `idrok-web` → **Settings → Custom Domains** → `app.<domen>`; `idrok-api` → `api.<domen>`.
2. DNS'da Render ko'rsatgan `CNAME` yozuvlarini qo'shing. TLS sertifikatini Render o'zi chiqaradi.
3. `CORS_ORIGINS`, `COOKIE_DOMAIN`, `API_PUBLIC_URL` 2-bo'limdagidek bo'lsin; o'zgartirsangiz servislarni qayta deploy qiling.

## 4. Birinchi deploy

Tartib Render'da avtomatik: `idrok-redis` → `idrok-api` (build → **preDeploy: `prisma migrate deploy`** → start) →
`idrok-worker` → `idrok-web`.

Tekshirish:
- `idrok-api` → **Logs**: `api listening`; `https://api.<domen>/api/v1/readyz` → `{"status":"ok","checks":{"db":"ok","redis":"ok"}}`.
- `idrok-worker` → **Logs**: `worker started`.
- `https://app.<domen>/login` ochiladi.

Migratsiya yiqilsa deploy to'xtaydi va eski versiya ishlashda davom etadi — log'dagi xatoni o'qing, DB'ni qo'lda
"tuzatmang" (7-bo'lim).

## 5. Seed

Ikkalasi ham faqat interaktiv terminalda va production'da `--yes-i-understand` bilan ishlaydi (security-baseline S3).

**Render Shell** (`idrok-api` → **Shell**):

```bash
cd apps/api && node --import tsx src/scripts/seed.ts --yes-i-understand
```

Ruxsatlar, `idrok` maktabi, tizim rollari va `admin` akkaunti yaratiladi. **Vaqtinchalik parol faqat shu yerda bir
marta ko'rinadi** — darhol parol menejeriga yozing; birinchi kirishda u almashtiriladi.

Demo maktab (sun'iy: 10 sinf, 300 o'quvchi, 600 vasiy, 40 o'qituvchi, 10 fan, biriktirishlar; M2'dan — 2 smena, choraklar, ta'tillar, jadval, yil darslari va tasdiqlangan rejalar; M3'dan — boshlangan choraklar faol, oxirgi 2 haftaning matematika va ona tili darslariga sun'iy ballar va davomat):

```bash
cd apps/api && node --import tsx src/scripts/seed-demo.ts --yes-i-understand
```

Bir necha daqiqa oladi (900+ parol xeshi). Faqat bo'sh maktabni to'ldiradi; qayta ishga tushirilsa hech narsa
o'zgartirmaydi. Demo akkauntlarining parollari tasodifiy va hech qayerda ko'rsatilmaydi — kerakli o'qituvchi yoki
vasiy uchun **Sozlamalar → Foydalanuvchilar → Parolni tiklash**.

Shell'siz variant — o'z kompyuteringizdan, Supabase'ga ulanib (`DATABASE_URL` = Session pooler):

```bash
DATABASE_URL='<session pooler URL>' NODE_ENV=production pnpm --filter @idrok/api seed -- --yes-i-understand
```

## 6. Smoke tekshiruv

| # | Tekshiruv | Kutilgan |
|---|---|---|
| 1 | `admin` + vaqtinchalik parol bilan kirish | Parolni almashtirish sahifasi, keyin bosh sahifa |
| 2 | O'quvchilar | 300 ta, sinf filtri, profil |
| 3 | Import → "Fanlar" shabloni → 1–2 qator → yuklash | Preview → Saqlash → "Saqlangan" (worker ishlayapti) |
| 4 | Sozlamalar → Brending → rang | Butun UI rangi o'zgaradi; mavzu LIGHT/DARK/SYSTEM |
| 5 | O'qituvchi akkaunti (parolini tiklab) bilan kirish | Faqat o'z guruhlari; Sozlamalar menyusi yo'q |
| 6 | `curl -sI https://app.<domen>/login` | `content-security-policy` (nonce bilan), `strict-transport-security`, `x-frame-options: DENY` |
| 7 | `curl -sI https://api.<domen>/api/v1/healthz` | `cache-control: no-store`, `content-security-policy: default-src 'none'...` |
| 8 | `TRUST_PROXY` | Pastdagi bo'limdagi ikki-tarmoq tekshiruvi |
| 9 | `idrok-api` va `idrok-worker` log'larida qidiruv: parol, `Bearer`, `idrok_at=` | Topilmaydi (`[Redacted]` bo'lishi mumkin) |

## 7. Migratsiya pipeline

1. Lokalda: `schema.prisma` o'zgaradi → `pnpm --filter @idrok/db exec prisma migrate dev --name <nom>` → yangi
   papka `prisma/migrations/<vaqt>_<nom>/` commit qilinadi (SQL ko'zdan kechiriladi).
2. CI: integration testlar migratsiyalarni toza bazaga qo'llaydi.
3. Deploy: `idrok-api` `preDeployCommand` — `prisma migrate deploy` (faqat yangi migratsiyalar, `DIRECT_URL` orqali).
   Worker va web DB sxemasini o'zgartirmaydi.

Qoidalar (CLAUDE.md §7): `migrate reset`, `db push --force` **taqiqlangan**; qo'llangan migratsiya tahrirlanmaydi.
Orqaga qaytarish — oldingi commit'ni deploy qilish (**Rollback**); sxemani qaytarish kerak bo'lsa — yangi, tuzatuvchi
migratsiya. Ustun o'chirish ikki bosqichda: avval kod ustunni ishlatmay qo'yadi, keyingi deploy'da migratsiya o'chiradi.

## 8. Secret'lar

| Secret | Qayerda | Almashtirish |
|---|---|---|
| `JWT_SECRET` | Render (`generateValue`) | Yangi qiymat → API va worker qayta deploy. Barcha access token'lar bekor bo'ladi (refresh orqali qayta olinadi) |
| DB parol | Supabase | Supabase'da reset → `DATABASE_URL`, `DIRECT_URL` yangilanadi |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Supabase'da rotate → Render'da yangilash |
| `DATA_ENCRYPTION_KEY` (M6) | Render (API va worker'da bir xil; `openssl rand -base64 32`) | Almashtirilmaydi: eski kalit bilan shifrlangan yuz rasmlari va qurilma parollari o'qilmay qoladi (qayta yuklash / qayta kiritish kerak). Yo'qolsa ham shunday. Kalit bo'lmasa Face ID yuz va parol saqlamaydi (`ENCRYPTION_NOT_CONFIGURED`) |

Secret'lar faqat Render/Supabase dashboard'ida. `.env` fayllar repo'ga tushmaydi (CI'da `gitleaks`).


## Klient IP va `TRUST_PROXY` (security-baseline.md S2)

API klient IP'sini **faqat** Express `trust proxy` orqali oladi (`req.ip`). `X-Forwarded-For`, `CF-Connecting-IP` kabi
sarlavhalar kodda qo'lda o'qilmaydi. Login rate limitining IP qismi shu IP'ga tayanadi, shuning uchun qiymat proxy
zanjiriga aniq mos bo'lishi kerak:

| Zanjir | `TRUST_PROXY` | Sabab |
|---|---|---|
| Lokal (proxy yo'q) | `0` (default) | `X-Forwarded-For`ni har kim yozishi mumkin — ishonilmaydi |
| Klient → Render load balancer → API | `1` | Render bitta proxy: u qo'shgan oxirgi `X-Forwarded-For` qiymati — haqiqiy klient IP. Klient o'zi yozgan qiymatlar chapda qoladi va e'tiborga olinmaydi |
| Klient → Cloudflare → Render → API | `2` | Ikki ishonchli hop. Cloudflare yoqilsa qiymat **albatta** o'zgartiriladi |
| Keyin: klient → Nginx (VPS) → API | `1` | Nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` bilan |

Noto'g'ri qiymat xavfi:
- **Kichik** (masalan Render ortida `0`): hamma so'rov load balancer IP'sidan keladi → IP limiti barcha foydalanuvchilarni birga sanaydi (30 xato urinishdan keyin hamma bloklanadi).
- **Katta** (masalan Render ortida `2`): hujumchi o'zi yozgan `X-Forwarded-For` qiymati "klient IP" bo'lib qoladi → IP limitini chetlab o'tadi. Username limiti baribir ishlaydi (u IP'ga bog'liq emas — `login-limits.test.ts`).

Staging'da tekshirish: ikki xil tarmoqdan (masalan uy Wi-Fi va mobil internet) bitta noto'g'ri username bilan 5 tadan urinib ko'ring — ikkala tarmoqda ham username limiti 6-urinishda ishlashi, lekin bir tarmoqdagi 30 ta urinish ikkinchi tarmoqni bloklamasligi kerak.

## Redis (Render Key Value)

`maxmemory-policy` = `noeviction` (BullMQ talabi). Boshqa siyosatda navbatdagi job'lar yo'qolishi mumkin.

Navbatlar (M4 dan): `imports`, `maintenance`, `tests`. `tests` — test oynasi chegaralari (SCHEDULED → OPEN → CLOSED)
va urinish deadline'lari; outbox'da `availableAt` bilan kechiktirilib yuboriladi. Worker ishlamay qolsa ham API har
o'qishda holat va deadline'ni o'zi tekshiradi (lazy), shuning uchun natija kechikmaydi — faqat avtomatik yopilish
worker qaytguncha "o'qilgunga qadar" kutadi.
M5 dan: `tests` navbati test natijasi uchun avtomatik coinlarni ham beradi (`coins.test_results_due`, idempotent).
`maintenance` har kecha coin balanslarini ledger bilan solishtiradi; farq bo'lsa `coin balance mismatch` xatosi logga
yoziladi (alert shu xabarga qo'yiladi).
M6 dan: `devices` navbati — server o'zi ulana oladigan terminallar (`useBridge = false`) topshiriqlari (`devices.jobs_due`).
Bridge orqali ulangan terminallar topshiriqlarini Bridge o'zi oladi (har 10 soniyada so'rov). `maintenance` har 30 daqiqada
(`attendance-coins`) davomat coinlarini beradi va har kecha maktabdan ketgan o'quvchilar yuzini qurilmalardan o'chiradi.

## Face ID (M6)

- Terminal webhook manzili: `POST /api/v1/attendance/hikvision-event/<kalit>`. Kalit qurilma qo'shilganda bir marta
  ko'rsatiladi, logga yozilmaydi (URL niqoblanadi). `DEVICE_PUBLIC_API_URL` bo'lsa, to'liq manzil ko'rsatiladi.
- Bridge protokoli: `/api/v1/bridge/*` (bearer token, faqat chiquvchi HTTPS). O'rnatish: `apps/bridge/README.md`.
- Haqiqiy yuz rasmlari (biometrika) faqat VPS'ga ko'chgandan keyin (Q-30, Q-47). Render/Supabase'da faqat sinov rasmlari.

