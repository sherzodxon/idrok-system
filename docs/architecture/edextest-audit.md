# EdexTest auditi (M0)

> Manba: `~/Edex/EdexTest` (faqat o'qildi; hech narsa yozilmadi, ishga tushirilmadi, bazaga ulanilmadi).
> Backend: `edexTest-backend` (oxirgi commit `72a8577`, 2026-10-29). Frontend: `edexTest-frontend` (`83bd818`).
> Fayl havolalari EdexTest repo ildiziga nisbatan. Eski kod uchun commit ko'rsatilgan (`git show <commit>:<fayl>`).
> `.env` fayllar mazmuni o'qilmadi.

## 1. Umumiy ko'rinish

| Qatlam | Texnologiya | Izoh |
|---|---|---|
| Backend | Express 5 + TypeScript (strict yo'q), Prisma 6.16, PostgreSQL | ~10 900 qator. Routerlarda business logic (`routes/*.ts` 1 000–1 700 qatorgacha) |
| Frontend | Next.js 16 App Router, React 19, Tailwind 4, Redux Toolkit, axios | `app/admin`, `app/teacher`, `app/student` — har rol alohida layout |
| Auth | JWT (7 kun) `Authorization: Bearer`, token `localStorage`da | Refresh, revoke, rate limit yo'q |
| Fayllar | `multer` → lokal disk `uploads/`, `express.static` | URL'da domen qattiq yozilgan |
| Testlar | `node:assert` + `ts-node`, embedded Postgres (`edex_test`) | 25 ta integration test fayli, CI yo'q |
| Deploy | Bitta Node jarayon (`node dist/app.js`), CORS'da `test.edexschool.uz` | Queue/worker yo'q |

### 1.1. Papka tuzilishi (backend)

```
src/
  app.ts                 Express, CORS, body-parser, static, router ulash, xato handler
  middlewares/           auth.ts (JWT + DB'dan rol), upload.ts (multer)
  routes/                11 router — validatsiya, ruxsat, Prisma so'rovlari va hisoblar shu yerda
  services/              keyinroq qo'shilgan servislar: o'quv yili, retake, offline test, coin limit, statistika
  utils/                 coinPeriod (TZ chegaralari), coinCore (balans), crypto (parol shifrlash), audit
prisma/schema.prisma     27 model, 13 enum; migrations/ (12 ta); ACADEMIC_YEAR_INVARIANTS.md
scripts/                 lokal DB, SQLite importi, prod tozalash, bootstrap
tests/                   integration testlar + helpers (izolyatsiyalangan test DB)
```

### 1.2. Prisma sxemasi (qisqacha)

| Domen | Modellar | Munosabatlar / izoh |
|---|---|---|
| Foydalanuvchi | `User` (role: ADMIN/TEACHER/STUDENT), `Group` | Bitta `User` jadvalida o'quvchi va xodim; `gradeId` — joriy sinf (denormalizatsiya), `totalPoints`, `penaltyPoints`, `coinBalance` — hisoblagichlar |
| Sinf/fan | `Grade` (sinf + yil: `7-2025`), `Subject` (sinfga bog'langan: `Informatika-6`) | Implicit m:n `_TeacherGrades`, `_TeacherSubjects` (yilsiz) + yangi `TeacherGradeAssignment`/`TeacherSubjectAssignment` (yil bilan) — ikkalasi parallel yuritiladi |
| O'quv yili | `AcademicYear`, `StudentEnrollment`, `AcademicYearTransition`, `Transition*Snapshot`, `AcademicAuditLog` | Yaxshi loyihalangan: yil o'tishi, 48 soatlik rollback, snapshot, append-only audit. Partial unique va CHECK'lar faqat SQL'da |
| Test | `Test` (STANDARD/MOCK/OFFLINE), `Question`, `Option`, `Answer`, `UserTest`, `TestRetake`, `TestSettings`, `QuestionLimitRule` | Savol testga to'g'ridan-to'g'ri bog'langan (`Question.testId`); bank savoli testga **nusxa** qilinadi. Versiya yo'q |
| Eski ball | `PointLog` (points, band, article, groupId) | Hech qaysi route ishlatmaydi (2026-10-05 dan beri) — "osilib qolgan" jadval |
| Coin | `CoinCriterion`, `CoinCriterionTeacher`, `CoinLimitRule`, `CoinTransaction`, `CoinProduct`, `CoinPurchase`, `CoinSystemSettings`, `CoinAuditLog` | Ledger + reversal + correction, idempotencyKey, `balanceAfter` — eng puxta qism |

Kamchiliklar: ID'lar `Int autoincrement` (tenant yo'q, taxmin qilinadi), `Float` (`UserTest.points`), `score Int` (foiz butun songa yaxlitlangan holda saqlanadi), `Answer.testId` nullable bo'lgani uchun `@@unique([studentId, testId, questionId])` NULL'da ishlamaydi.

## 2. Rollar va auth

- **Login** (`src/routes/auth.routes.ts:46-79`): `username` + parol. Topilmasa "Foydalanuvchi topilmadi", parol xato bo'lsa "Parol noto'g'ri" — foydalanuvchi mavjudligini oshkor qiladi. Rate limit yo'q.
- **Parol saqlash** (`src/utils/crypto.ts`, `auth.routes.ts:55-58`): parollar **qaytariladigan AES-256-GCM** bilan shifrlanadi (admin parolni ko'ra olishi uchun). Eski bcrypt hashlar birinchi kirishda shifrlangan ko'rinishga "yangilanadi" — ya'ni xavfsizlik pasaytiriladi. Parol generatsiyasi taxmin qilinadigan: `ism+familiya` + tug'ilgan kun/oy (`crypto.ts:38-53`).
- **Token**: JWT `{ id, role }`, 7 kun, `localStorage` (`edexTest-frontend/store/authSlice.ts:38-58`). Refresh, revoke, logout-all yo'q. XSS bo'lsa token o'g'irlanadi.
- **Avtorizatsiya** (`src/middlewares/auth.ts`): har so'rovda rol va `isActive` DB'dan o'qiladi (to'g'ri yondashuv). Ruxsat — faqat rol ro'yxati (`authorize(["ADMIN"])`), permission yo'q. Ma'lumot darajasidagi cheklovlar (o'qituvchi faqat o'z sinfi) har route'da qo'lda yozilgan (`services/access.service.ts`, `isTeacherAssignedToStudentGrade`).
- **Birinchi admin**: `allowFirstAdmin` — admin yo'q bo'lsa `/auth/register` ochiq.
- Self-registration yo'q; foydalanuvchini admin yaratadi, parol bir marta ko'rsatiladi (lekin keyin ham ko'rsa bo'ladi — shifrlangani uchun).

## 3. Ball va coin mantig'i

### 3.1. Eski "ball" (PointLog) — 2026-10-05 gacha
`git show 3806533:src/routes/point.routes.ts`:
- `POST /points/teacher/give`: o'qituvchi bob/modda bo'yicha ball beradi; kunlik limit — **bir o'qituvchi bir o'quvchiga kuniga 3 marta** (`:19-37`). Ball `PointLog`ga yoziladi va `User.totalPoints` oshiriladi.
- `POST /points/admin/adjust`: o'quvchiga yoki guruhga ball.
- `DELETE /points/admin/cancel/:logId`: logni **o'chiradi** va `totalPoints`ni kamaytiradi.
- `/logs`, `/stats`, `/weekly-stats`, `/range-stats` — **autentifikatsiyasiz**.
- 2026-10-05 (`4e56277`) da route butunlay olib tashlangan; jadval va hisoblagichlar qolgan.

### 3.2. Coin (joriy)
`src/routes/coin.routes.ts:378-565`, `src/services/coinLimit.service.ts`, `src/utils/coinCore.ts`, `src/utils/coinPeriod.ts`:
1. Tekshiruvlar: tizim yoqilgan, idempotencyKey (ixtiyoriy, `@unique`), o'quvchi faol va sinfga biriktirilgan, o'qituvchi sinfga biriktirilgan, mezon faol, o'qituvchiga mezon ruxsati bor, fan mosligi, `min ≤ amount ≤ max`.
2. Transaction ichida: `lockStudentRow` (`coinCore.ts:38` — `UPDATE User SET coinBalance = coinBalance + 0` orqali qator lock) → barcha mos limit qoidalari (`GLOBAL`, `CRITERION`, `TEACHER`, `TEACHER_CRITERION`, `EACH_*`) bo'yicha ishlatilgan miqdor/son → hammasi o'tsa balans o'zgaradi (`applyBalanceDelta` — shartli UPDATE, manfiyga tushmaydi) → `CoinTransaction` (`balanceAfter` bilan).
3. Kunlik/haftalik/oylik chegara: `periodBounds()` (`coinPeriod.ts:41-49`) — `Intl` orqali `Asia/Tashkent` (sozlamadan) bo'yicha **to'g'ri** hisoblanadi; filtr `createdAt >= start`. ROLLING oyna ham bor.
4. Tuzatish: `REVERSAL` (bir marta, `reversedTransactionId @unique`) va `CORRECTION` (faqat kamaytirish). Asl yozuv o'zgarmaydi.
5. Audit: `CoinAuditLog` — lekin **transaction'dan tashqarida** yoziladi (`coin.routes.ts:732`, `:805`, `:193` ...). Audit yozilmay qolishi mumkin.

## 4. Test oqimi

| Bosqich | Qanday ishlaydi | Joy |
|---|---|---|
| Yaratish | O'qituvchi fan sahifasidan; `multipart` (`data` JSON + `image_N` fayllar). Nom avtomatik: `Fan:No{count+1}:BSB` (`count` lock'siz — poyga holati) | `test.routes.ts:69-130` |
| Savollar | Aniq 4 variant, 1 to'g'ri. Bank savoli testga nusxa qilinadi; savol soni chegarasi "eng aniq qoida" bo'yicha | `services/questionLimit.service.ts` |
| Boshlash | `GET /tests/:id` birinchi ochilganda `UserTest` va tasodifiy `questionOrder` yaratadi (`sort(() => Math.random() - 0.5)` — notekis aralashtirish, `:327`). Savollar to'plami o'zgarsa tartib qayta yaratiladi. **Variantlar aralashtirilmaydi** | `:231-410` |
| Taymer | Faqat brauzerda; `endTime` testning umumiy oynasi, alohida davomiylik yo'q | `edexTest-frontend/app/student/tests/[id]/page.tsx:87-90` |
| Autosave | Javoblar va joriy indeks faqat `localStorage`da (`page.tsx:61-106`). Serverga **faqat oxirida** yuboriladi | — |
| Anti-cheat | `visibilitychange` + `blur`, 2 s dedupe, hisoblagich `localStorage`da (`page.tsx:110-155`). 3 ogohlantirish, 4-chisida brauzer `VIOLATION` yuboradi | — |
| Yakunlash | `POST /tests/:id/submit` `{ answers, reason }`. Server `reason`ni **klientdan qabul qiladi** (`:453`); `endTime + 2 daqiqa`dan keyin rad etadi | `:413-517` |
| Baholash | To'g'ri variant id'si bilan solishtiriladi, `Math.round(correct/total*100)` — foiz butun son | `:456-463` |
| Natija | Yakunlangan o'quvchiga `GET /tests/:id` **har variantning `isCorrect`i va `correctOption` matnini qaytaradi** (`:365-382`; submit javobi ham `:503-506`). UI faqat ✅/❌ ko'rsatadi, lekin API to'g'ri javoblarni oshkor qiladi — bank savollari qayta ishlatilsa sir emas | — |
| Retake | Admin tanlangan o'quvchiga shaxsiy oyna beradi (`TestRetake`), eski javoblar bilan davom etadi | `services/testRetake.service.ts` |
| Offline | Shkala 2–1000, ball `Float` → foiz butun songa | `services/offlineTest.service.ts` |

Qo'shimcha: `answer.createMany` (`:475`) `questionId`/`optionId` testga tegishliligini tekshirmaydi — o'quvchi boshqa testning savoliga javob yozishi mumkin (ball o'zgarmaydi, lekin ma'lumot buziladi). Rasm URL'larida `https://api.edexschool.uz` qattiq yozilgan (`:285`, `:369`, `:400`).

## 5. Ma'lum muammolarning sababi

### (a) Kunlik limit UTC/Toshkent farqi bilan xato hisoblanadi

**Sabab.** Eski ball limitida (`git show 3806533:src/routes/point.routes.ts:20-31`):

```ts
const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
// ... createdAt: { gte: todayStart, lte: todayEnd }
```

`setHours` server jarayonining **lokal** vaqt mintaqasida ishlaydi. Server (Render/VPS) UTC'da bo'lgani uchun "bugun" Toshkent bo'yicha **05:00 dan keyingi kun 05:00 gacha** bo'lib qoladi:
- 00:00–04:59 (Toshkent) oralig'ida qo'yilgan ball **kechagi** limitga sanaladi → ertalabki darslarda limit "allaqachon tugagan" bo'lishi yoki kechqurun berilgani bilan qo'shilib ketishi mumkin.
- Xuddi shu xato haftalik reytingda (`getMondayOfCurrentWeek`, `:209-216` — `getDay()/setDate()/setHours()` lokal), `range-stats`da (`:282-285` — `new Date("YYYY-MM-DD")` UTC yarim tun + lokal `setHours`) bor.
- Limit transaction'dan tashqarida sanaladi (`count` → keyin `$transaction`) — ikki parallel so'rov ikkalasi ham o'tadi.
- Hisob `createdAt` bo'yicha: kechikib kiritilgan ball dars kuniga emas, kiritilgan kunga tushadi.

Joriy coin kodida `periodBounds()` (`src/utils/coinPeriod.ts:41-49`) muammoni TZ jihatidan tuzatgan va qator lock qo'shilgan, lekin hisob hamon `createdAt` bo'yicha va sana mantig'i bir nechta joyda takrorlanadi (`coinPeriod.ts`, `offlineTest.service.ts:28`, frontend `lib/tashkentTime.ts` — har biri o'zicha).

**Yangi tizimda oldini oluvchi qoidalar** (`CLAUDE.md` §4 "Vaqt va sana", "Bir vaqtdagi so'rovlar"):
1. Har kunlik yozuvda `schoolDate (DATE)` — **serverda**, `Asia/Tashkent` bo'yicha; ball uchun esa **sessiya sanasidan** olinadi (`scoring.md` §3.4).
2. Limitlar `createdAt` emas, `schoolDate` bo'yicha (`WHERE schoolDate = $1` / oraliq) — `ScoreEntry`, `CoinTransaction` indekslari shunga qurilgan.
3. Barcha sana hisoblari faqat `packages/shared/time` orqali; `new Date().getDate()`/`setHours` lint qoidasi bilan taqiqlanadi (`architecture.md` §6).
4. Tekshiruv + insert bitta transaction'da, o'quvchi bo'yicha `pg_advisory_xact_lock` ostida (kalit tarkibi — `open-questions.md` Q-46).
5. Acceptance test: `scoring.md` §11 #21 (23:30 va 00:30 chegaralari) + `TZ=UTC` va `TZ=Asia/Tashkent` bilan ikki marta ishlaydigan unit testlar.

### (b) Ball loglarining yo'qolishi

**Sabablar** (bir nechta, hammasi "log o'chiriladi yoki yozilmaydi"):
1. **Bekor qilish = DELETE.** `DELETE /points/admin/cancel/:logId` (`3806533:src/routes/point.routes.ts:123-156`) logni o'chiradi va `totalPoints`ni kamaytiradi. Kim, qachon, nega bekor qilgani hech qayerda qolmaydi.
2. **Foydalanuvchi o'chirilganda kaskad.** `DELETE /users/:id` o'quvchining barcha `PointLog`larini o'chiradi (`src/routes/user.routes.ts:814`; eski versiyada `3806533:...user.routes.ts:180`). Guruhni o'chirish (`3806533:src/routes/group.routes.ts:63-93`) loglari bor guruhda FK sababli 500 qaytaradi — guruhni o'chirishning yagona yo'li loglarni bazadan tozalash.
3. **Hisoblagich va log ajralgan.** `User.totalPoints`/`Group.totalPoints` alohida oshiriladi; guruhga admin bergan ball (`/admin/adjust` groupId bilan) `studentId`siz yoziladi. `/stats` esa mavjud bo'lmagan `s.points` maydonini yig'adi (`:191`) — doim 0. Ya'ni ekranda ko'rinadigan ball log yig'indisiga teng emas.
4. **Route olib tashlangan, ma'lumot "osilib qolgan".** `4e56277` (2026-10-05) da `point.routes.ts` va `group.routes.ts` o'chirilgan; `PointLog` jadvali saqlangan, lekin hech kim o'qimaydi/yozmaydi.
5. **Prod tozalash skripti.** `scripts/prodCleanup.ts:95-96` barcha `PointLog`, `CoinTransaction`, `CoinAuditLog`ni o'chiradi va hisoblagichlarni 0 ga tushiradi (`docs/PROD_UPGRADE.md`da "eski ballar o'chiriladi" deb yozilgan).
6. **Audit transaction'dan tashqarida.** Joriy coin kodida `logCoinAudit` asosiy transaction'dan keyin alohida chaqiriladi (`coin.routes.ts:732`, `:805`) — jarayon shu orada uzilsa audit yo'qoladi. Limit va mezonlar hard delete qilinadi (`:238-262`, `:362-376`).

**Yangi tizimda oldini oluvchi qoidalar** (`CLAUDE.md` §4 "Ledger va tarix", "Xavfsizlik"):
1. `ScoreEntry` va `CoinTransaction` — **append-only ledger**: UPDATE/DELETE yo'q, DB darajasida trigger bilan ham rad etiladi (`data-model.md` §8). Bekor qilish = `REVERSAL` yozuv (sabab bilan).
2. Muhim amal va uning `AuditLog` yozuvi **bitta transaction**'da.
3. Akademik ma'lumot o'chirilmaydi: o'quvchi/xodim `status`/`archivedAt` bilan arxivlanadi; FK'lar `onDelete: Restrict`.
4. Balans/natija = ledger yig'indisi. Kesh (`CoinAccount.balance`) faqat ledger bilan bitta transaction'da yangilanadi va kunlik reconciliation job bilan tekshiriladi.
5. Ma'lumot o'chiradigan skriptlar repo'da bo'lmaydi; `prisma migrate reset` va shunga o'xshash amallar `CLAUDE.md` §7 bo'yicha taqiqlangan.

## 6. Boshqa topilmalar (xavf darajasi bilan)

| # | Topilma | Xavf | Joy |
|---|---|---|---|
| 1 | Parollar qaytariladigan shifrlashda, admin ko'ra oladi; generatsiya taxmin qilinadigan | Yuqori | `utils/crypto.ts`, `auth.routes.ts:55-63` |
| 2 | Test natijasida to'g'ri javoblar API orqali oshkor | Yuqori | `test.routes.ts:365-382`, `:503-506` |
| 3 | `finishReason`, taymer, buzilish hisoblagichi klientda | Yuqori | `test.routes.ts:453`; frontend `page.tsx` |
| 4 | Javoblar faqat oxirida yuboriladi; brauzer tozalansa natija 0% | Yuqori | frontend `page.tsx:61-171` |
| 5 | Autentifikatsiyasiz statistik endpointlar (eski) va `/coins/public/weekly` (ism-familiya, sinf) | O'rta | `coin.routes.ts:1590` |
| 6 | JWT `localStorage`da, 7 kun, revoke yo'q; login rate limit yo'q | O'rta | `authSlice.ts`, `auth.routes.ts:67-71` |
| 7 | `.env` git tarixida bor (`9bd857e` dan oldingi commitlar) — DB URL va kalitlar rotate qilinishi kerak | O'rta | `git show 3806533:.env` (mazmuni o'qilmadi) |
| 8 | `Float` (`UserTest.points`), foiz `Int` sifatida saqlanadi | O'rta | `schema.prisma:193-202` |
| 9 | Audit transaction'dan tashqarida; limit/mezon hard delete | O'rta | `coin.routes.ts` |
| 10 | `User.gradeId` va `_TeacherGrades` yilsiz nusxalar yangi jadvallar bilan parallel — ikki manba | O'rta | `schema.prisma:560-636` |
| 11 | Business logic routerlarda (1 000+ qatorli fayllar), `any` keng ishlatilgan | Past (texnik qarz) | `routes/*.ts` |
| 12 | Domen qattiq yozilgan rasm URL, CORS ro'yxati kodda | Past | `test.routes.ts:285`, `app.ts:29` |
| 13 | Barcha matnlar o'zbekcha kod ichida (i18n yo'q) | Past | hamma joyda |
| 14 | Test nomi tartib raqami `count+1` — parallel yaratishda dublikat | Past | `test.routes.ts:96` |

## 7. Qayta ishlatiladigan qismlar

| Qism | Fayl(lar) | Qanday ishlatiladi | Izoh |
|---|---|---|---|
| TZ bo'yicha davr chegaralari | `src/utils/coinPeriod.ts` (`periodBounds`, `dayStartInZone`, `resolveRange`) | moslashtirib | `packages/shared/time` ichiga, `schoolDate` (DATE) tushunchasi bilan. `Intl` yondashuvi to'g'ri |
| Frontend Toshkent vaqti ↔ date picker | `edexTest-frontend/lib/tashkentTime.ts` | moslashtirib | Picker uchun "devor soati" konversiyasi — shu g'oya `packages/shared/time` web adapteriga |
| Coin limit dvigateli | `src/services/coinLimit.service.ts` | moslashtirib | Scope/period/type modeli, barcha buzilgan qoidalarni qaytarish, `availableAt`/`remainingCapacity` — M5 da sof funksiyaga ajratiladi; `createdAt` → `schoolDate`. Ball limitlari (M3) uchun ham shablon |
| Balansni manfiyga tushirmaslik | `src/utils/coinCore.ts` (`applyBalanceDelta`, `penaltyFloor`) | moslashtirib | Shartli UPDATE g'oyasi; lock `SELECT ... FOR UPDATE` / advisory lock bilan |
| Reversal + correction ledger | `CoinTransaction` modeli, `coin.routes.ts:683-823` | moslashtirib | `reversedTransactionId @unique`, "faqat kamaytirish" correction, effektiv summa — M5 ga asos |
| Idempotency (unique + P2002 qaytarish) | `coin.routes.ts:387-396`, `:555-558` | as-is (g'oya) | Natural key + unique index + poygada g'olib natijasini qaytarish |
| "Eng aniq qoida" tanlash | `src/services/questionLimit.service.ts` | faqat g'oya | `scoring.md` §3.1 bilan bir xil yondashuv (bir turdagi qoidalar orasida) |
| O'quv yili o'tishi | `academicYearTransition.service.ts`, `academicYearRollback.service.ts`, snapshot jadvallari | faqat g'oya | Draft → validate → execute → 48 soat rollback; M1 dan keyin (yil o'tishi wizard) uchun referens |
| SQL-only invariantlar hujjati va tekshiruvi | `prisma/ACADEMIC_YEAR_INVARIANTS.md`, `checkDbInvariants()` | as-is (g'oya) | Partial unique/CHECK'lar ro'yxati + migratsiyadan keyin avtomatik tekshiruv — `data-model.md` §8 shu usulda |
| Izolyatsiyalangan test DB | `tests/helpers/testDb.ts` | moslashtirib | "Faqat localhost va aniq DB nomi" himoyasi; Vitest global setup'ga |
| Test sozlamalari: savol soni chegarasi | `TestSettings`, `QuestionLimitRule` | faqat g'oya | `maxQuestionsPerTest` + kelajakda qoidalar |
| Retake (shaxsiy oyna) | `services/testRetake.service.ts` | faqat g'oya | `TestWindowOverride` ga aylanadi; `basis` (VIOLATION/ABSENT) va `remainingMsAtFinish` g'oyasi foydali |
| Natijani shkalaga o'girish | `src/utils/gradeScale.ts` (`toScale`) | moslashtirib | Butun sonli HALF_UP — `Decimal` yaxlitlash utiliga |
| Excel import/eksport (ExcelJS) | `user.routes.ts:382-552`, `q-bank.routes.ts:78-158`, `test.routes.ts:587-662` | faqat g'oya | Preview → commit oqimi yo'q; yangi tizimda ImportJob |
| Anti-cheat UI (ogohlantirish, qolgan imkoniyat) | frontend `app/student/tests/[id]/page.tsx` (`LeaveCounter`) | faqat g'oya | Hisob serverga ko'chadi |
| Savol formasi tekshiruvlari (bo'sh matn, bir xil variant, takror savol, "avval berilgan") | frontend `lib/testQuestionCheck.ts`, `subject.routes.ts:423` | moslashtirib | Serverda zod bilan takrorlanadi |
| Teacher activity (coverage, stale days) | `coin.routes.ts:1465+`, `CoinSystemSettings.activity*` | moslashtirib | M5 |

## 8. Olib o'tilmaydigan yondashuvlar

| Yondashuv | Sabab |
|---|---|
| Qaytariladigan parol shifrlash, admin parolni ko'rishi | Parol sizsa — barcha akkauntlar ochiladi. Yangi tizimda argon2id + vaqtinchalik parol bir marta ko'rsatiladi + birinchi kirishda almashtirish |
| JWT `localStorage`da, refresh'siz | XSS'da token o'g'irlanadi, revoke yo'q. httpOnly cookie + refresh rotation |
| Test holatini (taymer, javoblar, buzilishlar, finishReason) brauzerda saqlash | O'quvchi chetlab o'tadi; qurilma buzilsa natija yo'qoladi. Server-side `TestAttempt` |
| Variant matni bo'yicha solishtirish / to'g'ri javobni klientga yuborish | `tests.md` §4.2, §10 #1 |
| Bank savolini testga nusxalash (versiyasiz) | Tahrir eski natijalarni buzadi. `QuestionVersion` |
| `DELETE` bilan bekor qilish, foydalanuvchi bilan loglarni kaskad o'chirish | §5(b) |
| Denormalizatsiyalangan hisoblagichlar (`totalPoints`, `coinBalance`) ledger'dan alohida | Mos kelmay qoladi; yangi tizimda kesh faqat ledger bilan bitta transaction'da + reconciliation |
| `setHours`/`getDay` bilan lokal sana hisobi, `createdAt` bo'yicha kunlik limit | §5(a) |
| Rol ro'yxati bilan avtorizatsiya (`authorize(["ADMIN"])`) | Ko'p rol va nozik ruxsatlar kerak (RBAC permission) |
| Business logic router ichida | Test qilib bo'lmaydi; `modules/<name>/{routes,controller,service,repository}` |
| Fanni sinfga bog'lash (`Informatika-6`), sinfni yil nomi bilan (`7-2025`) | Fan maktab darajasida, sinf yil ichida (`ClassGroup`), parallel alohida (`Grade`) |
| Yilsiz va yilli bog'lanishlarni parallel yuritish | Bitta manba: `TeacherAssignment` (yil + amal qilish oralig'i) |
| Fayllarni `express.static` bilan ochiq berish, qattiq domen | `StorageProvider` + imzolangan URL |
| Kod ichida o'zbekcha matnlar va xato xabarlari | i18n kalitlari, xato `code` |
| Ma'lumot o'chiradigan "prod cleanup" skriptlari | `CLAUDE.md` §7 |
| Autentifikatsiyasiz ommaviy reyting | Voyaga yetmaganlar ma'lumoti; kerak bo'lsa alohida "ommaviy ekran" tokeni bilan |

## 9. Xulosa

EdexTest'ning eng qimmatli qismi — coin ledger va limit dvigateli hamda o'quv yili o'tishi mantig'i: ular puxta, testlangan va yangi tizimga g'oya/kod sifatida moslashtiriladi. Test mexanizmi esa klientga ishonadi va natijalarni oshkor qiladi — uni server-side attempt modeli bilan noldan yozish kerak. Ikkala ma'lum muammo (TZ va yo'qolgan loglar) kod darajasida aniq sababga ega va `CLAUDE.md` §4 qoidalari ularni tizimli yopadi.
