# Ochiq savollar

> Spec'lardagi "Ochiq savollar" bo'limlari (README, `lesson-plan.md` §7, `scoring.md` §12) + M0 auditida topilgan bo'shliq va ziddiyatlar.
> Har biri tizimda **sozlama** sifatida loyihalangan (default bilan) — javob kelguncha ish to'xtamaydi, lekin "Kerak bo'lgan bosqich"dan oldin yopilishi kerak.
> "Kim hal qiladi": **Maktab** — direktor/o'quv ishlari; **Egasi** — loyiha egasi; **Yurist**; **Texnik** — texnik rahbar taklifi, egasi tasdiqlaydi.

## ✅ Qabul qilingan qarorlar (egasi, 2026-10-31)

| # | Qaror |
|---|---|
| Q-30 | VPS'ga ko'chguncha Render/Supabase'da **faqat demo (sun'iy) ma'lumot**. Haqiqiy o'quvchi/vasiy ma'lumoti faqat VPS'ga o'tgandan keyin kiritiladi |
| Q-31 | Web — **Render** (api, worker bilan bir joyda) |
| Q-26 | Vasiy M1 da: telefon raqami = login, vaqtinchalik parolni admin beradi, birinchi kirishda almashtiradi. Telegram bog'lash — M7 |
| Q-27 | O'quvchilarga login **5-sinfdan** yuqori; quyi sinflar uchun akkaunt ixtiyoriy (admin yaratishi mumkin) |
| Q-29 | Pasport, tug'ilganlik guvohnomasi, INN **umuman yig'ilmaydi** — modeldan olib tashlandi (`passportEnc`, `birthCertEnc`, `innEnc`) |
| Q-39 | Tizim rollari: Admin, Direktor, Direktor o'rinbosari, Uslubchi, O'qituvchi, Sinf rahbari, O'quvchi, Vasiy (+ texnik SUPER_ADMIN). Ruxsat matritsasi M1 da egasi ko'rib chiqadi |
| Q-14 | Davr maksimumi — policy `config.periodMaxPoints` (spec tuzatildi) |
| Q-15 | NORMAL > 0, REVERSAL < 0 (spec tuzatildi) |
| Q-46 | Ball lock kaliti — `hash(tenantId, studentId)` (spec tuzatildi) |
| Q-37 | `references/` → `docs/references/` (M1 1-qadamda ko'chiriladi) |
| E bo'limining qolganlari (Q-28, Q-33, Q-34, Q-42) | Tavsiya etilgan default qabul qilindi |
| C bo'limi (Q-19, Q-20, Q-21, Q-22, Q-36, Q-45) | Tavsiya etilgan default qabul qilindi (egasi, 2026-11-03): `multipleScoring` testda, default `ALL_OR_NOTHING`; 3-chi buzilishda yakunlanadi; to'g'ri javoblar ko'rsatilmaydi (faqat ✅/❌); retake — `tests.reopen` (admin, direktor o'rinbosari); max 50 savol, minimal yo'q; offline shkala {5,10,20,25,40,50,100} |

A–D bo'limlari ochiq qoladi — tegishli bosqichdan oldin maktab hal qiladi. Javob kelguncha tavsiya etilgan default ishlatiladi.

## A. Kalendar va dars jadvali (M2 dan oldin)

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-01 | 2026-2027 choraklar sanalari va ta'tillar | LessonSession generatsiyasi, davr natijalari | — (har yil kiritiladi) | Admin UI'da kiritadi; seed'da namunaviy sanalar | Maktab |
| Q-02 | Ish haftasi: 5 yoki 6 kun? Barcha sinflar uchun bir xilmi? | Darslar soni, jadval | 5 / 6 / sinfga qarab | 6 kun (1–6), maktab darajasida; sinfga qarab farq bo'lsa `CalendarDay.appliesTo` emas, alohida qo'llab-quvvatlash kerak bo'ladi | Maktab |
| Q-03 | Juft/toq hafta jadvali ishlatiladimi? | `TimetableEntry.weekType`, generatsiya | ha / yo'q | Model qo'llab-quvvatlaydi, UI'da yashirin (`ALL`) | Maktab |
| Q-04 | Qaysi fanlar guruhchalarga bo'linadi (ingliz tili, informatika ...)? | TeachingGroup SUBGROUP, import | ro'yxat | M1 importida guruhcha ustuni ixtiyoriy | Maktab |
| Q-05 | Dars rejasini tasdiqlash kerakmi va kim tasdiqlaydi? | `planApprovalRequired`, `curriculum.approve` roli | direktor o'rinbosari / uslubchi / kerak emas | `true`, `DEPUTY_DIRECTOR` va `METHODIST` rollarida | Maktab |
| Q-35 | Smenalar soni; qo'ng'iroq jadvali smenaga qarab farq qiladimi? | BellSchedule, ClassGroup.shiftId | 1 / 2 smena | 1 smena, model 2+ ni qo'llaydi | Maktab |
| Q-40 | O'rinbosar o'qituvchi (zamena): kasal o'qituvchi o'rniga kim ball/davomat qo'yadi? | Spec'da yo'q; `LessonSession.teacherId` qat'iy | (a) sessiya `teacherId`ini almashtirish (audit bilan) (b) `substituteTeacherId` maydoni (c) ruxsat yo'q | (b) — M2 da `substituteTeacherId` qo'shish; ball `teacherId`=o'rinbosar | Maktab + Texnik |

> **2026-11-02, egasi:** A bo'limidagi savollar (Q-01–Q-05, Q-35, Q-40) uchun "Tavsiya etilgan default" qabul qilindi. Har biri sozlama — maktab keyin o'zgartira oladi.

## B. Ball va davriy baholash (M3 dan oldin)

> **2026-11-02, egasi:** B bo'limidagi savollar uchun "Tavsiya etilgan default" qabul qilindi ("Ha, boshla"). Har biri sozlama — maktab keyin o'zgartira oladi.

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-06 | Default sessiya maksimumi va kunlik/haftalik limitlar, hard cap'lar | `ScoreSettings`, `ScoreLimitRule` | masalan 10 / kun 50 | `lessonMaxPoints=10`, `hardCapPerLesson=10`, `hardCapPerDay=70`, qo'shimcha qoidalarsiz | Maktab |
| Q-07 | Ball qo'yish kechikishi: dars o'tgandan necha kun keyin ham ruxsatsiz qo'yish mumkin? | `lateEntryDays`, `scores.late_entry` | 1 / 3 / 7 | 3 kun | Maktab |
| Q-08 | Sababsiz kelmaganlik: 0 yoki hisobdan chiqarish? | Foizga to'g'ridan-to'g'ri ta'sir | `ZERO` / `EXCLUDE` | `EXCLUDE` (spec default) | Maktab |
| Q-09 | Qatnashmagan test (online/offline): 0 yoki hisobdan chiqarish? | Testlar komponenti | `ZERO` / `EXCLUDE` | `EXCLUDE` | Maktab |
| Q-10 | Chorak tarkibi: kundalik va test nisbati, MANUAL komponent kerakmi? | Policy preset | 50/50, 60/40, + yakuniy og'zaki | `DAILY_SCORES 50 + TESTS 50`, MANUAL yo'q | Maktab |
| Q-11 | Yarim yillik va **yillik** natija formulasi; yillik natija kerakmi? | Spec `type`da YEAR yo'q, lekin §5.4 "yillik" deydi | AVERAGE / WEIGHTED / WEIGHTED_WITH_FINAL / INDEPENDENT | Choraklar → yarim yil `AVERAGE`; yarim yillar → yil `AVERAGE`; `YEAR` davr turi qo'shildi | Maktab |
| Q-12 | MANUAL komponent qanday kiritiladi? Spec'da kirish modeli yo'q | Policy'da MANUAL tanlansa ma'lumot manbai kerak | (a) `ManualAssessmentScore` (davr × fan × o'quvchi × komponent) (b) MANUAL'ni olib tashlash | (a) qoralamada qo'shildi, kim kiritadi — `assessment.manual.enter` (fan o'qituvchisi) | Texnik → Egasi |
| Q-13 | 5 ballik shkala kerakmi va oraliqlari? | `gradeLabel`, o'quvchi kartasi | yo'q / 86–100=5, 71–85=4, 56–70=3, 0–55=2 | Shkala seed'da tayyor, policy'da tanlanmagan | Maktab |
| Q-14 | **Ziddiyat:** `scoring.md` §5.1 "Σ component.maxPoints = period.maxPoints" — lekin `AcademicPeriod`da `maxPoints` yo'q, §6 config'da `periodMaxPoints` bor | Validatsiya manbai | (a) policy `periodMaxPoints` (b) davrga maydon qo'shish | (a) — davr maksimumi policy versiyasida; davrlar orasida farq kerak bo'lsa alohida policy bog'lanadi | Texnik → Egasi |
| Q-15 | **Ifoda noaniqligi:** `ScoreEntry.points` "Decimal, musbat", REVERSAL esa "manfiy summa" | DB CHECK | — | NORMAL > 0, REVERSAL < 0 (CHECK); spec matnini shunga moslash | Texnik |
| Q-16 | GRADE / TEACHING_GROUP limitlari nimani sanaydi: "o'quvchi shu parallel/guruhda bo'lgan yozuvlari" | Limit algoritmi | (a) `ScoreEntry.teachingGroupId` shu guruh / shu parallel guruhlari (b) o'quvchi a'zo bo'lgan davrdagi barcha yozuvlar | (a) — yozuvning `teachingGroupId`i bo'yicha | Texnik → Egasi |
| Q-17 | Davomat belgilansa sessiya `HELD` bo'ladimi (spec: faqat ball qo'yilganda)? | "Kim dars o'tmagan" hisobotlari | ha / yo'q | Ha — davomat yoki ball, qaysi biri birinchi | Maktab |
| Q-18 | Davomat belgilanmagan o'quvchi qanday hisoblanadi? Jurnalda "hammasi keldi" tugmasi kerakmi? | PENDING holati, ABSENT qoidalari | belgilanmagan = keldi / alohida holat | Belgilanmagan = keldi (spec §4.1 bilan mos); "Hammasi keldi" bulk tugmasi | Maktab |
| Q-41 | Yopilgan davrda davomatni o'zgartirish ham `assessment.reopen` talab qiladimi? | Davomat EXCLUDE/ZERO natijaga ta'sir qiladi | ha / yo'q | Ha (natija "eskirgan" bo'ladi) | Maktab |
| Q-43 | O'qituvchi boshqa o'qituvchilar shu o'quvchiga qo'ygan ballarni ko'radimi? | Jurnalda "bugun qoldi: N" — umumiy limitdan | faqat qoldiq / to'liq ro'yxat | Faqat qoldiq raqami (kim qo'ygani ko'rinmaydi) | Maktab |
| Q-46 | **Texnik ziddiyat:** lock kaliti `hash(tenantId, studentId, schoolDate)` (spec §3.1), lekin WEEK/MONTH/PERIOD limitlari turli kunlarga parallel yozuvda chetlab o'tilishi mumkin | Limit to'g'riligi | (a) o'quvchi darajasidagi kalit (b) kunlik + haftalik ikki lock | (a) — `hash(tenantId, studentId)`; spec'ning "bir o'quvchiga bir vaqtda bitta yozish" talabiga mos | Texnik → Egasi |

## C. Test tizimi (M4 dan oldin) — ✅ default qabul qilindi (2026-11-03)

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-19 | **Bo'shliq:** `multipleScoring` (§4.6) `Test` modelida yo'q | MULTIPLE baholash | testda / maktab sozlamasida | Testda maydon (qoralamada qo'shildi), default `ALL_OR_NOTHING` | Texnik |
| Q-20 | Buzilish chegarasi: EdexTest'da 3 ogohlantirish, **4-chi**da yakunlanadi; spec'da "threshold 3 → **uchinchi**da yakunlanadi" | O'quvchilar uchun qoida o'zgaradi | 3-chida / 4-chida | Spec bo'yicha (3-chida), o'quvchilarga oldindan e'lon | Maktab |
| Q-21 | O'quvchiga test tugagach to'g'ri javoblar ko'rsatiladimi? | Bank savollari qayta ishlatiladi; EdexTest API'si oshkor qilgan | hech qachon / test yopilgandan keyin / darhol | Hech qachon (faqat ✅/❌), testda `revealCorrectAnswers` sozlamasi | Maktab |
| Q-22 | Retake / individual vaqtni kim beradi: o'qituvchi yoki faqat admin? | EdexTest'da faqat admin; spec'da o'qituvchi | o'qituvchi (o'z testi) / admin | `tests.reopen` — admin va direktor o'rinbosari; o'qituvchiga keyin berish mumkin | Maktab |
| Q-36 | Savollar soni chegarasi (`maxQuestionsPerTest`) va minimal soni | Test yaratish validatsiyasi | EdexTest: kamida 15 | Min chegarasi yo'q, max 50 | Maktab |
| Q-45 | Offline test shkalalari: faqat {5,10,20,25,40,50,100} (spec) yoki ixtiyoriy (EdexTest 2–1000)? | DB CHECK | ro'yxat / ixtiyoriy | Spec ro'yxati | Maktab |

## D. Coin (M5 dan oldin)

> M5 tavsiya etilgan default bilan qilindi (2026-11-03). Egasi 2026-11-04 tasdiqladi. Q-24 va Q-25 sozlama: qarz va uning chegarasi — `Coin → Sozlamalar`; mezondan kim foydalanishi — har mezonda (`Barcha o'qituvchilar` / `Tanlangan o'qituvchilar`).

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-23 | Xodimlarga ham coin beriladimi (Registo'da bor)? | Ledger modeli `studentId` bilan | faqat o'quvchi / xodim ham | Faqat o'quvchi; xodim — kengaytirish nuqtasi | Maktab |
| Q-24 | Coin qarzi yoqiladimi va chegarasi? Balans yangi o'quv yilida nolga tushadimi? | Jarima va do'kon qoidalari | qarzsiz / chegara bilan; nolga tushadi / yo'q | Qarz o'chiq; balans yillar osha saqlanadi (EdexTest bilan bir xil) | Maktab |
| Q-25 | Coin mezonidan kim foydalana oladi: har mezon uchun tanlangan o'qituvchilar yoki hamma? | `CoinCriterion.eligibility` | ALL_TEACHERS / SELECTED | SELECTED (EdexTest bilan bir xil) | Maktab |
| Q-44 | Haftalik ommaviy reyting ekrani (EdexTest'da autentifikatsiyasiz `/public/weekly`) kerakmi? | Voyaga yetmaganlar ism-familiyasi ochiq | yo'q / maxsus token bilan TV ekrani / faqat ichki | Faqat ichki (login bilan); TV uchun keyin alohida token | Maktab + Egasi |

## D2. Face ID va maktab davomati (M6)

> M6 tavsiya etilgan default bilan qilindi (2026-11-04), egasi tasdig'ini kutmoqda. Ko'pchiligi sozlama: `Davomat → Sozlamalar` va `Coin → Avtomatik`.

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-47 | Haqiqiy o'quvchilar yuz rasmlarini (biometrika) qayerda va qaysi rozilik bilan saqlaymiz? | Voyaga yetmaganlar biometrikasi; Q-30 | VPS'ga ko'chguncha yig'ilmaydi / vasiy yozma roziligi bilan | Render/Supabase'da faqat sinov rasmlari. Haqiqiy rasmlar VPS'dan keyin, vasiyning yozma roziligi bilan. Rasm serverda shifrlangan, o'quvchi ketganda o'chiriladi | Egasi + Yurist |
| Q-48 | Kechikish nimadan hisoblanadi? | Kechikish va coin | smena boshlanishi / 1-dars boshlanishi | Sinf smenasining boshlanishi (`Shift.startMinute`). Smenasiz sinflar uchun maktab default vaqti (08:30). Imtiyozli daqiqalar default 0 | Maktab |
| Q-49 | Kechikish oraliqlari | Hisobot va coin | — | Default oraliq yo'q, maktab o'zi qo'shadi (namuna: 1–3, 3–7, 7+). Oraliq `[dan, gacha)` daqiqa, sekundlar tashlanadi | Maktab |
| Q-50 | Kelmagan o'quvchi qachon "kelmadi" bo'ladi? Vasiyga xabar qachon? | Vasiy xabarlari (M7) | smena tugaganda / ma'lum soatda | Smena tugashi bilan "kelmadi". Hech bir qurilma hodisa yozmagan kun "ma'lumot yo'q" (kelmadi emas). Vasiyga xabar — M7 | Maktab |
| Q-51 | Davomat uchun coin qancha va qachon? | Coin | — | Default qoida yo'q. Maktab qo'yadi: vaqtida kelish (mukofot) va har oraliq uchun (jarima). Kun smena tugagach, bir marta baholanadi | Maktab |
| Q-52 | Qarzdor o'quvchini terminal kiritmasligi (`blocksDebtors`, MASTER_SPEC §11) | Moliya | — | Qilinmadi: moliya moduli (M8) bilan birga | Maktab + Egasi |

## E. Auth, odamlar, import (M1 dan oldin)

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-26 | Vasiy M1 da qanday kiradi? | Akkaunt yaratish, import | login+parol (telefon=username) / faqat M7 da Telegram | M1: telefon raqami username, vaqtinchalik parol (admin beradi); M7 da Telegram bog'lash qo'shiladi | Maktab + Egasi |
| Q-27 | Qaysi sinflardan o'quvchilarga login beriladi? | Akkauntlar soni, parol tarqatish | barcha / 5-sinfdan | 5-sinfdan yuqori; quyi sinflar uchun ixtiyoriy | Maktab |
| Q-28 | Xodimlar uchun 2FA qachon yoqiladi? (MASTER_SPEC talab qiladi, ROADMAP M1 da yo'q) | Xavfsizlik | M1 / M5 dan keyin / production hardening | Arxitektura tayyor, yoqish — production'dan oldin (TOTP), admin va moliya rollari uchun majburiy | Egasi |
| Q-29 | M1 da pasport, tug'ilganlik guvohnomasi, INN yig'iladimi? | Shifrlash kaliti boshqaruvi, huquqiy javobgarlik | M1 da / moliya bosqichida | Maydonlar bor (shifrlangan), lekin M1 importida ixtiyoriy va UI'da yashirin | Maktab + Yurist |
| Q-33 | Excel qayta importida mavjud o'quvchini qanday aniqlaymiz? | Dublikatlar | studentCode / F.I.O.+tug'ilgan sana / qo'lda | `studentCode` bo'lsa — u; aks holda F.I.O.(normalizatsiya)+sana → "ehtimol shu" ogohlantirishi, admin tasdiqlaydi; vasiy — telefon bo'yicha | Texnik → Maktab |
| Q-34 | O'quv yili sanalari: o'quv (01.09–30.06) yoki to'liq (01.08–31.07)? | `AcademicYear` chegaralari, coin/hisobotlar | o'quv / to'liq | `startDate/endDate` = o'quv muddati; yozgi ta'tildagi yozuvlar (masalan coin) tugagan yilga tegishli | Maktab |
| Q-39 | Idrok'dagi rollar ro'yxati va ularning ruxsatlari (direktor o'rinbosari, uslubchi, sinf rahbari ...) | Seed rollari | `api-plan.md` §7 asosida | Tizim rollari + matritsa M1 7-qadamda ko'rib chiqiladi | Maktab |
| Q-42 | `studentCode` formati (STD-0001) va boshlanish raqami | Hujjatlar, keyinchalik Face ID `employeeNo` | prefiks + 4 raqam | `STD-` + 4 raqam, tenant ichida ketma-ket | Maktab |

## F. Infratuzilma va huquqiy (production'dan oldin)

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-30 | O'zbekiston shaxsiy ma'lumotlar qonunchiligi (fuqarolar ma'lumotini mamlakat ichidagi serverda saqlash) — Render/Supabase (xorij)da haqiqiy o'quvchilar ma'lumotini saqlash mumkinmi? | Production'ga chiqish huquqiy asosi; voyaga yetmaganlar | (a) VPS'ga ko'chguncha faqat sun'iy ma'lumot (b) yurist ruxsati bilan vaqtincha (c) boshidanoq mahalliy hosting | (a) — haqiqiy ma'lumot kiritilishidan oldin yurist xulosasi | Egasi + Yurist |
| Q-31 | Web qayerda: Render yoki Vercel? | Cookie domeni, region, VPS'ga ko'chish | Render / Vercel | Render (`architecture.md` §13.1) | Egasi |
| Q-32 | Domen nomlari (`app.` / `api.` subdomenlar) | Cookie `Domain`, CORS, CSP | — | `app.<domen>`, `api.<domen>`, staging uchun alohida domen | Egasi |
| Q-37 | Referens fayllar `references/` papkasida, `CLAUDE.md`/README esa `docs/references/` deydi | Hujjat havolalari | ko'chirish / hujjatlarni moslash | `docs/references/` ga ko'chirish (M1 1-qadamda, egasi rozi bo'lsa) | Egasi |
| Q-38 | Prisma 6.x yoki 7.x? | Supabase pooler bilan ishlash, uzoq muddatli qo'llab-quvvatlash | 6.x / 7.x + `@prisma/adapter-pg` | M1 1-qadamda smoke test bilan; qoralama 6.16.2 da validatsiya qilingan | Texnik |

## Hal qilingan ziddiyat (ma'lumot uchun)

| Mavzu | Qaror | Asos |
|---|---|---|
| Vaznli testlar: MASTER_SPEC §13.9 "vaznlar yig'indisi ≤ komponent limiti" vs `tests.md` §7 nisbiy vaznlar | `tests.md` (nisbiy vazn, komponent maksimumiga masshtablash) | Ustunlik tartibi: spec > MASTER_SPEC; `tests.md` §7 buni aniq aytadi |
| Test qoralamasi EdexTest'da brauzerda saqlanadi | Server-side DRAFT test | `tests.md` §4.1 |
| `TIME_SLOTS` rejimi (MASTER_SPEC §10 Rejim B) | M2 scope'ida yo'q (`lesson-plan.md` faqat jadval asosida) | ROADMAP M2 scope; kerak bo'lsa alohida savol |

## M1 davomida qabul qilingan texnik qarorlar (default, egasi tasdig'iga)

| # | Qaror | Asos |
|---|---|---|
| Q-38 | Prisma **7.10.1** + `@prisma/adapter-pg` (`prisma-client` generator, `prisma.config.ts`). Migratsiya `DIRECT_URL` bilan, ilova `DATABASE_URL` (pooler) bilan | Joriy major versiya; adapter-pg transaction-mode pooler bilan ishlaydi. Supabase pooler bilan smoke test staging deploy'da (8-qadam) qilinadi — lokal muhitda Supabase yo'q |
| T-01 | TypeScript **6.0** (7.0 emas) | `typescript-eslint` hozircha `<6.1` ni qo'llab-quvvatlaydi |
| T-02 | ID'lar UUIDv7 (`uuid(7)`) | vaqt bo'yicha tartiblangan — indekslar uchun qulay |
| T-03 | "5-sinfdan" = `level >= 5`; sozlama `SchoolSettings.studentAccountMinGrade` (default 5) | Q-27 |
| T-04 | Integration testlar: CI'da `TEST_DATABASE_URL` (postgres servis konteyneri), lokalda `embedded-postgres` (Docker shart emas). Har ishga tushishda alohida test bazasi yaratiladi va o'chiriladi | lokal muhitda Docker yo'q |
| T-05 | Ma'lumot doirasi rol kodidan aniqlanadi: Admin/Direktor/O'rinbosar/Uslubchi va maktab yaratgan rollar — butun maktab; O'qituvchi — faol biriktirishlaridagi guruhlar (bugungi sana bo'yicha); Sinf rahbari — + o'z sinfi va vasiylari; Vasiy/O'quvchi — faqat o'zi | `rbac-matrix.md` "Ma'lumot doirasi"; 7-qadamdan oldin egasi ko'radi |
| T-06 | Login nomlari: o'quvchi — `studentCode` kichik harfda (`std-0001`), vasiy — E.164 telefon, xodim — `ism.familiya` (band bo'lsa raqam qo'shiladi) | Q-26, Q-27, Q-42 |
| T-07 | `Idempotency-Key` natijasi javob yuborilgandan keyin saqlanadi: juda tez (millisekundlar ichida) qayta yuborilgan so'rov ikki marta bajarilishi mumkin. Ball/coin kabi ledger yozuvlari buning o'rniga natural unique kalitga tayanadi (M3, M5) | M1 uchun yetarli |
| T-08 | Excel import: vaqtinchalik parollar faqat bir martalik "logins" faylida (importni boshlagan admin yuklab oladi, keyin fayl o'chiriladi); parollar DB'da saqlanmaydi. Commit job'i qayta urinishda allaqachon qo'llangan qatorlarni o'tkazib yuboradi — o'sha qatorlarda yaratilgan akkauntlar faylga tushmaydi, ular uchun "parolni tiklash" ishlatiladi | security-baseline.md S3 |
| T-09 | Import moslash (Q-33): o'quvchi — kod, keyin F.I.+tug'ilgan sana (mos kelsa yangilanadi, ogohlantirish bilan); faqat F.I. mos kelsa — `POSSIBLE_DUPLICATE_STUDENT` ogohlantirishi va yangi o'quvchi. Vasiy — telefon. Xodim — kod, keyin F.I. Sinf/fan — nom bo'yicha (mavjudi o'zgarmaydi) | Q-33 default |
| T-10 | Importda vasiylarga akkaunt avtomatik yaratiladi (Q-26); o'quvchiga — `level >= studentAccountMinGrade` yoki "Login" ustunida aniq "ha"/"yo'q" | Q-26, Q-27 |
| T-11 | Worker'ning kunlik tozalashi faqat muddati tugagan texnik yozuvlarni o'chiradi: `IdempotencyRecord` va 30 kundan eski `PUBLISHED` outbox hodisalari. Sessiyalar va biznes ma'lumotlari o'chirilmaydi | security-baseline.md S3 |
| T-12 | Supabase Storage adapteri REST orqali (SDK'siz) yozildi va faqat soxta `fetch` bilan testlangan; haqiqiy bucket bilan birinchi tekshiruv — staging (8-qadam) | lokal Supabase yo'q |
| T-13 | `GET /branding` — beshinchi ochiq route (`PUBLIC_ROUTES`): login sahifasi uchun maktab nomi va ranglari, shaxsiy ma'lumot yo'q | api-plan.md §2.1; security-baseline.md S1 ro'yxatiga qo'shimcha — egasi tasdiqladi (2026-11-01, `rbac-matrix.md` bilan) |
| T-14 | Web API manzilini **ishga tushishda** oladi (`API_PUBLIC_URL`, `API_INTERNAL_URL`), build vaqtida emas (`NEXT_PUBLIC_*` ishlatilmaydi) — bitta Docker image barcha muhitlarda | deploy soddaligi |
| T-15 | Mavzu tanlovi: qurilmada cookie (`idrok_theme`, birinchi render "miltillamasdan") + foydalanuvchi sozlamasi (login'da qurilmaga qo'llanadi). Til: cookie `idrok_locale` + sozlama. URL'da til prefiksi yo'q | ui-structure.md §5, architecture.md §10 |
| T-16 | Brend rangi qorong'i mavzuda o'zi emas, `color-mix` bilan yorituladi (kontrast uchun); `primaryHover/Strong/Soft` berilmasa serverda hosil qilinadi va kontrast < 4.5 bo'lsa `LOW_CONTRAST` ogohlantirishi qaytadi (rad etilmaydi) | ui-structure.md §5 |
| T-17 | E2E testlar alohida `e2e/` paketida (DB va parol xeshlash kerak — web'dan import qilish lint bilan taqiqlangan). CI'da `main`ga push va "e2e" label'li PR'larda | implementation-plan.md 6-qadam |
| T-18 | M1 komponentlaridan DataTable, Pagination, Search/FilterBar, DatePicker, FileUpload, ImportWizard, Tabs 7-qadamga qoldirildi — ular admin sahifalarida birinchi marta ishlatiladi | kod "yo'l-yo'lakay" yozilmasligi uchun |
| T-19 | Brauzer `pnpm` build skriptlari: `@parcel/watcher`, `@swc/core`, `msgpackr-extract` uchun install skriptlari taqiqlangan (`allowBuilds: false`) — tayyor binar yoki JS fallback ishlaydi | supply-chain xavfini kamaytirish |
| T-20 | Rollarni boshqarish API'si (`POST/PATCH /roles`, `PUT /roles/:id/permissions`, `POST /roles/:id/archive`, `roles.manage`): tizim rollari arxivlanmaydi (`SYSTEM_ROLE`), maktab roli tizim kodini ololmaydi (`ROLE_CODE_RESERVED`), `SUPER_ADMIN` ruxsatlarini faqat super admin o'zgartiradi, o'zini rollarni boshqarishdan mahrum qila olmaydi (`SELF_LOCKOUT`). Har o'zgarish rol egalarining auth keshini darhol bekor qiladi | rbac-matrix.md; 7-qadam |
| T-21 | `GET /audit-logs` (`audit_logs.view`): filtrlar — obyekt turi/ID, kim, amal prefiksi, `schoolDate` oralig'i; javobda `before/after` va bajaruvchi login nomi | 7-qadam (Sozlamalar → Audit) |
| T-22 | M1 menyusidagi "tez kunda" (ComingSoon) sahifalari olib tashlandi: menyuda faqat ishlaydigan va ruxsat bor sahifalar. DatePicker va FileUpload alohida komponent emas — brauzerning `type=date` va `type=file` maydonlari (mobil'da tabiiy) | T-18 davomi |
| T-23 | Import natijasida "Saqlanmadi" (`failed`) soni ham ko'rsatiladi: commit paytida yiqilgan qator `COMMIT_FAILED` bilan `ERROR` bo'ladi, qolganlari saqlanadi (har qator o'z transaction'ida). E2E shuni topdi: seed'da sinfning "butun sinf" guruhi yo'q edi | 7-qadam e2e |
| T-24 | E2E stack worker'ni ham ishga tushiradi (API bilan bitta vaqtinchalik storage papkasi); e2e'da `ARGON2_MEMORY_KIB=4096` (300+ vaqtinchalik parol xeshi), production default o'zgarmaydi | 7-qadam |
| T-25 | Demo seed (`seed:demo`) ma'lumotni Excel import bilan **bir xil** parser va commit kodi orqali yaratadi (invariantlar: butun sinf guruhi, enrollment, akkauntlar, audit). 10 sinf (1–4 va 5–9, ikkita 5-sinf), 300 o'quvchi, 600 vasiy, 40 o'qituvchi, 10 fan, har sinf × fan uchun bitta o'qituvchi. Telefonlar `+998 00 …` (bunday operator kodi yo'q). Parollar tasodifiy, ko'rsatilmaydi. **"2 smena"** M1 modelida yo'q (smena — M2 "Davrlar, smena, qo'ng'iroq jadvali") — M2'da demo seed'ga qo'shiladi | implementation-plan.md 8-qadam |
| T-26 | Staging uchun **o'z domeni shart** (`app.<domen>` + `api.<domen>`, `COOKIE_DOMAIN=<domen>`): cookie `SameSite=Lax`, `*.onrender.com` esa public suffix — web va API ikki xil sayt bo'lib qoladi. **Egasi: qaysi domen/subdomen?** Muqobil (tavsiya etilmaydi): API'ni Next.js rewrite orqali web domeniga proksilash — `TRUST_PROXY` zanjiri va rate limit IP'si murakkablashadi | DEPLOY.md §3 |
| T-27 | Xavfsizlik headerlari: API — `helmet` (CSP `default-src 'none'`, HSTS 1 yil, `Referrer-Policy: no-referrer`, CORP `same-site`) + barcha javoblarda `Cache-Control: no-store` (ochiq brending bundan mustasno, 60 s). Web — har so'rovga nonce'li CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src` faqat o'zi va API), `X-Frame-Options: DENY`, `Permissions-Policy` (kamera, mikrofon, geolokatsiya o'chiq — Face ID M6'da qayta ko'riladi). `style-src 'unsafe-inline'` qoldirildi (brend CSS o'zgaruvchilari inline; stil kod bajarmaydi) | 8-qadam |
| T-28 | Render rejalari: Starter (`worker` turi, `preDeployCommand` va Shell bepul rejada yo'q). Migratsiya API deploy'idan oldin `preDeployCommand`da; Supabase "direct" hosti IPv6 bo'lgani uchun `DIRECT_URL` = Session pooler (5432) | DEPLOY.md §1, §7 |

## M2 davomida qabul qilingan texnik qarorlar (default, egasi tasdig'iga)

| # | Qaror | Asos |
|---|---|---|
| T-29 | Dars qaysi davrga tegishli: sanani qamragan **eng kichik** davr (chorak yoki CUSTOM → yarim yil → yil). Hech qaysi davr qamramagan ish kunlarida dars yaratilmaydi va preview'da "davrsiz kunlar" ogohlantirishi chiqadi | lesson-plan.md §3; `LessonSession.periodId` majburiy |
| T-30 | Juft/toq hafta: o'quv yili boshlangan hafta — 1-hafta (toq), hafta boshi `SchoolSettings.weekStartsOn` | Q-03 |
| T-31 | `SHORTENED` kun — ish kuni, darslar odatdagidek; qisqartirilgan qo'ng'iroq jadvali keyinroq (sozlama) | spec'da qoida yo'q |
| T-32 | Qo'ng'iroq vaqti: sinf smenasining (`ClassGroup.shiftId`) jadvali, bo'lmasa smenasiz jadval; sanadan oldingi eng so'nggi `validFrom` | Q-35 |
| T-33 | O'rinbosar (Q-40): `LessonSession.substituteTeacherId`; admin (`timetable.manage`) belgilaydi. O'rinbosar shu darsni "Bugungi darslarim"da ko'radi va belgilay oladi; asosiy o'qituvchi ham ko'radi | Q-40 default (b) |
| T-34 | Yangi bosqich ruxsatlari mavjud maktablarga: bazada birinchi marta paydo bo'lgan ruxsat kodi tizim rollariga (default to'plami bo'yicha) bir marta qo'shiladi; maktab o'zgartirgan rollar va maktab rollari o'zgarmaydi. Keyin maktab xohlasa olib tashlaydi | M1 → M2 yangilanishi (staging) |
| T-35 | Jadvalda to'qnashuv (o'qituvchi/guruh/xona ikki joyda, sinf va guruhchasi bir vaqtda) bo'lsa e'lon qilinmaydi. O'qituvchining shu guruh+fanga biriktirilmagani — faqat ogohlantirish (biriktirish keyin kiritilishi mumkin). Yangi versiya `validFrom` oldingi e'lon qilingan versiyanikidan keyin bo'lishi shart | lesson-plan.md §6 |
| T-36 | Qayta generatsiya faqat **ertangi kundan** boshlab o'zgartiradi. O'tgan kunlar uchun darslar faqat yilning **birinchi** generatsiyasida, admin aniq belgilasa ("o'tgan kunlarni ham", `includePast`) yaratiladi — tizim o'quv yili o'rtasida ishga tushganda jurnal uchun. Generatsiya bekor qilgan dars (sababsiz `CANCELLED`) jadval qaytsa tiklanadi; qo'lda sabab bilan bekor qilingani tiklanmaydi | lesson-plan.md §3 |
| T-37 | Generatsiya `apply` — job emas, API ichida bitta transaction (yil bo'yicha advisory lock, 120 s timeout): bitta maktab yili ~10 ming qator, atomarlik va "preview = apply" kafolati muhimroq. Sekin bo'lsa worker'ga ko'chiriladi | api-plan.md §3 (u yerda job deyilgan) |
| T-38 | Darsning mavzusi **qotgan** hisoblanadi: dars `HELD` yoki sanasi bugun/o'tgan va mavzusi bor. Rejani qo'llash/yangi versiya/surishda qotgan darslar mavzusi o'zgarmaydi va ularning soatlari shu mavzular hisobidan chegiriladi (mavzu bo'yicha). O'tgan, lekin mavzusiz darslar mavzu oladi (yil o'rtasida birinchi marta qo'llansa). Spec acceptance 6 "18 mavzu (biri 2 soat) / 17 dars → oxirgi mavzu sig'maydi" — "rejada 18 soat" deb o'qildi; so'zma-so'z holat (19 soat → 2 mavzu sig'maydi) ham testda | lesson-plan.md §4.4, §4.6, §8 |

## M3 davomida qabul qilingan texnik qarorlar (default, egasi tasdig'iga)

| # | Qaror | Asos |
|---|---|---|
| T-39 | Policy'da `higherDefault` qoidasi: `higherPeriods` ro'yxatida yo'q yuqori davr (yarim yil, yil) shu qoida bilan hisoblanadi (default `AVERAGE`). Preset yildan yilga ko'chadi, davr id'lari har yil yangi bo'lgani uchun. `WEIGHTED` vaznlari faqat aniq davr qoidasida beriladi | scoring.md §6 default "choraklar → yarim yillik AVERAGE"; Q-11 |
| T-40 | Sessiya `SCORED` — kamida bitta **bekor qilinmagan** NORMAL yozuv bo'lsa. Hamma yozuvlari REVERSAL bilan bekor qilingan sessiya qaytadan `PENDING` (0 emas): xato qo'yilgan ball bekor qilinsa o'quvchi foizi tushmasligi uchun | scoring.md §4.1 ("net = 0 bo'lsa ham" — qisman bekor qilish yo'q, shuning uchun net 0 faqat to'liq bekor qilinganda bo'ladi) |
| T-41 | Sessiya maksimumi: amal qiladigan LESSON qoidalarining eng kichigi, bo'lmasa `lessonMaxPoints`; har doim `hardCapPerLesson`dan oshmaydi. LESSON qoidasi bo'lmasa ham `lessonMaxPoints` sessiya limiti sifatida tekshiriladi | scoring.md §3.1 5-band |
| T-42 | 5 ballik baho **yaxlitlangan** (ko'rsatiladigan) foizdan olinadi: foydalanuvchi 86 ni ko'rsa, baho ham 86 bandidan. Oraliq hisoblar to'liq aniqlikda | scoring.md §5.6 (qaysi qiymatdan — aytilmagan) |
| T-43 | MANUAL ball (Q-12): kalit davr va fan uchun amaldagi policy'dagi MANUAL komponent yoki yuqori davrning `finalComponent` kaliti bo'lishi shart. Har kiritishda o'z maksimumi bilan (masalan 15/20). O'qituvchi faqat o'zi o'qitadigan fan va guruh o'quvchisiga; tuzatish — yangi qator, eskisi tarixda | Q-12 default (a) |
| T-44 | Yopish: "tayyorlash" DRAFT natijalarni saqlaydi va hisobot beradi; "yopish" natijalarni **o'sha paytda qayta hisoblab** FINAL qiladi (tayyorlashdan keyin qo'yilgan ballar ham kiradi). Yuqori davr (yarim yil) yopilgan chorakning FINAL snapshot'idan foydalanadi, ochiq chorak — jonli hisob | scoring.md §7 |
| T-45 | Testlar komponenti M4 gacha bo'sh: default `REDISTRIBUTE` bilan davr natijasi faqat kundalik ballardan 100 ga masshtablanadi. M4 testlari ulanganda komponent to'ladi | ROADMAP M3/M4 |
| T-46 | Spec acceptance 17 ("limit 50, ishlatilgan 45, har biri +10 → bittasi o'tadi") — 45+10 = 55 > 50, ikkalasi ham rad etilardi. Test "ishlatilgan **40**" bilan yozildi (bittasi o'tadi, ikkinchisi rad) | scoring.md §11 |
| T-47 | Davr yopilgandan keyin o'zgargan ball/davomat/MANUAL ball — FINAL natija o'zgarmaydi, "eskirgan" belgisi o'sha davr va undan yuqori davrlarning FINAL natijalariga qo'yiladi. `recompute` faqat eskirgan o'quvchilar uchun yangi FINAL versiya yaratadi, sabab majburiy | scoring.md §7.3 |


## M4 davomida qabul qilingan texnik qarorlar (default, egasi tasdig'iga)

C bo'limi (Q-19…Q-22, Q-36, Q-45) tavsiya etilgan default bilan qilindi (egasi 2026-11-03 tasdiqladi): `multipleScoring` testda (default
`ALL_OR_NOTHING`); buzilish **3-chisida** yakunlanadi (`violationThreshold`, 0 = o'chiq); to'g'ri javoblar o'quvchiga
**ko'rsatilmaydi** (faqat ✅/❌ — oyna yopilgach); retake va individual vaqt — `tests.reopen` (admin, direktor
o'rinbosari); `maxQuestionsPerTest` = 50 (maktab sozlamasi, 1–200), minimal chegara yo'q; offline shkala — spec ro'yxati.

| # | Qaror | Asos |
|---|---|---|
| T-48 | Qoralamaga qo'shilgan savol e'lon paytida bankdagi **joriy** versiyasini oladi (o'qituvchi qoralama davomida savolni tuzatgan bo'lishi mumkin). Qo'lda o'zgartirilgan ball saqlanadi; versiyaning standart balli yangi versiya bilan almashadi. E'londan keyin versiya qotadi (acceptance 9) | tests.md §2 ("testda ishlatilgan versiya o'zgarmaydi") |
| T-49 | Umumiy oynada **bitta** urinish. Retake oynasi (`TestWindowOverride`) — u **berilgan paytdan** keyin boshlangan bitta urinish; oynaning o'z vaqt limiti bo'lishi mumkin. Pool testda savollar urinish boshlanganda tanlanadi (seed = urinish id) | tests.md §4.2, §5 |
| T-50 | Vaznli test natijasi yo'q bo'lsa: test hali ochiq (yoki o'quvchining retake oynasi ochiq) yoki offline `EXCUSED` — **kutilmoqda** (hisobga olinmaydi, `missedTest = ZERO` bo'lsa ham); test tugagan yoki offline `ABSENT` — **qatnashmagan** (`missedTest` bo'yicha). Offline natija kiritilmagan bo'lsa — kutilmoqda (avtomatik 0 yo'q) | scoring.md §5.2, tests.md §6 |
| T-51 | Retake'da qaysi natija hisoblanishi — **testning** `retakePolicy`si (LAST/BEST); policy'dagi `retakePolicy` faqat testda ko'rsatilmagan holat uchun | tests.md §5 ("WEIGHTED testda qaysi natija hisoblanishi — retakePolicy") |
| T-52 | Anti-cheat: bir xil tur 2 s ichida — bitta; `BLUR` va `VISIBILITY_HIDDEN` 2 s ichida bir-biriga yaqin bo'lsa ham **bitta** buzilish (tab almashtirish ikkalasini ham chiqaradi). `VISIBLE`, `FOCUS`, `RECONNECT` hech qachon sanalmaydi | tests.md §4.4 |
| T-53 | Tarix bog'lanishi (`supersededById`) unique emas: ikkinchi tuzatishda eski ko'rsatkich bilan to'qnashardi (M3 MANUAL ballarida ham shu xato bor edi) — `20261104150000_m4_history_chain` migratsiyasi tuzatdi. "Bitta joriy qator" kafolati partial unique indeksda qoladi | xato tuzatish |
| T-54 | O'qituvchi faqat **o'z** testlarini ko'radi va boshqaradi; direktor, o'rinbosar, uslubchi — barcha testlar (natijalarni ko'rish). Test faqat o'qituvchining **o'z guruhlariga** va testning **paralleliga** mos guruhlarga beriladi | rbac-matrix, xavfsizlik |
| T-55 | Natijalar Excel eksporti (`tests.results.view`) savol matnini o'z ichiga oladi, lekin to'g'ri javoblarni emas. Savollar va javoblar faqat `questions.export` bilan (S4) | security-baseline.md S4 |
| T-56 | Savol bo'yicha o'rtacha vaqt o'lchanmaydi (spec: "agar o'lchansa"). Taqqoslash: shu o'qituvchining shu fan va paralleldagi oldingi testi + testga biriktirilgan guruhlar kesimi | tests.md §8 |

## M5 davomida qabul qilingan texnik qarorlar (egasi 2026-11-04 tasdiqladi)

| # | Qaror | Asos |
|---|---|---|
| T-57 | Limitlarga faqat o'qituvchi baholari (`TEACHER_CRITERION`) kiradi. Avtomatik coin, admin tuzatishi, xarid va qaytarish limitni band qilmaydi. Bekor qilingan baho hisobga olinmaydi, kamaytirilgani yangi miqdorda bitta baho sifatida sanaladi (EdexTest bilan bir xil) | MASTER_SPEC §14, edextest-audit §5 |
| T-58 | O'qituvchi **o'z** bahosini **shu kuni** sababsiz bekor qila oladi (tez baholashdagi xato bosish uchun). Boshqa holatlarda `coins.reverse` (admin, direktor o'rinbosari) va sabab kerak. Kamaytirish (correction) faqat `coins.reverse` bilan va faqat pastga | CLAUDE.md §4 (reversal) |
| T-59 | Qarz chegarasi faqat jarima, bekor qilish, kamaytirish va admin ayirishiga qo'llanadi. Xarid hech qachon balansni 0 dan pastga tushirmaydi, qarzdor o'quvchi xarid qila olmaydi. Mukofot avval qarzni yopadi (ledger yig'indisi) | MASTER_SPEC §14 "Coin debt" |
| T-60 | Test natijasi uchun avtomatik coin: bitta o'quvchiga bitta testdan **bir marta** (`sourceRef = test:<id>`), qoidalardan eng kattasi. Onlayn test yopilganda, yopiq testda retake tugaganda va offline natija saqlanganda beriladi. Natija keyin ko'tarilsa (masalan, offline tuzatish) va hali coin olinmagan bo'lsa, beriladi. Coin keyin qaytarib olinmaydi. Anti-cheat bilan tugagan urinish coin olmaydi | MASTER_SPEC §14 "Avtomatik coin" |
| T-61 | `orderApprovalRequired = false` bo'lsa buyurtma darhol `APPROVED` bo'ladi (topshirish baribir xodim tomonidan). O'quvchi faqat `PENDING` buyurtmasini bekor qila oladi; xodim `APPROVED`ni ham bekor qilishi mumkin. Rad etish va bekor qilish narxni qaytaradi va mahsulotni qoldiqqa qaytaradi | MASTER_SPEC §14 "Coin Shop" |
| T-62 | O'quvchining do'kon va buyurtma amallari `portal.student` ruxsati bilan (`coin_shop.order` alohida kod qo'shilmadi — M4'dagi `tests.take` kabi portal doirasida) | api-plan.md §6 |
| T-63 | O'qituvchi faolligi faqat coin baholari bo'yicha: so'nggi N maktab kunida o'qituvchi o'z guruhlaridagi o'quvchilarning kamida X foizini baholagan bo'lishi kerak; oxirgi bahodan keyin `staleDays` kundan ko'p o'tsa — kam faol | MASTER_SPEC §14 |
| T-64 | `cached balance` (`CoinAccount`) har kecha ledger yig'indisi va oxirgi `balanceAfter` bilan solishtiriladi. Farq faqat logga yoziladi, avtomatik tuzatilmaydi | edextest-audit §5 |

## M6 davomida qabul qilingan texnik qarorlar (default, egasi tasdig'iga)

| # | Qaror | Asos |
|---|---|---|
| T-65 | Terminal hodisasi qurilma kaliti bilan qabul qilinadi (yo'lda, chunki Hikvision header yubora olmaydi). Kalitning faqat SHA-256 hash'i saqlanadi, URL logda niqoblanadi, noto'g'ri kalitlar IP bo'yicha cheklanadi (10 daqiqada 30 ta). Bu va Bridge protokoli `public-routes.ts`ga qo'shildi (user tokenisiz, o'z kaliti bilan) | MASTER_SPEC §11 webhook; security-baseline S1 |
| T-66 | Xom hodisalar (`AccessEvent`) o'zgartirilmaydi va o'chirilmaydi. `(qurilma, serialNo)` takror pushni bitta yozuvga aylantiradi. Kunlik yozuv (`AttendanceRecord`) hodisalardan qayta hisoblanadi; qo'lda belgi qurilma natijasi yonida saqlanadi va undan ustun turadi. Soati 5 daqiqadan ko'p oldinda yoki 7 kundan eski hodisa qabul qilinmaydi. Faqat "yuz tasdiqlandi" (minor 75) hodisa hisoblanadi, ro'yxat sozlanadi | CLAUDE.md §4 (ledger), §11 |
| T-67 | Kelish = kunning birinchi kirishi, ketish = undan keyingi oxirgi chiqish. BOTH terminal checkIn/checkOut statusini ishlatadi, status bo'lmasa birinchi hodisa kelish, qolgani ketish | MASTER_SPEC §11 Direction |
| T-68 | Yuz rasmi terminal qabul qiladigan JPEG'ga keltiriladi (≤ 640 px, ≤ 200 KB, EXIF burilishi, metama'lumot olib tashlanadi), AES-256-GCM bilan shifrlanadi (`DATA_ENCRYPTION_KEY`). Asl fayl va eski versiyalar saqlanmaydi. Hodisa bilan kelgan snapshot rasmlari saqlanmaydi. Maktabdan ketgan o'quvchi yuzi har kecha qurilmalardan va serverdan o'chiriladi | MASTER_SPEC §11 Xavfsizlik |
| T-69 | Har qurilma × o'quvchi uchun bitta `FaceSyncJob` (joriy holat) va topshiriq (`BridgeJob`). Yangi rasm navbatdagi eski topshiriqni bekor qiladi. Bridge topshiriqni 2 daqiqaga ijaraga oladi; javob kelmasa qayta beriladi, 5 martadan keyin "xato". Qayta yuborish admin tugmasi bilan | MASTER_SPEC §11 Face ID oqimi |
| T-70 | Bridge: Node.js, WinSW bilan Windows Service. Hodisalar avval diskka (atomik fayl), keyin serverga. Har 15 daqiqada va har uzilishdan keyin terminal jurnalini o'qib serverga yuboradi (5 daqiqa ustma-ust, takrorlar bir marta saqlanadi). Token 30 kunda o'zi almashadi (eski token 10 daqiqa ishlaydi); admin almashtirsa eski darhol o'ladi. Terminal paroli Bridge'ga heartbeat javobida (TLS) beriladi va faqat xotirada turadi | MASTER_SPEC §11 Bridge |
| T-71 | Server terminalga o'zi ulana olsa (`useBridge = false`), topshiriqlarni worker (`devices` navbati) bajaradi — Bridge bilan bir xil kod (`packages/hikvision`) | MASTER_SPEC §3 (serverless emas) |
| T-72 | Davomat coini kun smena tugagach, bir marta (`sourceRef = attendance:<sana>`) beriladi va keyin qayta ko'rilmaydi. Qo'lda belgilangan kun, dam olish kuni va hech bir oraliqqa tushmagan kechikish uchun coin yo'q. Jarima qarz chegarasidan oshmaydi (oshgan qismi olinmaydi). Davomat coinlari limitlarga kirmaydi (T-57) | MASTER_SPEC §11, §14 |
| T-73 | Ruxsatlar: `attendance.view`, `attendance.mark`, `attendance.settings.manage`, `devices.manage`, `face.manage`. Direktor — ko'rish; o'rinbosar — ko'rish va qo'lda belgilash; sinf rahbari — o'z sinfini ko'rish; qurilma, yuz va sozlamalar — admin | rbac-matrix.md |


## 1-bosqich auditi qarorlari (egasi 2026-11-05 tasdiqladi)

Audit: https://claude.ai/artifact/NvVRtFeT8jZLW7pgvS4Rb6 (Q1–Q5). Egasi tavsiyalarni qabul qildi.

| # | Qaror | Asos |
|---|---|---|
| T-74 | **Rollar.** 9 ta tizim roli va ruxsatlar matritsasi saqlanadi. Brifdagi ADMIN / TEACHER / STUDENT — navigatsiya kontekstlari: maktab, o'qituvchi, portal. Vasiy portali M7 rejasida qoladi | rbac-matrix.md; brif bilan ziddiyat Q1 |
| T-75 | **Face ID ma'lumoti.** Terminalga faqat ichki kod (`employeeNo`) va yuz rasmi yuboriladi, telefon yuborilmaydi. Telefon raqami shaxs kartasida: xodim uchun o'ziniki (majburiy), o'quvchi uchun ixtiyoriy; bo'lmasa xabarlar vasiy telefoniga. Voyaga yetmagan o'quvchi yuzi faqat qayd etilgan vasiy roziligi bilan saqlanadi (5-bosqich) | brif "face image + phone"; MASTER_SPEC §11 |
| T-76 | **Xodim davomati.** Xodimlar ham Face ID bilan: `FaceProfile`/`AccessEvent`ga yangi migratsiyada `subjectType` (STUDENT / EMPLOYEE) va `employeeId`, mavjud qatorlar STUDENT bo'lib qoladi. Birinchi navbatda faqat kelish, ketish, kechikish va hisobot; ish haqi bilan bog'lash alohida qaror | brif; Q3 |
| T-77 | **Mezon limitlari.** `ScoreLimitRule`ga ixtiyoriy `criterionId` scope, `ScoreCriterion`ga `minPoints` / `maxPoints` (Decimal) va tur. Yangi ustunlar nullable: eski qoidalar avvalgidek ishlaydi. O'zgarish siyosatning yangi versiyasi, yopilgan davr natijalari o'zgarmaydi (4-bosqich) | brif; scoring.md; Q4 |
| T-78 | **Moliya.** To'lovlar hozirgi bosqichlarga kirmaydi; keyin alohida bosqich (M9) sifatida spec yoziladi | ROADMAP.md; Q5 |

## Audit 4-bosqichi (mezon limitlari) — qarorlar va ochiq savol

| # | Qaror | Asos |
|---|---|---|
| T-79 | T-77 amalga oshirildi: limit qoidasining yangi turi `CRITERION` (aniq mezon yoki "hammasi (default)" — har mezon uchun alohida). Mezonsiz baho mezon qoidalariga kirmaydi. Bir baho mezon chegarasidan (`minPoints` / `maxPoints`) tashqarida bo'lsa — `VALIDATION_ERROR` (`above_criterion_max` / `below_criterion_min`, `limit`), limit tekshiruvidan oldin. Bekor qilingan (reversal) ball limitni bo'shatadi. Tekshiruv o'quvchi lock'i ostida, bir transaction'da | T-77; CLAUDE.md §4 |
| T-80 | Tuzatish (T-77 matniga): limit qoidalari siyosat versiyasiga kirmaydi (M3'dagidek `isActive` qatorlar). Ular faqat yangi yozuvni tekshiradi, shuning uchun yopilgan davr natijalari va eski yozuvlar o'zgarmaydi | scoring.md §3.1 |

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-53 | Mezon "turi" (masalan, jarima mezoni — manfiy ball)? | Hozir ball doim musbat (`ScoreEntry_kind_check`, `PointsSchema`); manfiy ball davr formulalari, foizlar va limitlarni o'zgartiradi | (a) tur yo'q, jarima faqat coin'da; (b) `PENALTY` turi va manfiy ball — alohida spec | (a): jarimalar coin tizimida bor (M5). Ballda jarimaga ehtiyoj bo'lsa, alohida spec bilan | Egasi |

## Audit 5-bosqichi (Face ID: rozilik va xodimlar) — qarorlar va ochiq savollar

| # | Qaror | Asos |
|---|---|---|
| T-81 | Rozilik (`FaceConsent`): kim bergan (bog'langan vasiy yoki boshqa shaxs ismi), sana (kelajakda emas), kim qayd etgan. Bir o'quvchida bitta amaldagi rozilik. Bekor qilish sabab bilan; yuz shu transaction'da serverdan o'chadi va terminallardan o'chirish navbatga qo'yiladi. Rozilik qatori o'chirilmaydi — tarix. Yuklash va bekor qilish bitta advisory lock ostida (bekor qilish yuklash bilan "poyga"da yutqazmaydi). Sozlama `faceConsentRequired` (default yoqilgan) | T-75 |
| T-82 | Yuz rasmini ko'rish (`GET .../photo`) `AuditLog`ga yoziladi (`face.photo.view`) | audit topilmasi (Low) |
| T-83 | Xodim yuzi: terminaldagi raqam `E-<xodim kodi>`; xodim kodi va xodimning o'z telefoni majburiy, rozilik shart emas (voyaga yetgan). `FaceProfile`/`FaceSyncJob` — o'quvchi yoki xodim (aniq bittasi), `AccessEvent.employeeId`. Ketgan xodimning yuzi har kecha o'chiriladi (o'quvchidagidek) | T-76 |
| T-84 | Xodim kuni o'qishda hisoblanadi: birinchi IN, oxirgi OUT; kechikish va erta ketish `staffStartMinute`/`staffEndMinute` (default 08:00–17:00) va imtiyozli daqiqalar bo'yicha. Terminal ma'lumoti yo'q kun — "ma'lumot yo'q", kelmadi emas. Ko'rish: `employees.view` | T-76 |

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-54 | T-75'dan oldin yuklangan o'quvchi yuzlari (roziliksiz) nima bo'ladi? | Hozir ular saqlanib qoladi va terminalda ishlaydi; faqat yangi yuklash rozilik so'raydi | (a) qoldirish va ro'yxatda "rozilik yo'q" deb ko'rsatish; (b) muddat berib, roziliksizlarini avtomatik o'chirish | (b) haqiqiy ma'lumotga o'tishdan oldin: 30 kun muddat, keyin o'chirish (Face Check'da "rozilik yo'q" filtri bilan) | Egasi |
| Q-55 | Xodimlar uchun dam olish kunlari va ish jadvali | Hozir dam olish kunida o'tish bo'lmasa "ma'lumot yo'q" chiqadi; smenali xodimlar uchun bitta ish kuni yetmaydi | (a) maktab kalendaridan olish; (b) xodim smenasi | (a) birinchi navbatda, (b) ish haqi bilan birga | Egasi |

| # | Qaror | Asos |
|---|---|---|
| T-85 | **Q-54 hal qilindi (egasi, 2026-11-11: "Ha, shunday").** Rozilik qoidasidan oldin saqlangan o'quvchi yuzlari uchun 30 kun: mavjud maktablarda `faceConsentGraceEndsOn` = migratsiya kuni (Asia/Tashkent) + 30. Muddat o'tgach, tungi tozalash amaldagi roziligi yo'q o'quvchi yuzini serverdan va terminallardan o'chiradi (`face.consent.expired` audit). Shu payt qayd etilgan rozilik (lock ostida tekshiriladi) yuzni saqlab qoladi. Qoida o'chirilgan bo'lsa hech narsa o'chmaydi. Face Check'da "rozilik yo'q" belgisi, filtr va muddat ogohlantirishi; muddatni sozlamalar API'si orqali o'zgartirish mumkin | Q-54 |
| T-86 | **Q-55 hal qilindi (egasi, 2026-11-11: "Ha, kalendardan").** Xodimlarning ish kuni sanani o'z ichiga olgan o'quv yili kalendaridan: ish haftasi kunlari va butun maktabga tegishli belgilar (bayram, ishlamaydigan kun, ish kuni almashtirish). Faqat ayrim parallellarga belgilangan kun xodimlar uchun oddiy ish kuni. O'quvchilar ta'tili (VACATION) xodimlar uchun ish kuni. O'quv yilidan tashqarida — standart ish haftasi. Dam olish kunida kelmaganlar ro'yxatda yo'q, kelganlar kechikishsiz "keldi" | Q-55 |

## Hosting o'zgarishi

| # | Qaror | Asos |
|---|---|---|
| T-87 | **Frontend Vercel'ga (egasi, 2026-11-09: "Ha, tayyorla").** `apps/web` — Vercel (Root Directory `apps/web`, `apps/web/vercel.json`, region `fra1`). API va worker Render'da qoladi, `render.yaml`dan `idrok-web` olib tashlandi. Login uchun `app.<domen>` (Vercel) va `api.<domen>` (Render) bitta domen ostida bo'lishi shart (`COOKIE_DOMAIN`); `*.vercel.app` preview'larda login ishlamaydi. Kod o'zgarmadi: API manzili runtime env'dan (`API_PUBLIC_URL`). Haqiqiy ma'lumot baribir faqat VPS'da | `docs/DEPLOY.md` §2b |
| T-88 | **Frontend hozircha Render'da (egasi, 2026-11-09).** Sinov (UAT) bosqichi Render + Supabase'da: `idrok-web`, `idrok-api`, `idrok-worker`, `idrok-redis` — hammasi `render.yaml`da. Vercel sozlamasi (`apps/web/vercel.json`, DEPLOY §2b) muqobil sifatida qoladi. Sinov rejasi: `docs/testing/UAT.md` | T-87 o'rniga |

## M7 (vasiy portali va Telegram) — texnik qarorlar (default, egasi tasdig'iga)

Reja va oqimlar: `docs/architecture/m7-telegram.md`.

| # | Qaror | Asos |
|---|---|---|
| T-89 | **Bitta bot — bitta deploy.** Bot tokeni va webhook siri env'da (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`). Webhook'dan kelgan yangilanish `DEFAULT_TENANT_SLUG` maktabiga tegishli. Ko'p maktab bo'lsa — har maktabga alohida bot (keyin `TelegramBot` jadvali) | CLAUDE.md §1 (bitta maktab, multi-tenant'ga tayyor) |
| T-90 | **Webhook.** `POST /telegram/webhook` — faqat `X-Telegram-Bot-Api-Secret-Token` to'g'ri bo'lsa (timing-safe). Yangilanish `TelegramUpdate`ga `(tenant, update_id)` unique bilan yoziladi va outbox orqali worker'ga beriladi — takror yuborilgan update bir marta ishlanadi. Javob har doim tez `200`. Xom payload ishlangandan keyin o'chiriladi (telefon raqami saqlanib qolmasin), qatorning o'zi 7 kundan keyin tozalanadi | MASTER_SPEC §19; CLAUDE.md §4 (idempotent) |
| T-91 | **Bog'lash.** (a) Kontakt: faqat foydalanuvchining **o'z** kontakti (`contact.user_id = from.id`), telefon E.164 ga keltiriladi va faol farzand bog'lanishi bor **aynan bitta** vasiyga mos kelsa bog'lanadi; bir nechta yoki hech biri bo'lmasa — "maktabdan kod so'rang". (b) Kod: admin beradi, 10 belgili, faqat SHA-256 hash saqlanadi, bir marta ishlatiladi, 72 soat (sozlama) amal qiladi; yangi kod eskisini bekor qiladi; noto'g'ri kod Telegram foydalanuvchisi bo'yicha cheklanadi (15 daqiqada 5 ta). Bir vasiy — bitta Telegram, bitta Telegram — bitta vasiy: yangi bog'lash eskisini bekor qiladi. Bog'lash va uzish `AuditLog`ga yoziladi | ROADMAP M7 |
| T-92 | **Mini App kirishi.** `initData` serverda HMAC-SHA256 bilan tekshiriladi (`WebAppData` kaliti), `auth_date` 24 soatdan eski bo'lsa rad etiladi. Bog'langan vasiyga `TELEGRAM` turidagi sessiya (bearer access + refresh). Vasiyning portal akkaunti bo'lmasa, birinchi kirishda **avtomatik yaratiladi** (login = telefon, parol yo'q — veb-kirish uchun admin vaqtinchalik parol beradi). Telegram sessiyasida vaqtinchalik parolni almashtirish talab qilinmaydi (kirish Telegram orqali tasdiqlangan). Uzilganda shu vasiyning barcha Telegram sessiyalari bekor bo'ladi | Q-26; security-baseline S2 |
| T-93 | **Bildirishnomalar** markazlashgan: hodisa → `Notification` qatori (`(vasiy, dedupeKey)` unique — bir hodisa uchun bitta xabar) → outbox → `notifications` navbati → Telegram. Telegram ishlamasa va SMS zaxira yoqilgan bo'lsa — SMS (hozir provayder yo'q: interfeys va sozlama, xabar "provayder yo'q" bilan o'tkazib yuboriladi). Faqat `receivesNotifications` va `canViewData` yoqilgan faol bog'lanishdagi vasiylarga | MASTER_SPEC §19 |
| T-94 | **Turlari va vaqti.** Kelish — darhol (kechikish daqiqasi bilan); ketish — oxirgi chiqishdan 10 daqiqa keyin (sozlama), kuniga bitta. Faqat **bugungi** kun uchun (eski hodisalar qayta ishlansa xabar yo'q). Ballar va coinlar — **kunlik xulosa** (default 19:00): bugungi ballar soni/yig'indisi fanlar kesimida, bugungi coin o'zgarishi va balans. Test natijasi — test yopilganda, o'quvchiga natija ko'rsatilishi ruxsat etilgan bo'lsa, faqat umumiy ball/foiz (S4). Past davomat — har dushanba, so'nggi 30 kun (sozlama) davomati 80% (sozlama) dan past bo'lsa, haftasiga bir marta. To'lov/qarzdorlik — moliya bosqichida (T-78) | MASTER_SPEC §19; Q-56 |
| T-95 | **Tinch soatlar va cheklov.** Maktab default'i 22:00–07:00, vasiy o'zi o'zgartira yoki o'chira oladi; tinch soatga to'g'ri kelgan xabar tinch soat tugashiga suriladi. Bitta vasiyga soatiga 10 tadan ko'p xabar yuborilmaydi (ortig'i "cheklov" bilan o'tkazib yuboriladi; ommaviy xabar cheklovga kirmaydi). Telegram umumiy cheklovi uchun navbat sekundiga 25 ta xabar. Bot bloklangan bo'lsa (`403`) bog'lanish "bloklangan" deb belgilanadi va keyingi xabarlar yuborilmaydi | Telegram Bot API cheklovlari |
| T-96 | **Ommaviy xabar.** Tanlangan sinflar (joriy o'quv yili, faol o'quvchilar) vasiylariga; avval ko'rib chiqish (qabul qiluvchilar soni, bog'langanlari), keyin tasdiqlash. Yuborish tarixi va holati saqlanadi, amal `AuditLog`ga yoziladi. Ruxsat: `notifications.broadcast` (admin, direktor o'rinbosari). Telegram boshqaruvi (bog'lanish holati, kod, uzish, sozlamalar): `telegram.manage` (admin, direktor o'rinbosari) | MASTER_SPEC §19 "Ommaviy xabar" |
| T-97 | Bot va bildirishnoma matnlari `apps/api/src/modules/telegram/locales/{uz,ru}.json`da. Til: vasiy portalida tanlagan til, bo'lmasa Telegram tili (`ru` → rus, qolgani o'zbek) | CLAUDE.md §4 UI |

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-56 | Ball va coin xabarlari: har biri darhol yoki kunlik xulosa? | Har bahoga xabar — kuniga o'nlab xabar, vasiy botni o'chirib qo'yishi mumkin | (a) kunlik xulosa; (b) har bir baho/coin darhol; (c) ikkalasi, vasiy tanlaydi | (a) — hozir shunday qilindi (`digestMinute` sozlamasi) | Egasi |
| Q-57 | SMS provayder (Eskiz, Play Mobile va h.k.) | SMS zaxira kanal faqat provayder bilan ishlaydi; narx | provayder tanlash va shartnoma | Hozir faqat interfeys (`SmsProvider`) va sozlama (`smsFallbackEnabled`, default o'chirilgan) | Egasi |
| Q-58 | Ommaviy xabar doirasi: faqat sinflar yetarlimi? | Spec: o'quv yili, sinf, guruh, kanal | (a) sinflar (+ "butun maktab" = barcha sinflar); (b) + o'quv guruhlari, Telegram kanali | (a) hozir; (b) keyin | Egasi |
