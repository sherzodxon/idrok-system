# Spec: Xavfsizlik bazasi (barcha bosqichlar uchun majburiy)

EdexTest auditi (`docs/architecture/edextest-audit.md`) va 2026-10-31 dagi EdexTest shoshilinch tuzatishlaridan olingan saboqlar.
Har bir qoida avtomatik test yoki CI tekshiruvi bilan himoyalanadi — "qo'lda eslab qolish"ga tayanilmaydi.

## S1. Default-deny: autentifikatsiyasiz endpoint yo'q

- Har bir route autentifikatsiya va permission talab qiladi. Istisnolar **faqat** bitta ro'yxatda: `apps/api/src/http/public-routes.ts` (hozir: `/healthz`, `/readyz`, `POST /auth/login`, `POST /auth/refresh`, parol tiklash).
- **Majburiy test** (`apps/api/test/route-guard.test.ts`): Express router'dagi barcha ro'yxatdan o'tgan route'lar avtomatik yig'iladi; ro'yxatda bo'lmagan har biri token'siz so'rovga `401` qaytaradi. Yangi route qo'shilsa test o'zi uni qamrab oladi.
- Har bir himoyalangan route'da `requirePermission(...)` bor; buni ham shu test tekshiradi (route metadata'sida permission yo'q bo'lsa — test yiqiladi).
- "Ommaviy" ekranlar (masalan maktab TV'sidagi reyting) kerak bo'lsa: alohida, faqat o'qish uchun **display token** (admin yaratadi, bekor qila oladi), minimal ma'lumot (`Ism F.`, ball), jarima sabablari va izohlar **hech qachon**.

## S2. Login va sessiya

- Rate limit ikki **mustaqil** kalit bo'yicha: username (IP'siz) va IP. Ikkalasi alohida tekshiriladi — IP'ni o'zgartirish username limitini chetlab o'tmaydi.
- Klient IP: faqat `trust proxy` (`TRUST_PROXY` env, default `0`) orqali. `CF-Connecting-IP`, `X-Forwarded-For` kabi sarlavhalar qo'lda o'qilmaydi. Production'da proxy zanjiri `docs/DEPLOY.md`da hujjatlanadi.
- Xato xabari bitta: `AUTH_INVALID_CREDENTIALS` — foydalanuvchi bor-yo'qligi oshkor qilinmaydi; mavjud bo'lmagan foydalanuvchida ham parol tekshiruvi bajariladi (vaqt farqi bo'lmasin).
- Testlar: IP'ni har so'rovda o'zgartirib bitta username'ga limit+1 urinish → `429`; mavjud/mavjud bo'lmagan user uchun javob bir xil.

## S3. Parollar va maxfiy kalitlar

- Parollar faqat argon2id hash. Qaytariladigan shifrlash, "admin parolni ko'radi" funksiyasi yo'q.
- Vaqtinchalik parol bir marta ko'rsatiladi (UI yoki bir martalik yuklab olinadigan fayl). **Hech qanday skript, log yoki API javobi** parolni keyin qayta chiqarmaydi. Istisno: bootstrap/seed skripti yangi yaratilgan admin parolini faqat interaktiv terminalda bir marta chiqaradi va production'da `--yes-i-understand` bayrog'isiz ishlamaydi.
- Barcha secret'lar `config/env.ts`da zod bilan **majburiy** (default yo'q); bo'lmasa server ishga tushmaydi. Test bilan tasdiqlanadi.
- `.env*` git'ga tushmaydi (`.gitignore`), `.env.example`da faqat nomlar va tavsif.
- CI'da secret scanning (`gitleaks` yoki ekvivalent) — topilsa PR yiqiladi.
- Pino `redact` ro'yxati: password, token, refreshToken, authorization, cookie, apiKey, secret. Test: log chiqishida bu maydonlar `[Redacted]`.
- Ma'lumotlarni ommaviy o'chiradigan "cleanup" skriptlari repo'da bo'lmaydi.

## S4. Test natijalari va to'g'ri javoblar

- O'quvchiga (STUDENT, GUARDIAN) qaytadigan **hech qanday** DTO'da variant darajasidagi `isCorrect`, to'g'ri variant id'si yoki matni, `acceptedAnswers`, MATCHING to'g'ri juftliklari bo'lmaydi. Bu alohida "student DTO" sxemalari (zod) bilan majburlanadi, o'qituvchi DTO'si bilan umumiy emas.
- Savol bo'yicha natija (✅/❌ — har savol uchun bitta boolean) faqat test **oynasi yopilgandan keyin** ko'rinadi: umumiy `endsAt` **va** shu test bo'yicha barcha `TestWindowOverride`lar (retake) tugagach. Undan oldin — faqat umumiy ball (agar `showResultToStudent` ruxsat bersa). `endsAt` yo'q testda — o'qituvchi testni `CLOSED` qilgandan keyin.
- To'g'ri javoblarni o'quvchiga ko'rsatish (`revealCorrectAnswers`) — default `false`, maktab sozlamasi (Q-21).
- Snapshot testlar: student DTO JSON'ida taqiqlangan kalitlar yo'q (`isCorrect` faqat savol darajasida, `correct*`, `accepted*` umuman yo'q).
- Savollar/javoblar bilan Excel eksport — faqat `questions.export` ruxsati (ADMIN va savol egasi o'qituvchi). Test: STUDENT/GUARDIAN → 403.

## S5. Test javoblarini qabul qilish

- Javob saqlashda server tekshiradi: `testQuestionId` shu attempt'ning `questionOrder`ida bor; `optionIds` shu savol versiyasiniki; MULTIPLE bo'lmasa bitta variant. Mos kelmasa `400` (jimgina qabul qilinmaydi).
- `finishReason` klientdan qabul qilinmaydi (`tests.md` §4.4). Deadline o'tgach kelgan har qanday so'rov — server `TIME_UP` bilan yakunlaydi.
- Noto'g'ri tuzilgan body (`answers` ro'yxat emas va h.k.) — zod validatsiya, `400`, hech qachon `500`.

## S6. Voyaga yetmaganlar ma'lumoti

- Ro'yxat/reyting endpointlari faqat ruxsat doirasida (o'qituvchi — o'z guruhlari, vasiy — o'z farzandi). Bu S1 testiga qo'shimcha ravishda har modulda data-scope testlari bilan tekshiriladi.
- Jarima/intizomiy sabablar faqat shu o'quvchi, uning vasiysi, o'qituvchisi va adminlarga ko'rinadi.

## S7. Bog'liqliklar

- Yangi paket versiyasi kamida 14 kunlik bo'lsin (yangi chiqqan versiyalarni darhol olmaslik — supply-chain xavfi). Versiyalar `pnpm-lock.yaml` bilan mahkamlangan.
- CI'da `pnpm audit --prod` (high/critical → ogohlantirish, PR izohida).

## Qachon tekshiriladi

- S1–S3, S7: M1 oxirigacha (8-qadamdan oldin).
- S4–S5: M4 da (`tests.md`), testlar acceptance ro'yxatiga kiradi.
- S6: har bosqichda yangi ro'yxat endpointlari bilan.
