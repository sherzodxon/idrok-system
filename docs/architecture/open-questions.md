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
