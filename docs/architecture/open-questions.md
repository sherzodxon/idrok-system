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

## B. Ball va davriy baholash (M3 dan oldin)

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

## C. Test tizimi (M4 dan oldin)

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-19 | **Bo'shliq:** `multipleScoring` (§4.6) `Test` modelida yo'q | MULTIPLE baholash | testda / maktab sozlamasida | Testda maydon (qoralamada qo'shildi), default `ALL_OR_NOTHING` | Texnik |
| Q-20 | Buzilish chegarasi: EdexTest'da 3 ogohlantirish, **4-chi**da yakunlanadi; spec'da "threshold 3 → **uchinchi**da yakunlanadi" | O'quvchilar uchun qoida o'zgaradi | 3-chida / 4-chida | Spec bo'yicha (3-chida), o'quvchilarga oldindan e'lon | Maktab |
| Q-21 | O'quvchiga test tugagach to'g'ri javoblar ko'rsatiladimi? | Bank savollari qayta ishlatiladi; EdexTest API'si oshkor qilgan | hech qachon / test yopilgandan keyin / darhol | Hech qachon (faqat ✅/❌), testda `revealCorrectAnswers` sozlamasi | Maktab |
| Q-22 | Retake / individual vaqtni kim beradi: o'qituvchi yoki faqat admin? | EdexTest'da faqat admin; spec'da o'qituvchi | o'qituvchi (o'z testi) / admin | `tests.reopen` — admin va direktor o'rinbosari; o'qituvchiga keyin berish mumkin | Maktab |
| Q-36 | Savollar soni chegarasi (`maxQuestionsPerTest`) va minimal soni | Test yaratish validatsiyasi | EdexTest: kamida 15 | Min chegarasi yo'q, max 50 | Maktab |
| Q-45 | Offline test shkalalari: faqat {5,10,20,25,40,50,100} (spec) yoki ixtiyoriy (EdexTest 2–1000)? | DB CHECK | ro'yxat / ixtiyoriy | Spec ro'yxati | Maktab |

## D. Coin (M5 dan oldin)

| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |
|---|---|---|---|---|---|
| Q-23 | Xodimlarga ham coin beriladimi (Registo'da bor)? | Ledger modeli `studentId` bilan | faqat o'quvchi / xodim ham | Faqat o'quvchi; xodim — kengaytirish nuqtasi | Maktab |
| Q-24 | Coin qarzi yoqiladimi va chegarasi? Balans yangi o'quv yilida nolga tushadimi? | Jarima va do'kon qoidalari | qarzsiz / chegara bilan; nolga tushadi / yo'q | Qarz o'chiq; balans yillar osha saqlanadi (EdexTest bilan bir xil) | Maktab |
| Q-25 | Coin mezonidan kim foydalana oladi: har mezon uchun tanlangan o'qituvchilar yoki hamma? | `CoinCriterion.eligibility` | ALL_TEACHERS / SELECTED | SELECTED (EdexTest bilan bir xil) | Maktab |
| Q-44 | Haftalik ommaviy reyting ekrani (EdexTest'da autentifikatsiyasiz `/public/weekly`) kerakmi? | Voyaga yetmaganlar ism-familiyasi ochiq | yo'q / maxsus token bilan TV ekrani / faqat ichki | Faqat ichki (login bilan); TV uchun keyin alohida token | Maktab + Egasi |

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
