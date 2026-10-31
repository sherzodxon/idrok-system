# Spec: Kalendar, dars jadvali va kalendar-tematik reja (M2)

## 1. Maqsad

Admin o'quv yili, davrlar, dam olish kunlari va haftalik dars jadvalini kiritadi. Tizim har bir sinf va fan uchun **aniq dars sanalarini** (`LessonSession`) hisoblaydi. O'qituvchi shu sanalarga mos **kalendar-tematik reja** (KTR) kiritadi: Excel orqali yoki qo'lda. Natijada har bir dars aniq mavzuga ega bo'ladi. Keyin ball (M3), test savollari (M4) va AI feedback shu mavzuga bog'lanadi.

## 2. Modellar

```
AcademicPeriod     id, tenantId, academicYearId, type(QUARTER|HALF|CUSTOM), name, order,
                   startDate, endDate, status(DRAFT|ACTIVE|CLOSED)

CalendarDay        id, tenantId, academicYearId, date, kind(HOLIDAY|VACATION|NON_WORKING|
                   WORKING_OVERRIDE|SHORTENED), title, appliesTo(ALL|gradeIds[])
                   -- WORKING_OVERRIDE: dam olish kuni ishlanadigan kun (masalan shanba o'rniga),
                   --   qaysi hafta kuni jadvali ishlatilishi: `followsWeekday`

SchoolWeek         tenantId, academicYearId, workingWeekdays (masalan [1..6])

BellSchedule       id, tenantId, academicYearId, shiftId?, name, validFrom
BellSlot           bellScheduleId, lessonNumber, startTime, endTime

Timetable          id, tenantId, academicYearId, version, status(DRAFT|PUBLISHED|ARCHIVED),
                   validFrom, validTo?, publishedById, publishedAt
TimetableEntry     id, timetableId, teachingGroupId, subjectId, teacherId, roomId?,
                   weekday, lessonNumber, weekType(ALL|ODD|EVEN)

LessonSession      id, tenantId, academicYearId, periodId, teachingGroupId, subjectId,
                   teacherId, date (schoolDate), lessonNumber, startsAt, endsAt,
                   sequenceNo (shu guruh+fan bo'yicha yil davomidagi tartib raqami),
                   status(SCHEDULED|HELD|CANCELLED|MOVED),
                   source(TIMETABLE|MANUAL), timetableEntryId?,
                   planItemId? (rejadagi mavzu), actualTopicNote?, heldMarkedAt?, heldMarkedById?

-- Reja
CurriculumPlan     id, tenantId, academicYearId, subjectId, gradeId (parallel, masalan 7-sinf),
                   authorId, title, status(DRAFT|SUBMITTED|APPROVED|REJECTED|ARCHIVED),
                   version, approvedById?, approvedAt?, rejectionNote?
PlanItem           id, planId, order, periodId?, topicId, hours (>=1),
                   lessonType(NEW|PRACTICE|REVIEW|CONTROL_WORK|BSB|CHSB|LAB|OTHER),
                   objectives?, homework?, resources?, notes?
Topic              id, tenantId, subjectId, gradeId, title, code?, parentTopicId?
                   -- mavzu alohida obyekt: ball, savol va AI shu id ga tayanadi

PlanAssignment     id, planId, teachingGroupId, appliedAt, appliedById, status
                   -- shablon reja aniq sinf/guruhga qo'llanadi; sanalar har guruhda o'zicha
```

`TeachingGroup` — dars o'tiladigan birlik: butun sinf (7-A) yoki guruhcha (7-A ingliz tili 1-guruh). M1'da yaratiladi.

## 3. LessonSession generatsiyasi

Kirish: chop etilgan `Timetable`, `SchoolWeek`, `CalendarDay`, `AcademicPeriod`, `BellSchedule`.

Algoritm (sof funksiya, DB'dan ajratilgan, unit-test qilinadi):
1. O'quv yilining har bir sanasi uchun: ish kunimi? (`workingWeekdays`, `HOLIDAY/VACATION/NON_WORKING` chiqariladi, `WORKING_OVERRIDE` qo'shiladi va `followsWeekday` jadvali qo'llanadi). `appliesTo` sinflarga qarab filtrlanadi.
2. Shu sana uchun amal qiladigan timetable versiyasi (`validFrom`/`validTo`) olinadi.
3. Har bir `TimetableEntry` (weekType hisobga olinib) → bitta `LessonSession`.
4. `startsAt/endsAt` — `BellSlot`dan, `Asia/Tashkent` bo'yicha, UTC'da saqlanadi.
5. `sequenceNo` — guruh+fan bo'yicha sana va dars raqami tartibida.

Qayta generatsiya qoidalari:
- Faqat **bugundan keyingi** va `SCHEDULED` holatdagi sessiyalar qayta yaratiladi.
- `HELD` yoki ball/davomat bog'langan sessiya hech qachon o'chirilmaydi va o'zgarmaydi.
- Generatsiya idempotent: bir xil kirishda bir xil natija (unique: `teachingGroupId + date + lessonNumber`).
- Kalendar yoki jadval o'zgarsa: admin "o'zgarishlarni ko'rib chiqish" (diff: qo'shiladigan / bekor bo'ladigan darslar) → tasdiqlash → qo'llash. Audit yoziladi.

Hisobot: "7-A, Informatika, 1-chorak: rejada 18 soat, jadval bo'yicha 17 dars" — farq ko'rsatiladi.

## 4. Kalendar-tematik reja

### 4.1. Yaratish
- Reja **shablon** sifatida fan + parallel (masalan Informatika, 7-sinf) uchun bir marta yoziladi.
- Bir parallelda bir nechta reja bo'lishi mumkin (masalan chuqurlashtirilgan guruh uchun), har biri alohida `PlanAssignment` bilan qo'llanadi.
- Bitta guruh+fan uchun bir vaqtda faqat bitta faol (APPROVED) reja.

### 4.2. Excel shablon (yuklab olish)
O'qituvchi tanlaydi: o'quv yili, fan, guruh (yoki parallel). Tizim to'ldirilgan shablon beradi:

| № | Chorak | Sana (ma'lumot uchun) | Mavzu* | Soat* | Dars turi | Maqsad | Uy vazifasi | Resurslar | Izoh |
|---|---|---|---|---|---|---|---|---|---|

- Qatorlar soni = jadval bo'yicha darslar soni. "Sana" ustuni tanlangan guruh uchun ma'lumot sifatida to'ldiriladi (importda e'tiborga olinmaydi).
- "Dars turi" — ochiladigan ro'yxat (data validation), qiymatlar tarjima qilingan.
- Ikkinchi varaq: yo'riqnoma (uz/ru).
- Shablon tilini foydalanuvchi tili belgilaydi, ustun kalitlari esa yashirin texnik qatorda saqlanadi (import tilga bog'liq bo'lmasligi uchun).

### 4.3. Import
- Ikki rejim: **(a)** shablon bo'yicha qator=dars, **(b)** faqat mavzular ro'yxati (Mavzu + Soat) — tizim ketma-ket joylaydi.
- Preview: har qator uchun holat (OK / ogohlantirish / xato), sabab.
- Validatsiya: bo'sh mavzu, soat ≤ 0, noma'lum dars turi, juda uzun matn.
- Mavzu nomlari mavjud `Topic` bilan solishtiriladi (fan + parallel ichida, normalizatsiyalangan matn). Mos kelsa bog'lanadi, aks holda yangi `Topic` yaratiladi.
- Soatlar yig'indisi ≠ darslar soni bo'lsa: farq ko'rsatiladi, o'qituvchi davom etishi mumkin (ogohlantirish, xato emas).
- Import yangi `CurriculumPlan` versiyasini (DRAFT) yaratadi; eski versiya o'zgarmaydi.

### 4.4. Mavzularni darslarga joylash (sof funksiya)
- Kirish: `PlanItem[]` (tartib, soat), guruhning `LessonSession[]` (sequenceNo bo'yicha, `CANCELLED` chiqarilgan).
- Har bir PlanItem `hours` ta ketma-ket sessiyani egallaydi.
- Davr chegarasi: agar `PlanItem.periodId` berilgan bo'lsa, mavzu shu davr sessiyalaridan chiqib ketmasligi kerak. Sig'masa — ogohlantirish ro'yxatiga.
- Natija: `sessionId → planItemId` xaritasi + ogohlantirishlar (sig'magan mavzular, mavzusiz qolgan darslar).

### 4.5. Tasdiqlash
- DRAFT → SUBMITTED (o'qituvchi) → APPROVED / REJECTED (izoh bilan) — `curriculum.approve` ruxsati (direktor o'rinbosari yoki uslubchi).
- Maktab sozlamasi: `planApprovalRequired` (default `true`). `false` bo'lsa SUBMITTED avtomatik APPROVED.
- APPROVED rejani tahrirlash → yangi versiya (DRAFT). Tasdiqlanmaguncha eski versiya amal qiladi.

### 4.6. Surish (re-flow)
Dars bekor bo'lsa, yangi bayram qo'shilsa yoki jadval o'zgarsa:
- Faqat kelajakdagi va hali `HELD` bo'lmagan sessiyalar qayta joylanadi.
- O'tgan va `HELD` sessiyalarning mavzusi qotib qoladi.
- O'qituvchiga natija ko'rsatiladi (qaysi mavzu qaysi sanaga ko'chdi), keyin qo'llanadi.

### 4.7. Darsni "o'tildi" deb belgilash
- O'qituvchi jurnalida har sessiya uchun: `HELD` belgisi, rejadagi mavzu ko'rinadi.
- Boshqa mavzu o'tilgan bo'lsa: rejadagi boshqa mavzuni tanlaydi (`planItemId` o'zgaradi) yoki `actualTopicNote` yozadi.
- Ball qo'yilgan sessiya avtomatik `HELD` bo'ladi (M3).
- Sozlama: dars tugaganidan N kun o'tib belgilanmagan bo'lsa, o'qituvchiga eslatma (M7'da Telegram orqali).

### 4.8. Dars turi bo'yicha avtomatika
- `CONTROL_WORK | BSB | CHSB` turidagi PlanItem uchun sessiya kuni offline test **qoralamasi** taklif qilinadi (M4 tayyor bo'lgach). Avtomatik yaratilmaydi, o'qituvchi tasdiqlaydi.

## 5. Ruxsatlar

`calendar.manage`, `timetable.view`, `timetable.manage`, `timetable.publish`, `lessons.view`, `lessons.mark`, `curriculum.view`, `curriculum.create` (o'z fanlari), `curriculum.approve`, `curriculum.export`.

O'qituvchi faqat o'ziga biriktirilgan fan + guruhlar uchun reja yarata va sessiya belgilay oladi.

## 6. UI

- Admin: O'quv yili → Davrlar; Kalendar (oy ko'rinishi, bayramlarni belgilash); Qo'ng'iroq jadvali; Dars jadvali (sinf / o'qituvchi ko'rinishi, qo'lda tahrirlash, to'qnashuv ogohlantirishlari: o'qituvchi yoki guruh bir vaqtda ikki joyda); "Darslar soni" hisoboti.
- O'qituvchi: Mening rejalarim (holat badge'lari), shablonni yuklab olish, import (preview), reja tahriri (jadval ko'rinishi, drag-drop tartib), "Bugungi darslarim" (mavzu bilan).
- O'quvchi/vasiy: haftalik jadval va har dars mavzusi, uy vazifasi.

## 7. Ochiq savollar (maktab qarori)

- Choraklar sanalari va ta'tillar (har yil kiritiladi).
- Reja tasdiqlash kerakmi va kim tasdiqlaydi.
- Juft/toq hafta ishlatiladimi.
- Guruhchalarga bo'lingan fanlar ro'yxati (ingliz tili, informatika...).

## 8. Acceptance testlari

1. Haftada 2 soat, chorakda 9 hafta, 1 bayram (dars kuniga to'g'ri keladi) → 17 sessiya.
2. `WORKING_OVERRIDE` shanba, `followsWeekday = 1` → dushanba darslari yaratiladi.
3. Jadval yangi versiyasi `validFrom` bilan → shu sanadan oldingi sessiyalar o'zgarmaydi.
4. Qayta generatsiya: `HELD` sessiya o'chirilmaydi; ball bog'langan sessiya o'zgarmaydi.
5. Generatsiyani ikki marta ishga tushirish dublikat yaratmaydi.
6. 18 mavzu (biri 2 soat) va 17 sessiya → oxirgi mavzu sig'maydi, ogohlantirish chiqadi.
7. Dars bekor qilinsa: kelgusi mavzular bittaga suriladi, o'tgan sessiyalar o'zgarmaydi.
8. Import: rejim (a) va (b) bir xil natija beradi (sanalardan tashqari).
9. Import bo'sh mavzu qatori → xato, boshqa qatorlar preview'da ko'rinadi, saqlanmaydi.
10. 7-A va 7-B'ga bitta shablon qo'llanadi → har birida o'z sanalari, mavzular bir xil `Topic`ga bog'langan.
11. O'qituvchi boshqa o'qituvchining guruhiga reja yarata olmaydi (403).
12. APPROVED rejani tahrirlash yangi versiya yaratadi, amaldagi bog'lanishlar tasdiqqacha o'zgarmaydi.
