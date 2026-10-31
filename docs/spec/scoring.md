# Spec: Ball engine va davriy baholash (M3)

## 1. Tushunchalar (aralashtirilmaydi)

| Tushuncha | Nima | Qayerda |
|---|---|---|
| **Kunlik ball** (`ScoreEntry`) | O'qituvchi darsda qo'ygan akademik ball | Shu spec |
| **Davriy natija** (`PeriodResult`) | Chorak / yarim yillik / yillik yakuniy natija | Shu spec |
| **Test natijasi** | Test bo'yicha ball | `tests.md`, davriy natijaga komponent sifatida kiradi |
| **Coin** | Rag'bat/jarima birligi | M5. Akademik ballga **hech qachon** qo'shilmaydi |

Barcha raqamlar `Decimal`. Kunga bog'liq hamma narsa `schoolDate` bo'yicha (`CLAUDE.md` §4).

## 2. Modellar

```
ScoreCriterion    id, tenantId, name, description?, isActive, order
                  -- masalan: "Darsdagi faollik", "Uy vazifasi", "Og'zaki javob"

LessonAttendance  id, tenantId, lessonSessionId, studentId,
                  status(PRESENT|LATE|ABSENT_EXCUSED|ABSENT_UNEXCUSED),
                  markedById, markedAt, note?
                  unique(lessonSessionId, studentId)  -- tahrir tarixi AuditLog'da

ScoreEntry        id, tenantId, studentId, teacherId, subjectId, teachingGroupId,
                  lessonSessionId, topicId? (sessiyaning planItem.topicId dan nusxa),
                  academicYearId, periodId, schoolDate, criterionId?,
                  points (Decimal: NORMAL > 0, REVERSAL < 0), note?,
                  kind(NORMAL|REVERSAL), reversesEntryId?, reason? (REVERSAL'da majburiy),
                  idempotencyKey (unique), createdById, createdAt
                  -- UPDATE/DELETE yo'q. Tuzatish = REVERSAL yozuv (manfiy summa)
                  --   + kerak bo'lsa yangi NORMAL yozuv.

ScoreLimitRule    id, tenantId, window(LESSON|DAY|WEEK|MONTH|PERIOD),
                  scopeType(GLOBAL|SUBJECT|GRADE|TEACHER|TEACHING_GROUP),
                  scopeId? (null = shu turdagi hammaga default), maxPoints, isActive

ScoreSettings     tenantId, hardCapPerLesson, hardCapPerDay,
                  lessonMaxPoints (default sessiya maksimumi, masalan 10),
                  allowScoreOnAbsent(bool), lateEntryDays (necha kun keyin ham ball qo'yish mumkin)

AssessmentPolicy         id, tenantId, name, isDefault
AssessmentPolicyVersion  id, policyId, version, status(DRAFT|PUBLISHED|RETIRED),
                         config (JSON, zod bilan validatsiya qilinadi — §6), publishedById, publishedAt
PolicyBinding            periodId, subjectId? (null = barcha fanlar), policyVersionId, boundAt, boundById

GradeScale        id, tenantId, name, isActive
GradeScaleBand    scaleId, minPercent, maxPercent, label ("5","4",...), order

PeriodResult      id, tenantId, studentId, subjectId? (null = umumiy), periodId,
                  policyVersionId, status(DRAFT|FINAL), version,
                  components (JSON: har komponent bo'yicha max, olingan, foiz, kirish ma'lumotlari),
                  totalPoints, maxPoints, percent, gradeLabel?, inputsHash,
                  computedAt, finalizedById?, finalizedAt?
                  -- FINAL yozuv o'zgarmaydi. Qayta hisob = yangi version.
```

## 3. Ball qo'yish qoidalari

1. O'qituvchi faqat o'ziga biriktirilgan guruh + fan sessiyasiga ball qo'yadi (`TeacherAssignment`).
2. Sessiya `CANCELLED` bo'lsa — ball qo'yib bo'lmaydi.
3. Sessiya kelajakda bo'lsa (`startsAt > now`) — ball qo'yib bo'lmaydi.
4. `schoolDate` sessiya sanasidan olinadi (yozish vaqtidan emas). Sessiyadan `lateEntryDays` kun o'tgandan keyin ball qo'yish uchun `scores.late_entry` ruxsati kerak.
5. Davr `CLOSED` bo'lsa — faqat `assessment.reopen` ruxsati bilan, sabab majburiy (audit).
6. O'quvchi `ABSENT_*` bo'lsa va `allowScoreOnAbsent = false` — rad etiladi.
7. Bir sessiyada bir o'quvchiga bir nechta yozuv (turli mezonlar) mumkin. Ularning yig'indisi sessiya limitidan oshmaydi.
8. Ball qo'yilgan sessiya avtomatik `HELD` bo'ladi.

### 3.1. Limitlarni aniqlash (aniq algoritm)

Har bir yangi yozuv uchun, **har bir window** (LESSON, DAY, WEEK, MONTH, PERIOD) bo'yicha:

1. Har `scopeType` uchun amal qiladigan qoida tanlanadi: avval `scopeId` aniq mos keladigani, bo'lmasa `scopeId = null` (default). Shunday qilib "aniqroq qoida umumiydan ustun" faqat **bir xil turdagi** qoidalar orasida ishlaydi (masalan Matematika uchun SUBJECT qoidasi umumiy SUBJECT qoidasini almashtiradi).
2. Tanlangan har bir qoida **mustaqil tekshiriladi**. Har qoida o'z doirasidagi yozuvlarni sanaydi:
   - GLOBAL — o'quvchining barcha fanlardagi yozuvlari;
   - SUBJECT — shu fandagi yozuvlari;
   - TEACHER — shu o'qituvchi qo'ygan yozuvlari;
   - GRADE / TEACHING_GROUP — o'quvchi shu parallel/guruhda bo'lgan yozuvlari.
   Hisobga barcha o'qituvchilar qo'ygan yozuvlar kiradi (REVERSAL'lar ayirilgan holda).
3. Bundan tashqari `hardCapPerLesson` va `hardCapPerDay` har doim tekshiriladi. Ularni hech bir qoida oshira olmaydi.
4. Yozuv **barcha** tekshiruvlardan o'tsagina saqlanadi. Rad javobida qaysi limit buzilgani va qolgan imkoniyat qaytariladi: `{ code: "SCORE_LIMIT_EXCEEDED", details: { window, scopeType, max, used, remaining } }`.
5. LESSON window maksimumi = **sessiyaning maksimal balli** (`maxPoints` agregatsiyada ishlatiladi). U LESSON qoidasidan, bo'lmasa `lessonMaxPoints`dan olinadi.

Concurrency: butun tekshiruv + insert bitta transaction ichida, `pg_advisory_xact_lock(hash(tenantId, studentId))` bilan — kalit **o'quvchi darajasida**, `schoolDate`siz (aks holda turli kunlarga parallel yozuvlar WEEK/MONTH/PERIOD limitini chetlab o'tadi; Q-46). Barcha window'lar shu lock ostida tekshiriladi (bir o'quvchiga bir vaqtda faqat bitta yozish).

Idempotency: klient har yozuvga `idempotencyKey` (UUID) beradi. Takror so'rov birinchi natijani qaytaradi.

### 3.2. Tuzatish
- O'qituvchi o'z yozuvini `lateEntryDays` ichida bekor qila oladi (REVERSAL, sabab ixtiyoriy). Keyin — faqat `scores.correct` ruxsati bilan, sabab majburiy.
- REVERSAL asl yozuv summasining manfiysi. Bir yozuv faqat bir marta reverse qilinadi.
- Har tuzatish AuditLog'ga yoziladi (shu transaction'da).

## 4. Kunlik va davr ichidagi agregatsiya

Sof funksiyalar (`packages/shared` yoki `apps/api/src/domain/scoring`), DB'siz unit-test qilinadi.

### 4.1. Sessiya holati (o'quvchi uchun)
| Holat | Shart | Agregatsiyaga ta'siri |
|---|---|---|
| `SCORED` | kamida bitta NORMAL yozuv (net > 0 yoki = 0 bo'lsa ham) | earned = net yig'indi, max = sessiya maksimumi |
| `PENDING` | sessiya o'tgan, yozuv yo'q, o'quvchi PRESENT/LATE yoki belgilanmagan | **hisobga olinmaydi** (0 emas!) |
| `ABSENT_EXCUSED` | davomat shunday | policy: `absentExcused` (default `EXCLUDE`) |
| `ABSENT_UNEXCUSED` | davomat shunday | policy: `absentUnexcused` (default `EXCLUDE`, variant `ZERO`) |
| `CANCELLED` | sessiya bekor | hisobga olinmaydi |

`ZERO` = earned 0, max = sessiya maksimumi. `EXCLUDE` = umuman hisobga olinmaydi.

Muhim: agar sessiyada o'qituvchi **hech kimga** ball qo'ymagan bo'lsa, butun sinf uchun `PENDING`. Agar ba'zilariga qo'ygan bo'lsa, qolganlari ham `PENDING` (avtomatik 0 emas). Policy `ungradedPresentAs: PENDING | ZERO` (default `PENDING`).

### 4.2. Fan bo'yicha foiz
`subjectPercent = Σ earned / Σ max` (hisobga olingan sessiyalar bo'yicha). Hisobga olingan sessiya yo'q bo'lsa — `null` (natija yo'q), 0 emas.

### 4.3. Umumiy (barcha fanlar) foiz — ko'rinish rejimlari
`dailyView: BY_SUBJECT | OVERALL | BOTH`, `overallMethod: POOLED | WEIGHTED_SUBJECTS`.
- `POOLED`: barcha fanlar sessiyalari bitta qozonda: `Σ earned / Σ max` (5 dars × 10 = 50, 45 olgan → 90%).
- `WEIGHTED_SUBJECTS`: `Σ(subjectPercent × w) / Σ w` (natijasi `null` bo'lgan fanlar chiqariladi). Koeffitsiyentlar: `subjectWeights` (default 1.0).
- `BY_SUBJECT` rejimida API umumiy foizni **qaytarmaydi**.

Bu formulalar istalgan oraliq uchun ishlaydi: kun, hafta, oy, davr. Qaysi oraliqlar UI'da ko'rinishi — `enabledViews: [DAY, WEEK, MONTH, PERIOD]`.

## 5. Davriy natija

### 5.1. Komponentlar
Har bir fan uchun davr natijasi komponentlardan yig'iladi:

| Turi | Kirish | Komponent foizi |
|---|---|---|
| `DAILY_SCORES` | §4.2 bo'yicha fanning davr foizi | `subjectPercent` |
| `TESTS` | davrga bog'langan, `includedInAssessment` testlar (`tests.md`) | §5.2 |
| `MANUAL` | o'qituvchi/admin kiritadigan ball (masalan yakuniy og'zaki) | kiritilgan / max |

`componentPoints = componentPercent × component.maxPoints`. `total = Σ componentPoints`, `maxPoints = Σ component.maxPoints`.

Validatsiya (policy publish paytida): `Σ component.maxPoints = config.periodMaxPoints` (davr maksimumi policy versiyasida saqlanadi; Q-14). Aks holda publish rad etiladi.

### 5.2. Test komponenti
`testsMode: COMBINED | SEPARATE | SELECTIVE`
- `COMBINED`: davrdagi barcha WEIGHTED testlar.
- `SELECTIVE`: faqat `includedInAssessment = true` belgilanganlari.
- `SEPARATE`: testlar davr natijasiga kirmaydi (TESTS komponenti bo'lmasligi kerak; publish validatsiyasi).

Har test `weight` (nisbiy vazn) bilan:
`testsPercent = Σ(testPercent_i × weight_i) / Σ weight_i` — o'quvchi qatnashgan testlar bo'yicha.
Qatnashmagan test: policy `missedTest: EXCLUDE | ZERO` (default `EXCLUDE`; maktab qarori — §12).
Retake bo'lsa: `retakePolicy: LAST | BEST` (default `LAST`).

### 5.3. Bo'sh komponent
Komponentda kirish ma'lumoti yo'q (masalan davrda test bo'lmagan):
`emptyComponent: REDISTRIBUTE | ZERO | PENDING` (default `REDISTRIBUTE`).
- `REDISTRIBUTE`: natija mavjud komponentlar bo'yicha hisoblanadi va `config.periodMaxPoints`ga masshtablanadi.
- `PENDING`: davr natijasi chiqmaydi, "to'liq emas" deb ko'rsatiladi.

### 5.4. Yarim yillik va yillik
`aggregation` (policy'da, har yuqori davr uchun):
- `AVERAGE` — quyi davrlar foizlarining o'rtachasi;
- `WEIGHTED` — `{ periodId: weight }` (masalan 1-chorak 40, 2-chorak 60);
- `WEIGHTED_WITH_FINAL` — quyi davrlar + yakuniy nazorat komponenti o'z vazni bilan;
- `INDEPENDENT` — yarim yillik o'z komponentlari bilan to'g'ridan-to'g'ri (choraklardan emas).
Maxsus formula (ixtiyoriy matn ifodasi) **hozir qilinmaydi**, arxitektura kengaytirishga yo'l qoldiradi.

### 5.5. Umumiy davr natijasi
`subjectId = null` bo'lgan PeriodResult — faqat `dailyView ≠ BY_SUBJECT` va `overallPeriodResult = true` bo'lsa: fanlar foizlari `WEIGHTED_SUBJECTS` bo'yicha.

### 5.6. Yaxlitlash va 5 ballik baho
- `rounding: { mode: HALF_UP | FLOOR | CEIL, decimals: 0..2 }` — faqat **yakuniy** ko'rsatiladigan qiymatlarga qo'llanadi; oraliq hisoblar to'liq aniqlikda.
- `gradeScaleId?` — tanlangan bo'lsa `gradeLabel` hisoblanadi. Band chegaralari: `minPercent ≤ p < maxPercent` (oxirgi band uchun `≤`). Bandlar 0–100 ni bo'shliqsiz va kesishmasdan qoplashi publish paytida tekshiriladi.

## 6. Policy konfiguratsiyasi va versiyalash

`AssessmentPolicyVersion.config` (zod sxema `packages/shared`da):

```ts
{
  dailyView: "BY_SUBJECT" | "OVERALL" | "BOTH",
  overallMethod: "POOLED" | "WEIGHTED_SUBJECTS",
  subjectWeights: Record<subjectId, Decimal>,
  enabledViews: ("DAY"|"WEEK"|"MONTH"|"PERIOD")[],
  absentExcused: "EXCLUDE" | "ZERO",
  absentUnexcused: "EXCLUDE" | "ZERO",
  ungradedPresentAs: "PENDING" | "ZERO",
  periodMaxPoints: Decimal,
  components: { type, name, maxPoints, enabled }[],
  testsMode: "COMBINED" | "SEPARATE" | "SELECTIVE",
  missedTest: "EXCLUDE" | "ZERO",
  retakePolicy: "LAST" | "BEST",
  emptyComponent: "REDISTRIBUTE" | "ZERO" | "PENDING",
  higherPeriods: { periodId, aggregation, weights? , finalComponent? }[],
  overallPeriodResult: boolean,
  rounding: { mode, decimals },
  gradeScaleId?: string
}
```

**Default preset** (seed'da yaratiladi, maktab o'zgartiradi):
`dailyView=BOTH, overallMethod=POOLED, absent*=EXCLUDE, ungradedPresentAs=PENDING, periodMaxPoints=100, components=[DAILY_SCORES 50, TESTS 50], testsMode=COMBINED, missedTest=EXCLUDE, retakePolicy=LAST, emptyComponent=REDISTRIBUTE, choraklar → yarim yillik AVERAGE, rounding HALF_UP 0, gradeScale yo'q`.

Versiyalash qoidalari:
- PUBLISHED versiya o'zgarmaydi. O'zgartirish = yangi versiya.
- Davr `ACTIVE` bo'lganda `PolicyBinding` yaratiladi (o'sha paytdagi default versiya).
- Faol davr uchun policy'ni almashtirish — alohida amal "joriy davrga qo'llash" (`assessment.manage`), sabab majburiy, audit, barcha DRAFT natijalar qayta hisoblanadi.
- `CLOSED` davr natijalari hech qachon avtomatik qayta hisoblanmaydi.

## 7. Davrni yopish

1. Admin "yopishga tayyorlash": tizim har o'quvchi × fan uchun DRAFT natija hisoblaydi va **to'liqmaslik hisobotini** ko'rsatadi: `PENDING` sessiyalar soni (o'qituvchi bo'yicha), baholanmagan offline testlar, bo'sh komponentlar.
2. Admin tasdiqlaydi (`assessment.approve`) → davr `CLOSED`, natijalar `FINAL`, `inputsHash` va policy versiyasi saqlanadi. Bitta transaction + audit.
3. Yopilgandan keyin ball qo'yish/tuzatish faqat `assessment.reopen` bilan. Bunday o'zgarish FINAL natijani **o'zgartirmaydi**: natija "eskirgan" (inputsHash mos emas) deb belgilanadi va admin qayta hisoblashni tasdiqlasa yangi FINAL version yaratiladi.

## 8. API (asosiy)

```
GET  /lesson-sessions/:id/journal          -- o'quvchilar, davomat, yozuvlar, qolgan limitlar
PUT  /lesson-sessions/:id/attendance       -- bulk davomat
POST /scores                               -- bitta yoki bulk (har biri idempotencyKey bilan)
POST /scores/:id/reverse                   -- { reason }
GET  /scores?studentId&subjectId&from&to
GET  /gradebook?teachingGroupId&subjectId&periodId   -- jadval: o'quvchi × sessiya
GET  /students/:id/progress?view=DAY|WEEK|MONTH|PERIOD&date=
GET  /assessment/policies, POST, POST /:id/versions, POST /versions/:id/publish
POST /periods/:id/bind-policy
POST /periods/:id/prepare-close            -- to'liqmaslik hisoboti
POST /periods/:id/close
POST /periods/:id/recompute                -- assessment.reopen
GET  /period-results?periodId&teachingGroupId&subjectId
CRUD /score-criteria, /score-limit-rules, /grade-scales
```

Ruxsatlar: `scores.create`, `scores.correct`, `scores.late_entry`, `gradebook.view`, `assessment.view`, `assessment.manage`, `assessment.approve`, `assessment.reopen`.
Vasiy/o'quvchi faqat o'z (farzand) ma'lumotlari: `progress` endpointlari server tomonida filtrlanadi.

## 9. UI

- **O'qituvchi jurnali** (asosiy ekran, desktop va planshet): chap — o'quvchilar, yuqori — sessiyalar (sana + mavzu). Katakka bosish → tez kiritish (mezon tanlash, ball). Davomat ustuni. Har o'quvchida "bugun qoldi: N ball" ko'rsatkichi. Bulk: "hammaga N ball". Klaviatura bilan navigatsiya. Optimistik UI emas: server tasdiqlagandan keyin yangilanadi (limit xatosi aniq ko'rinsin).
- **Telefon uchun tez rejim**: bugungi dars → o'quvchilar ro'yxati → katta tugmalar.
- **O'quvchi / vasiy**: fanlar kartochkalari (davr foizi, 5 ballik baho bo'lsa), kun/hafta/oy grafigi, yozuvlar tarixi (mavzu bilan).
- **Admin**: policy muharriri (komponentlar yig'indisi jonli tekshiriladi), limitlar, mezonlar, baho shkalasi, davrni yopish ustasi (wizard), "kim ball qo'ymagan" hisoboti.

## 10. Acceptance testlari (unit, sof funksiyalar)

1. 5 sessiya × 10, earned 45 → POOLED 90%.
2. `BY_SUBJECT` rejimida API umumiy foiz qaytarmaydi.
3. 3 fan: 80%, 90%, null; vaznlar 1.5/1/1 → WEIGHTED_SUBJECTS = (80·1.5 + 90·1)/2.5 = 84%.
4. Baholanmagan sessiya `PENDING` — foizni o'zgartirmaydi (0 sifatida hisoblanmaydi).
5. `ungradedPresentAs = ZERO` → shu sessiya 0/10 sifatida kiradi.
6. Bekor qilingan sessiya maksimumdan chiqariladi.
7. `absentUnexcused = ZERO` → 0/10; `EXCLUDE` → hisobga olinmaydi.
8. Davr: daily 88% × 50 = 44, tests 86% × 50 = 43 → 87/100.
9. Test vaznlari: 2 test, 80% (w=1) va 95% (w=2) → 90%.
10. Davrda test yo'q, `REDISTRIBUTE`: daily 88% → 88/100; `PENDING` → natija yo'q.
11. Komponentlar 50 + 40 ≠ 100 → policy publish rad etiladi.
12. Yarim yillik WEIGHTED 40/60: 80% va 90% → 86%.
13. Yaxlitlash HALF_UP 0: 86.5 → 87; FLOOR → 86. Oraliq hisoblar yaxlitlanmaydi.
14. GradeScale: 86 → "5", 85.99 → "4" (86–100 / 71–86 bandlarda).
15. Bandlar orasida bo'shliq bo'lsa publish rad etiladi.
16. CLOSED davr natijasi yangi policy versiyasi chop etilgandan keyin o'zgarmaydi.

## 11. Acceptance testlari (integration / API)

17. Ikki parallel so'rov (turli o'qituvchilar) bir o'quvchiga: kunlik limit 50, ishlatilgan 45, har biri +10 → bittasi o'tadi, ikkinchisi `SCORE_LIMIT_EXCEEDED`.
18. Bir xil `idempotencyKey` bilan ikki so'rov → bitta yozuv.
19. Matematika uchun SUBJECT DAY limiti 20, default SUBJECT 10 → matematikada 20 gacha, boshqa fanlarda 10.
20. Hech bir qoida `hardCapPerDay`dan oshirishga ruxsat bermaydi.
21. `schoolDate` sessiya sanasidan olinadi: 23:30 da (Toshkent) kechagi sessiyaga qo'yilgan ball kechagi kunga yoziladi; 00:30 UTC+5 chegarasida xato yo'q.
22. REVERSAL: net summa to'g'ri, asl yozuv o'zgarmagan, ikkinchi reversal rad etiladi.
23. O'qituvchi boshqa guruh sessiyasiga ball qo'ya olmaydi (403). Vasiy boshqa o'quvchi progress'ini ko'ra olmaydi (403/404).
24. Yopilgan davrga ball qo'yish ruxsatsiz → 403; ruxsat bilan → yozuv saqlanadi, FINAL natija o'zgarmaydi, "eskirgan" belgisi chiqadi.

## 12. Ochiq savollar (maktab qarori, `open-questions.md`ga)

- Default sessiya maksimumi (10?) va kunlik/haftalik limitlar.
- Sababsiz kelmaganlik: 0 yoki hisobdan chiqarish.
- Qatnashmagan test: 0 yoki hisobdan chiqarish.
- Chorak tarkibi (daily/test nisbati), yarim yillik formulasi.
- 5 ballik shkala kerakmi va oraliqlari.
- Ball qo'yish kechikishi (necha kun).
