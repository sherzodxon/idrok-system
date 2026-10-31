# Spec: Test tizimi (M4)

EdexTest mantig'i referens sifatida o'rganiladi (M0 auditi: `docs/architecture/edextest-audit.md`), lekin kod yangi arxitekturaga moslab yoziladi. Ma'lumot ko'chirilmaydi.

## 1. Tushunchalar

- **Shakl** (`format`): `ONLINE` | `OFFLINE`.
- **Vazifa** (`purpose`): `PRACTICE` (mustaqil statistika) | `WEIGHTED` (davriy natijaga kirishi mumkin).
- Shakl va vazifa mustaqil: 4 kombinatsiya ham ishlaydi.
- **Test turi** (`TestType`): admin boshqaradigan ro'yxat — ChSB, BSB, Nazorat ishi, Sinov testi, Oddiy test, + maxsus turlar.
- **Auditoriya**: hozir faqat `STUDENT`. Model `audience` maydoni bilan `LEAD`/`CANDIDATE` uchun kengaytiriladi (CRM bosqichida). Hozir ular uchun kod yozilmaydi.

## 2. Modellar

```
TestType         id, tenantId, name, code, isSystem, isActive

Question         id, tenantId, ownerId (o'qituvchi), subjectId, gradeId, topicId?,
                 type(SINGLE|MULTIPLE|SHORT_TEXT|MATCHING), difficulty(EASY|MEDIUM|HARD),
                 status(ACTIVE|ARCHIVED), currentVersionId, sharedWithSubject(bool)
QuestionVersion  id, questionId, version, text, imageAssetId?, points (default 1),
                 options (JSON: [{id, text, imageAssetId?, isCorrect}]),
                 acceptedAnswers? (SHORT_TEXT), pairs? (MATCHING: [{leftId, left, rightId, right}]),
                 explanation?, contentHash, createdAt
                 -- testda ishlatilgan versiya hech qachon o'zgarmaydi. Tahrir = yangi versiya.

Test             id, tenantId, title, description?, subjectId, gradeId, teacherId,
                 testTypeId, format, purpose, status(DRAFT|SCHEDULED|OPEN|CLOSED|ARCHIVED),
                 startsAt?, endsAt?, timeLimitMinutes?,
                 questionCount?, shuffleQuestions, shuffleOptions,
                 selection (JSON: qo'lda tanlangan yoki pool qoidasi — mavzu/qiyinlik bo'yicha),
                 maxScore (OFFLINE: shkala 5|10|20|25|40|50|100; ONLINE: savollar ballari yig'indisi),
                 -- weighted:
                 periodId?, weight? (nisbiy vazn), includedInAssessment(bool), retakePolicy(LAST|BEST),
                 -- anti-cheat:
                 violationThreshold (default 3, 0 = o'chiq), showResultToStudent(IMMEDIATE|AFTER_CLOSE|NEVER),
                 planItemId? (dars rejasidagi nazorat ishi bilan bog'lanish)

TestQuestion     testId, questionVersionId, order, points
TestAssignment   testId, teachingGroupId? | studentId?  -- sinfga yoki tanlangan o'quvchilarga
TestWindowOverride testId, studentId, startsAt, endsAt, timeLimitMinutes?, reason, createdById
                 -- retake va individual vaqt

TestAttempt      id, tenantId, testId, studentId, attemptNo,
                 status(IN_PROGRESS|FINISHED), finishReason(SUBMITTED|TIME_UP|VIOLATION|ADMIN_CLOSED),
                 startedAt, deadline, finishedAt?, currentIndex,
                 questionOrder (JSON: testQuestion id lar), optionOrder (JSON: savol → option id tartibi),
                 violationCount, score?, maxScore, percent?, gradedAt?
                 unique(testId, studentId, attemptNo)
TestAnswer       attemptId, testQuestionId, answer (JSON: optionIds[] | text | pairs),
                 savedAt, clientSeq, isCorrect?, pointsAwarded?
                 unique(attemptId, testQuestionId) — upsert faqat clientSeq kattaroq bo'lsa
TestEvent        id, attemptId, type(VISIBILITY_HIDDEN|VISIBILITY_VISIBLE|BLUR|FOCUS|RECONNECT|...),
                 clientTs, serverTs, clientSeq, counted(bool)

OfflineResult    id, testId, studentId, rawScore?, status(SCORED|ABSENT|EXCUSED),
                 enteredById, enteredAt, note?
                 -- tuzatish: yangi yozuv + eski yozuvga supersededById (tarix saqlanadi)
```

## 3. Savollar banki

- Har o'qituvchida shaxsiy bank. `sharedWithSubject = true` savollarni shu fan o'qituvchilari ko'radi va testga qo'sha oladi (tahrirlay olmaydi).
- Har savol mavzuga (`topicId`) bog'lanadi — M2'dagi `Topic`. Majburiy emas, lekin UI'da tavsiya etiladi ("mavzusiz savollar" filtri bor). Bu AI feedback uchun asosiy ma'lumot.
- Rasm: `StorageProvider` orqali, MIME va hajm tekshiruvi.
- **Excel import** (preview → tasdiqlash):
  `Savol | Turi | A | B | C | D | E | F | To'g'ri javob | Ball | Mavzu | Qiyinlik | Izoh`
  - To'g'ri javob: `B` yoki `A,C` (MULTIPLE) yoki matn variantlari `;` bilan (SHORT_TEXT).
  - MATCHING Excel'da qo'llab-quvvatlanmaydi (UI orqali).
  - Mavzu nomi mavjud `Topic` bilan solishtiriladi; topilmasa ogohlantirish (yaratilmaydi, o'qituvchi tanlaydi).
  - Dublikat tekshiruvi: normalizatsiyalangan matn + variantlar `contentHash`. Preview'da "allaqachon bor" deb belgilanadi.
- Export: bir xil formatda.
- "Bu sinfga avval berilgan" belgisi: savol (barcha versiyalari) shu guruhga oldingi testlarda ishlatilganmi.
- Admin sozlamasi: `maxQuestionsPerTest`.

## 4. Online test oqimi

### 4.1. Yaratish va chop etish
- DRAFT → savollar tanlanadi (qo'lda yoki pool qoidasi: "Sikllar mavzusidan 5 ta, Massivlardan 5 ta, qiyinlik aralash").
- Chop etishda serverda validatsiya: savollar soni ≥ `questionCount`, har savol to'g'ri tuzilgan (SINGLE'da aynan 1 to'g'ri javob, MULTIPLE'da ≥1), vaqtlar mantiqiy, WEIGHTED bo'lsa `periodId` va `weight` bor va davr `CLOSED` emas.
- `startsAt`/`endsAt` bo'lsa → `SCHEDULED`, vaqt kelganda `OPEN`, tugaganda `CLOSED` (BullMQ delayed job + lazy tekshiruv).

### 4.2. Boshlash
- Faqat assigned o'quvchi, faqat ochiq oynada (umumiy yoki `TestWindowOverride`).
- Attempt yaratiladi (idempotent: IN_PROGRESS attempt bo'lsa o'sha qaytariladi).
- `deadline = min(startedAt + timeLimit, windowEnd)` — **serverda** hisoblanadi.
- Pool bo'lsa savollar tanlanadi, `shuffle*` bo'lsa tartib yaratiladi (seed = attemptId) va **attempt'ga saqlanadi**. Qayta hisoblanmaydi.
- Klientga to'g'ri javoblar **yuborilmaydi**. Option'lar faqat `id` va matn bilan.

### 4.3. Yechish
- Bitta savol — bitta ekran, oldingi/keyingi, savollar navigatori (javob berilgan/berilmagan).
- Har javob darhol `PUT /attempts/:id/answers/:testQuestionId` (`clientSeq` bilan). Server: deadline o'tmaganmi, attempt IN_PROGRESS'mi, `clientSeq` eskisidan kattami — keyin upsert.
- Saqlanadigan qiymat: option **id**lar (matn emas).
- `currentIndex` saqlanadi. Sahifa yangilansa yoki boshqa qurilmadan kirilsa — shu joydan davom etadi, javoblar tiklanadi.
- Taymer: server `deadline` va `serverNow` qaytaradi, klient farqni hisoblab sanaydi (soat farqiga chidamli).
- Internet uzilsa: klient javoblarni navbatda ushlab, qayta ulanganda yuboradi; UI "saqlanmagan javoblar" ko'rsatadi.

### 4.4. Anti-cheat
- Klient `visibilitychange` (asosiy) va `blur` (ikkilamchi) eventlarini `POST /attempts/:id/events` ga yuboradi.
- Server dedupe: bir xil turdagi event 2 soniya ichida qayta kelsa `counted = false`. `blur` faqat yaqin vaqtda `VISIBILITY_HIDDEN` bo'lmasa sanaladi.
- `violationCount` faqat server sanagan eventlardan oshadi.
- Har buzilishda klientga ogohlantirish (qolgan imkoniyat soni).
- `violationThreshold`ga yetganda **server** attempt'ni `VIOLATION` bilan yakunlaydi.
- Klient `finishReason` yubora olmaydi. Klient faqat "topshirish" so'rovini yuboradi (`SUBMITTED`). `TIME_UP` va `VIOLATION`ni faqat server belgilaydi.
- Admin/o'qituvchi (`tests.reopen`) yakunlangan attempt'ni qayta ochishi mumkin: yangi deadline, sabab majburiy, audit. Eski javoblar saqlanadi.

### 4.5. Yakunlash
- `SUBMITTED`: o'quvchi tasdiqlaydi (javob berilmagan savollar soni ko'rsatiladi).
- `TIME_UP`: deadline'da BullMQ delayed job attempt'ni yakunlaydi. Job ishlamasa ham, attempt'ga har qanday murojaatda deadline tekshiriladi (lazy finalize). Serverda saqlangan javoblar baholanadi.
- Yakunlash idempotent: ikki marta chaqirilsa natija o'zgarmaydi.

### 4.6. Baholash (sof funksiya)
- SINGLE: tanlangan = to'g'ri → to'liq ball.
- MULTIPLE: `multipleScoring: ALL_OR_NOTHING | PARTIAL` (test sozlamasi, default `ALL_OR_NOTHING`). PARTIAL: `max(0, (to'g'ri tanlangan − noto'g'ri tanlangan) / to'g'rilar soni) × ball`.
- SHORT_TEXT: javob normalizatsiyalanadi (trim, kichik harf, ketma-ket bo'shliqlar, o‘/o' / g‘/g' apostrof variantlari) va `acceptedAnswers` bilan solishtiriladi.
- MATCHING: har to'g'ri juftlik uchun `ball / juftliklar soni`.
- `percent = score / maxScore`.

## 5. Retake va individual vaqt

- O'qituvchi tanlangan o'quvchilarga `TestWindowOverride` beradi (yangi oyna, ixtiyoriy alohida vaqt limiti), sabab majburiy.
- Retake yangi `attemptNo` bilan. WEIGHTED testda qaysi natija hisoblanishi — `retakePolicy` (LAST/BEST).
- Test vaqtini o'zgartirish faqat `CLOSED` bo'lmagan testda. Allaqachon boshlangan attempt'larning deadline'i avtomatik o'zgarmaydi (alohida "joriy urinishlarga ham qo'llash" tanlovi, audit bilan).

## 6. Offline test

- O'qituvchi test yaratadi (format `OFFLINE`, shkala `maxScore` ∈ {5,10,20,25,40,50,100}), sana, guruh.
- Natija kiritish jadvali: o'quvchilar ro'yxati, ball katagi, holat (`SCORED` / `ABSENT` / `EXCUSED`). Excel'dan nusxalab qo'yish (paste) qo'llab-quvvatlanadi.
- Bo'sh katak = natija kiritilmagan (saqlanmaydi). Saqlashda kiritilmaganlar ro'yxati ko'rsatiladi.
- `ABSENT` natijaning davriy bahoga ta'siri — scoring policy `missedTest`. Avtomatik 0 yo'q.
- `0 ≤ rawScore ≤ maxScore` serverda tekshiriladi.
- Tuzatish tarixi saqlanadi (`supersededById`), audit.
- Dars rejasida `CONTROL_WORK/BSB/CHSB` turidagi mavzu uchun offline test qoralamasi taklif qilinadi (`planItemId`).

## 7. Weighted test va davriy baho

- `purpose = WEIGHTED` → `periodId` va `weight` majburiy. `includedInAssessment` — `testsMode = SELECTIVE` uchun.
- Hisoblash formulasi `scoring.md` §5.2 da (nisbiy vaznlar; MASTER_SPEC'dagi "vaznlar yig'indisi ≤ komponent limiti" o'rniga shu formula ishlatiladi, chunki natija doim komponent maksimumiga masshtablanadi).
- Test kartasida va o'quvchi profilida ikkalasi ko'rinadi: test natijasi (masalan 17/20 = 85%) va davriy natijaga hissasi (masalan "Testlar komponentining 1/3 qismi").
- Davr `CLOSED` bo'lsa unga yangi weighted test bog'lab bo'lmaydi; mavjud test natijasini o'zgartirish `assessment.reopen` qoidasiga bo'ysunadi.

## 8. Statistika

- Test bo'yicha: qatnashganlar, o'rtacha, median, eng yuqori/past, ball taqsimoti grafigi, yakunlash sabablari (SUBMITTED/TIME_UP/VIOLATION).
- Savol bo'yicha: to'g'ri javob foizi, har variant tanlanish ulushi (qaysi noto'g'ri javob ko'p tanlangan), o'rtacha vaqt (agar o'lchansa).
- **Mavzu bo'yicha**: o'quvchi × mavzu o'zlashtirish foizi (shu mavzudagi savollar bo'yicha). Sinf kesimida "eng qiyin mavzular". Bu AI feedback uchun kirish.
- Taqqoslash: shu guruhning oldingi testi, parallel sinflar.
- O'quvchi profilida test tarixi.
- Excel eksport (test natijalari, savollar statistikasi).

## 9. API (asosiy)

```
CRUD /question-bank/questions, POST /question-bank/import (preview|commit), GET /question-bank/export
CRUD /tests, POST /tests/:id/publish, POST /tests/:id/close
POST /tests/:id/overrides                       -- retake / individual vaqt
POST /tests/:id/start                           -- o'quvchi; attempt qaytaradi
GET  /attempts/:id                              -- savollar (javobsiz), javoblar, deadline, serverNow
PUT  /attempts/:id/answers/:testQuestionId
POST /attempts/:id/events
POST /attempts/:id/submit
POST /attempts/:id/reopen                       -- tests.reopen
PUT  /tests/:id/offline-results                 -- bulk
GET  /tests/:id/stats, /tests/:id/questions-stats, /tests/:id/results/export
GET  /students/:id/topic-mastery?subjectId
```

Ruxsatlar: `questions.manage` (o'z banki), `tests.create`, `tests.publish`, `tests.reopen`, `tests.results.view`, `tests.results.enter`, `test_types.manage`.

## 10. Acceptance testlari

1. Klient javobida to'g'ri javob ma'lumoti yo'q (snapshot test).
2. Sahifa yangilanganda: o'sha `questionOrder`, `optionOrder`, `currentIndex`, javoblar.
3. Ikki o'quvchida tartiblar farq qiladi; bitta o'quvchida qayta yuklashda bir xil.
4. Deadline'dan keyin javob saqlash → 409, attempt TIME_UP bilan yakunlanadi, avval saqlangan javoblar baholanadi.
5. Delayed job ishlamagan holat: deadline o'tgan attempt'ni o'qish uni yakunlaydi (lazy).
6. Klient `finishReason: "SUBMITTED"` yuborsa ham deadline o'tgan bo'lsa natija `TIME_UP`.
7. Bir xil visibility eventi 2 s ichida 3 marta → 1 marta sanaladi. Threshold 3 → uchinchi sanalgan buzilishda server `VIOLATION` bilan yakunlaydi.
8. Eski `clientSeq` bilan kelgan javob yangisini bosib ketmaydi.
9. Testda ishlatilgan savol tahrirlansa — test va natijalar eski versiyada qoladi.
10. MULTIPLE PARTIAL: 3 to'g'ridan 2 tasi + 1 noto'g'ri tanlangan → (2−1)/3.
11. SHORT_TEXT: "O‘zbekiston", "o'zbekiston ", "O`zbekiston" — barchasi to'g'ri deb qabul qilinadi.
12. Offline: `rawScore > maxScore` → 400; bo'sh katak saqlanmaydi; ABSENT davriy natijada policy bo'yicha.
13. Retake: LAST va BEST bo'yicha davriy natijaga to'g'ri hissa.
14. WEIGHTED testni CLOSED davrga bog'lash → rad.
15. O'quvchi assign qilinmagan testni boshlay olmaydi (403); ochiq oynadan tashqarida (409).
16. Excel import: dublikat savol preview'da belgilanadi; noto'g'ri "to'g'ri javob" (masalan `G` 4 variantda) → xato.
