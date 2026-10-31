> **Eslatma:** Bu hujjat dastlabki to‘liq texnik topshiriq. Quyidagi joylarda u eskirgan va ustunlik boshqa fayllarda:
> - Bosqichlar tartibi (25-bo‘lim) → `docs/ROADMAP.md`
> - "Mavjud repository / EdexTest kodini saqlash" haqidagi gaplar (2, 7, 13-bo‘limlar) → loyiha yangi repo‘da noldan quriladi, EdexTest faqat referens (`CLAUDE.md`)
> - Ball, dars rejasi va test modullari → `docs/spec/scoring.md`, `docs/spec/lesson-plan.md`, `docs/spec/tests.md`
> Ziddiyat bo‘lsa: CLAUDE.md > spec/*.md > ROADMAP.md > MASTER_SPEC.md.

# IDROK SYSTEM — YAGONA MAKTAB BOSHQARUV PLATFORMASI
## MASTER TECHNICAL PROMPT FOR CLAUDE CODE

Sen senior software architect, full-stack engineer va technical lead sifatida ishlaysan. Vazifang — Idrok maktabi uchun zamonaviy, xavfsiz, kengaytiriladigan va professional maktab boshqaruv platformasini ishlab chiqish.

Bu oddiy elektron jurnal emas. Bu maktabning o‘quv jarayoni, davomat, baholash, test, moliya, kadrlar, kommunikatsiya va boshqa operatsion jarayonlarini yagona tizimga birlashtiradigan School Management System / School ERP platformasi.

Loyiha nomi: **Idrok System**  
Hozirgi maktab nomi: **Idrok**  
Asosiy til: O‘zbek tili  
Vaqt mintaqasi: Asia/Tashkent  
Valyuta: UZS (so‘m)

Men senga ikkita asosiy manba beraman:

1. Registo va EdEx Test tahlili PDF hujjati — mavjud tizimlar, ularning biznes mantiqi va birlashtirish bo‘yicha tahlil.
2. Universitet dashboard dizayni rasmi — UI/UX uchun vizual namuna.

Ushbu manbalarni diqqat bilan o‘rgan. Ulardagi biznes jarayonlari va talablarni saqla, lekin mavjud kamchiliklarni texnik jihatdan yaxshila.

---

# 1. LOYIHANING ASOSIY MAQSADI

Registo tizimining maktab ERP imkoniyatlari va EdEx Test tizimining test hamda coin mexanizmini yagona platformaga birlashtirish.

Asosiy modullar:

1. Dashboard
2. O‘quvchilar
3. Ota-onalar / vasiylar
4. Xodimlar
5. Sinflar va fanlar
6. O‘quv yillari
7. Dars jadvali
8. Elektron jurnal va baholash
9. Choraklik va yarim yillik baholash
10. Testlar (online / offline)
11. Coin / rag‘batlantirish tizimi
12. Face ID davomat
13. Moliya va to‘lovlar
14. Qarzdorlik va undiruv
15. Xodimlar maoshi va KPI
16. Kutubxona
17. Inventar
18. CRM va qabul
19. Bildirishnomalar
20. Telegram integratsiyasi
21. Hisobotlar va statistika
22. AI yordamchi
23. Tizim sozlamalari va audit

Barcha modullar yagona ma'lumotlar bazasi va yagona autentifikatsiya tizimidan foydalanishi kerak.

# 2. ISHLASH TARTIBI VA MUHIM KO‘RSATMALAR

Ishni boshlashdan oldin repository'ni to‘liq o‘rgan.

Quyidagilarni tekshir:

- Mavjud loyiha strukturasi.
- Frontend va backend texnologiyalari.
- Prisma schema va migratsiyalar.
- Mavjud autentifikatsiya.
- Foydalanuvchi rollari.
- EdEx Test mavjud funksiyalari.
- API endpointlar.
- Fayllar va rasmlarni saqlash.
- Mavjud dizayn komponentlari.
- Testlar va ularning natijalari.
- Environment variables.
- Deploy konfiguratsiyasi.

**Muhim:**

- Mavjud ishlaydigan funksiyalarni sababsiz o‘chirib yuborma.
- EdEx Test'ni qaytadan noldan yozishga shoshilma. Avval mavjud kodni tahlil qilib, qayta foydalanish mumkin bo‘lgan qismlarini aniqlagin.
- Mavjud ma'lumotlar bazasini ruxsatsiz o‘chirma yoki reset qilma.
- Production ma'lumotlari va konfiguratsiyasini o‘zgartirma.
- Mavjud API kontraktlarini tekshirmasdan buzma.
- Bir vaqtning o‘zida juda ko‘p modulni yozib, tekshirilmagan kod qoldirma.
- Har bir bosqichdan keyin test, lint, typecheck va build bajar.
- Noaniq biznes qoidalarini o‘zingcha qat'iy belgilama. Ularni konfiguratsiya qilinadigan parametr sifatida loyihala yoki qaror talab qiladigan masalalar ro‘yxatiga kirit.
- Hech qachon bajarilmagan funksiyani tayyor deb ko‘rsatma.

## Dastlabki javobingda quyidagilarni tayyorla:

1. Mavjud repository tahlili.
2. Hozirgi koddan qayta foydalaniladigan qismlar.
3. Kamchiliklar va xavflar.
4. Taklif qilinayotgan yakuniy arxitektura.
5. Database modeli va asosiy munosabatlar.
6. API modullari.
7. Frontend sahifalari va navigatsiya.
8. Amalga oshirish bosqichlari.
9. Har bosqich uchun acceptance criteria.
10. Aniqlashtirish talab qiladigan biznes qarorlari.

Shundan so‘ng implementatsiyani bosqichma-bosqich amalga oshir.

---

# 3. TEXNOLOGIK STEK

Asosiy tavsiya etilgan stack:

### Frontend

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- CSS Variables
- TanStack Query
- React Hook Form
- Zod
- Reusable UI components
- ApexCharts yoki Recharts
- Flatpickr yoki mos zamonaviy date picker

### Backend

- Node.js
- Express.js
- TypeScript
- REST API
- Prisma ORM
- PostgreSQL

### Fon vazifalari

- Redis
- BullMQ

Quyidagi ishlar queue orqali bajarilishi kerak:

- Face ID qurilmalariga yuz ma'lumotlarini yuborish.
- Telegram va SMS xabarlari.
- Katta Excel import/export.
- PDF hisobotlar.
- Eslatmalar.
- Bildirishnomalar.
- Davriy avtomatik hisob-kitoblar.

### Face ID Bridge

- Node.js yoki Go asosidagi lokal agent.
- Windows Service sifatida ishlash.
- Maktab lokal tarmog'idagi Hikvision qurilmalariga ulanish.
- Server bilan polling yoki xavfsiz outbound HTTPS orqali aloqa.
- Diskda saqlanadigan ishonchli job/event navbati.

### Infratuzilma

- PostgreSQL — asosiy ma'lumotlar bazasi.
- Redis — queue va zarur bo‘lsa cache.
- Backend — doimiy ishlaydigan VPS yoki server.
- Frontend — alohida deploy qilinishi mumkin.
- GitHub Actions — CI/CD.
- Fayllar — xavfsiz object storage yoki server storage abstraksiyasi.

Agar mavjud repository boshqa stack'da bo‘lsa, avval uning migratsiya xarajatini bahola. Faqat texnologiyani almashtirish uchun ishlayotgan tizimni qayta yozma.

Face ID webhook va background job talab qiladigan backendni serverless funksiyaga bog‘lab qo‘yma.

---

# 4. BIR MAKTAB BILAN ISHLASH, KELAJAKDA MULTI-TENANT

Hozir platforma faqat bitta maktab — Idrok uchun ishga tushiriladi.

Ammo kelajakda boshqa maktablarga ham o‘rnatish imkoniyati bo‘lishi kerak.

Shuning uchun:

- Database jadvallarida kerakli joylarda `tenantId` bo‘lsin.
- Har bir maktab o‘z ma'lumotlarini ko‘rsin.
- Barcha tenant-scoped so‘rovlar server tomonidan tekshirilsin.
- Frontend yuborgan `tenantId`ga ishonilmasin.
- Maktablararo ma'lumotlar chiqib ketishiga yo‘l qo‘yilmasin.
- Hozircha SaaS billing, tarif va tenant yaratish panelini ishlab chiqish shart emas.
- Lekin keyinchalik multi-tenant rejimga o‘tish uchun database va servislar tayyor bo‘lsin.

Hozirgi default konfiguratsiya:

- Platform name: Idrok System
- School name: Idrok
- Primary color: #4E92CF
- Timezone: Asia/Tashkent
- Currency: UZS
- Locale: uz-UZ

Platforma nomi, maktab nomi va brending alohida sozlanishi kerak.

---

# 5. UI/UX VA DESIGN SYSTEM

Men yuborgan universitet dashboard rasmini asosiy vizual referens sifatida ishlat.

Dizayn yo‘nalishi:

- Minimalistik.
- Professional.
- Toza.
- Zamonaviy.
- White / Light surfaces.
- Ko‘k aksent.
- Ortiqcha bezaklarsiz.
- Ma'lumotlarni o‘qish qulayligi birinchi o‘rinda.

## 5.1. Ranglar

Asosiy rang:

`#4E92CF`

Tavsiya etilgan boshlang‘ich palitra:

```css
:root {
  --color-primary: #4E92CF;
  --color-primary-hover: #397FBF;
  --color-primary-strong: #286FA9;
  --color-primary-soft: #EAF3FB;

  --color-background: #F5F8FC;
  --color-surface: #FFFFFF;
  --color-sidebar: #FFFFFF;

  --color-text-primary: #172B3A;
  --color-text-secondary: #718096;

  --color-border: #E3EAF1;

  --color-success: #16A36A;
  --color-warning: #E9A23B;
  --color-danger: #DC5A5A;
  --color-info: #4E92CF;

  --radius-card: 12px;
  --radius-button: 8px;
}
```

Bu faqat boshlang‘ich Light theme palitrasi. Dark theme uchun ham alohida tokenlar yoz.

**Eng muhim qoida:** ranglarni komponentlarning ichida to‘g‘ridan-to‘g‘ri yozish taqiqlanadi.

Masalan, quyidagi yondashuvdan foydalanma:

```tsx
<button className="bg-[#4E92CF]">
```

Buning o‘rniga semantic tokenlardan foydalan:

```tsx
<button className="bg-primary">
```

Yoki:

```css
.button-primary {
  background: var(--color-primary);
}
```

Barcha komponentlar markazlashgan design tokenlarga tayanishi kerak.

## 5.2. Maktab brendingi

`SchoolBranding` konfiguratsiyasi yaratilishi kerak.

Maydonlar:

- schoolName
- platformName
- logoUrl
- faviconUrl
- primaryColor
- primaryHoverColor
- primarySoftColor
- secondaryColor
- themeMode
- customBrandingEnabled

Kelajakda boshqa maktabga o‘rnatilganda:

- Maktab nomi.
- Platformada ko‘rinadigan nom.
- Logo.
- Favicon.
- Asosiy rang.
- Qo‘shimcha brend ranglari.

almashtirilishi bilan butun UI avtomatik yangilanishi kerak.

Brending sozlamalari database'da saqlansin va frontendga xavfsiz tarzda uzatilsin.

CSS Variables runtime'da yangilanishi kerak.

## 5.3. Theme

Uchta rejim:

- LIGHT
- DARK
- SYSTEM

Default: SYSTEM.

SYSTEM rejimida operatsion tizimning `prefers-color-scheme` qiymati aniqlansin.

Foydalanuvchi rejimni qo‘lda o‘zgartirishi ham mumkin.

Theme tanlovi foydalanuvchi kesimida saqlansin.

## 5.4. Sidebar

Sidebar COLLAPSIBLE bo‘lsin.

- Expanded holat: ikonka + menyu nomi.
- Collapsed holat: faqat ikonka.
- Hover'da tooltip.
- Active menu aniq ko‘rinsin.
- Mobil qurilmada drawer ko‘rinishida ochilsin.
- Holati foydalanuvchi uchun saqlansin.

## 5.5. Density

Default: COMFORTABLE.

- Yetarli padding.
- O‘qilishi oson shrift.
- Keng kartalar.
- Jadval va formalar orasida yetarli masofa.
- Juda zich dashboard qilinmasin.

## 5.6. Responsive

Desktop, tablet va mobile ekranlarga moslashsin.

Mobil uchun:

- Mobil navigatsiya.
- Qulay formalar.
- Responsive jadvallar.
- Keraksiz gorizontal scroll bo‘lmasligi.
- O‘quvchi va ota-ona kabinetlari mobile-first tamoyilida ishlab chiqilishi.

## 5.7. UI komponentlar

Markazlashgan komponentlar:

- Button
- Input
- Select
- DatePicker
- Modal
- Drawer
- DataTable
- Pagination
- Search
- Filter
- Tabs
- Badge
- Dropdown
- Confirmation Dialog
- Toast
- Empty State
- Loading Skeleton
- Error State
- Stat Card
- Chart
- File Upload
- Avatar
- Breadcrumb

Ro‘yxat sahifalari uchun:

Search + Filter + Table + Pagination.

Qo‘shish/tahrirlash uchun:

Drawer yoki modal formalar.

Saqlash muvaffaqiyatli bo‘lganda ro‘yxat yangilansin.

URL'da kerakli filter va pagination parametrlarini saqla.

---

# 6. AUTENTIFIKATSIYA VA RBAC

Bitta umumiy User modeli bo‘lsin.

Role va Permission mexanizmi ishlatilsin.

Asosiy rollar:

- SUPER_ADMIN
- SCHOOL_ADMIN
- DIRECTOR
- DEPUTY_DIRECTOR
- ADMINISTRATOR
- TEACHER
- CLASS_TEACHER
- HR_MANAGER
- ACCOUNTANT
- LIBRARIAN
- PARENT / GUARDIAN
- STUDENT

Role'lar permission'lar to‘plamidan tashkil topishi mumkin.

Bir foydalanuvchida bir nechta rol bo‘lishiga arxitektura to‘sqinlik qilmasin.

Har bir modul uchun alohida permission:

- view
- create
- update
- delete
- approve
- export
- manage

Misol:

`students.view`, `students.create`, `students.update`, `students.delete`

`finance.view`, `finance.payment.create`, `finance.payment.approve`

`attendance.view`, `attendance.manual.create`

`assessment.manage`, `assessment.approve`

Ruxsatlar faqat frontendda emas, backendda ham tekshirilsin.

## Autentifikatsiya

- Login / logout.
- Access token.
- Refresh token rotation.
- Secure cookie yoki xavfsiz token saqlash.
- 401 / 403 boshqaruvi.
- Session revoke.
- Parolni yangilash.
- Parolni tiklash.
- Login urinishlarini cheklash.
- Xodimlar uchun 2FA imkoniyati.
- Audit log.

Parollar bcrypt yoki Argon2 bilan hash qilinsin.

Default parollar va maxfiy kalitlar kodga yozilmasin.

Admin foydalanuvchi yaratganda tizim vaqtinchalik parol yaratishi mumkin. Parol bir marta ko‘rsatiladi va foydalanuvchi birinchi kirishda uni almashtiradi.

Self-registration default holatda o‘chirilgan.

---

# 7. ASOSIY MA'LUMOTLAR MODELI

Mavjud Prisma sxemasini tahlil qilib, quyidagi mantiqiy obyektlarni yagona modelga birlashtir.

## Asosiy

- Tenant
- SchoolSettings
- SchoolBranding
- User
- Role
- Permission
- UserRole
- AcademicYear
- AcademicPeriod
- Shift
- Grade
- ClassGroup
- Subject
- TeacherAssignment

## O‘quvchilar

- Student
- Guardian
- StudentGuardian
- StudentDocument
- StudentPhoto
- StudentAcademicHistory
- StudentEnrollment
- Contract

## Xodimlar

- Employee
- Position
- EmployeeDocument
- EmployeeContract
- SalaryConvention
- SalaryPayment
- Violation
- StaffObservation
- StaffIndex

## Dars jarayoni

- Timetable
- TimetableDraft
- TimetableEntry
- Room
- LessonPeriod
- LessonSession
- LessonAttendance
- Gradebook
- ScoreEntry

## Baholash

- AssessmentPolicy
- AssessmentComponent
- AssessmentWeight
- AssessmentRule
- DailyScore
- PeriodScore
- AssessmentSnapshot
- ScoreTransaction

## Test

- Test
- TestQuestion
- Question
- QuestionOption
- TestAttempt
- TestAnswer
- TestEvent
- TestRetake
- TestResult
- TestWeight

## Coin

- CoinCriterion
- CoinLimit
- CoinTransaction
- CoinProduct
- CoinOrder
- CoinSettings

## Face ID

- Device
- FaceProfile
- FaceSyncJob
- AccessEvent
- AttendanceRecord
- BridgeAgent
- BridgeJob

## Moliya

- ContractType
- PaymentPlan
- PaymentPlanItem
- Payment
- PaymentAllocation
- PaymentMethod
- Cashbox
- Income
- Expense
- CashTransfer
- Dividend
- CollectionTask

## Qo‘shimcha

- Notification
- NotificationTemplate
- Announcement
- Appeal
- Survey
- Task
- Book
- BookCopy
- LibraryLoan
- InventoryItem
- InventoryCategory
- Lead
- MarketingCampaign
- Vacancy
- Candidate
- AuditLog
- FileAsset

Bu mantiqiy ro‘yxat. Yakuniy Prisma modelini normalizatsiya, relation, unique constraint va indekslar asosida loyihala.

Har bir modelga zarur joyda:

- id
- tenantId
- createdAt
- updatedAt
- createdById

qo‘sh.

Tarixiy ma'lumotlarni o‘chirib yuborish o‘rniga status va arxivlash mexanizmidan foydalan.

---

# 8. O‘QUV YILI VA SINFLAR

AcademicYear:

- name
- startDate
- endDate
- isCurrent
- status

Bir vaqtning o‘zida bitta joriy o‘quv yili bo‘lsin.

Yangi o‘quv yiliga o‘tish jarayoni alohida wizard bo‘lsin.

O‘quv yili almashganda:

- O‘quvchilar keyingi sinfga o‘tkaziladi.
- Bitiruvchilar ajratiladi.
- Yangi o‘quvchilar qo‘shiladi.
- O‘qituvchi biriktirishlari yangilanadi.
- Fanlar va sinflar qayta tashkil etiladi.
- Shartnomalar yangilanadi.
- Eski yilning natijalari va davomat tarixi saqlanadi.
- Audit yozuvi yaratiladi.

Eski o‘quv yilidagi ma'lumotlar yangi yil ma'lumotlari bilan aralashmasin.

---

# 9. O‘QUVCHILAR VA VASIYLAR

O‘quvchi profili quyidagi maydonlarni qamrab olishi mumkin:

- Student code: STD-0001
- First name
- Last name
- Middle name
- Date of birth
- Gender
- Phone
- Address
- Passport series
- Birth certificate number
- INN
- Photo
- Notes
- Source
- Referred by
- Face ID status
- Academic status

Passport, INN va boshqa sezgir ma'lumotlar shifrlangan holda saqlansin va interfeysda maskalansin.

Guardian alohida model bo‘lsin.

Bir o‘quvchiga bir nechta vasiy biriktirish mumkin.

Guardian bilan aloqa:

- Ism.
- Telefon.
- Qarindoshlik.
- Telegram.
- Asosiy vasiy.
- Bildirishnoma olish huquqi.

Ota-onalar faqat o‘ziga biriktirilgan o‘quvchilarning ma'lumotlarini ko‘rsin.

O‘quvchi profilida quyidagilar bir joyda ko‘rinsin:

- Shaxsiy ma'lumot.
- Sinfi.
- O‘quv yili.
- Fanlari.
- O‘qituvchilari.
- Davomat.
- Test natijalari.
- Kunlik va davriy ballar.
- Coin balansi.
- Shartnoma.
- To‘lovlar.
- Qarzdorlik.
- Kutubxona tarixi.
- Face ID holati.
- Vasiylar.

Excel import/export bo‘lsin.

---

# 10. DARS JADVALI

Dars jadvali tizimning markaziy modullaridan biri.

Ikki xil ishlash rejimi bo‘lsin.

## Rejim A: TIMETABLE

To‘liq haftalik dars jadvali.

Har bir dars:

- AcademicYear
- Grade/Class
- Subject
- Teacher
- Room
- Weekday
- Lesson number
- Start time
- End time
- Week type (odd/even/all)
- Shift

Admin jadvalni qo‘lda yaratishi va tahrirlashi mumkin.

Avtomatik jadval yaratish ham qo‘llab-quvvatlansin.

Avtomatik tuzish uchun OR-Tools CP-SAT solver'ni alohida Python microservice sifatida ishlatish mumkin.

Qattiq cheklovlar:

- O‘qituvchi bir vaqtning o‘zida ikkita darsda bo‘lmasligi.
- Xona bir vaqtda ikkita sinfga ajratilmasligi.
- Sinf bir vaqtda ikkita darsda bo‘lmasligi.
- O‘qituvchi yuklamasi chegarasi.
- Fan bo‘yicha haftalik soat.

Yumshoq cheklovlar:

- Oyna darslar sonini kamaytirish.
- Og‘ir fanlarni qulay vaqtga joylashtirish.
- O‘qituvchining afzal vaqtlarini hisobga olish.

Jadval draft holatida yaratiladi. Admin tasdiqlagandan keyin asosiy jadvalga aylanadi.

Ko‘rinishlar:

- Sinf bo‘yicha.
- O‘qituvchi bo‘yicha.
- Xona bo‘yicha.

Excel va PDF eksport.

## Rejim B: TIME_SLOTS

Agar maktabda to‘liq dars jadvali hali shakllantirilmagan bo‘lsa, admin kunlik vaqt oralig‘ini belgilaydi.

Masalan:

- 08:00–08:45
- 08:55–09:40
- 09:50–10:35
- 10:45–11:30
- 11:40–12:25

Bu rejimda ball berish va davomat limitlari belgilangan vaqt oralig‘iga bog‘lanishi mumkin.

## Muhim qoida

Keyinchalik TIME_SLOTS rejimidan TIMETABLE rejimiga o‘tilsa:

- Eski ballar o‘zgarmasin.
- Eski davomat yozuvlari o‘zgarmasin.
- Tarixiy transaction'lar saqlansin.
- Yangi darslar jadvalga bog‘lansin.

---

# 11. DAVOMAT VA FACE ID

Face ID davomat Registo'dagi Hikvision ISAPI mexanizmi asosida ishlab chiqilsin.

Yuzni tanish serverda emas, terminalning o‘zida amalga oshadi.

Server:

- O‘quvchining yuz ma'lumotlarini qurilmaga yuboradi.
- Qurilma yuborgan eventlarni qabul qiladi.
- Kelish va ketish vaqtlarini hisoblaydi.
- Kechikishni aniqlaydi.
- Davomat yozuvini yaratadi.
- Bildirishnoma yuboradi.

## Qurilmalar

Device maydonlari:

- name
- deviceId
- serialNumber
- IP address
- port
- username
- encrypted password
- direction
- location
- useBridge
- isActive
- blocksDebtors
- lastSeen
- connectionStatus

Direction:

- IN
- OUT
- BOTH

Alohida kirish va chiqish kameralarini qo‘llab-quvvatla.

Misol:

- Kirish kamerasi — IN.
- Chiqish kamerasi — OUT.

Bitta terminal ikkala yo‘nalishda ishlasa, BOTH bo‘lsin va eventdagi checkIn/checkOut qiymatidan foydalanilsin.

Qurilmani IP bo‘yicha emas, serial number orqali aniqlashga ustuvorlik ber.

## Face ID oqimi

1. Admin o‘quvchi profiliga rasm yuklaydi.
2. Server FaceSyncJob yaratadi.
3. BullMQ job'ni qayta ishlaydi.
4. Bridge qurilma bilan ISAPI Digest orqali aloqa qiladi.
5. Eski yuz ma'lumoti kerak bo‘lsa o‘chiriladi.
6. UserInfo/Record yaratiladi.
7. FaceDataRecord orqali yuz yuboriladi.
8. Natija pending / synced / failed holatida qayd etiladi.

Qurilma webhook:

`/attendance/api/hikvision-event/:apiKey`

Hikvision AccessControllerEvent multipart/form-data formatini qo‘llab-quvvatla.

Heartbeat eventlarini ajrat.

Takror eventlarni idempotent qayta ishlash.

Qurilma va server vaqti NTP orqali moslashtirilsin.

## Face Check

Admin quyidagilarni ko‘ra olsin:

- Serverdagi rasm.
- Qurilmadagi rasm.
- Oxirgi sinxronlash.
- Holat.
- Xatolik.
- Qayta yuborish.
- Qurilmadan tekshirish.

## Bridge

Bridge Windows Service sifatida ishlasin.

- Har 10 soniyada polling yoki mos xavfsiz mexanizm.
- Job navbati.
- Diskda saqlanadigan offline queue.
- Eventlarni yo‘qotmaslik.
- Reconnect.
- Monitoring.
- Last heartbeat.
- Token rotation.
- Job status.

Bridge o‘chib qolsa, qurilma eventlari yo‘qolmasligi uchun imkon qadar terminal event tarixidan qayta olish mexanizmini ko‘rib chiq.

## Davomat turlari

Ikki mustaqil tushuncha bo‘lsin:

1. SCHOOL_ATTENDANCE — maktabga kirish va chiqish.
2. LESSON_ATTENDANCE — har bir darsda qatnashish.

Kirish/chiqish kamerasi o‘quvchining har bir darsda qatnashganini isbotlamaydi.

LESSON_ATTENDANCE o‘qituvchi tomonidan belgilanadi yoki kelajakda sinf qurilmalari orqali avtomatlashtiriladi.

## Kechikish

Smena yoki belgilangan kirish vaqtiga nisbatan hisoblanadi.

Kechikish oraliqlari admin tomonidan sozlanadi.

Masalan:

- 1–3 daqiqa.
- 3–7 daqiqa.
- 7 daqiqadan ko‘p.

Har bir interval uchun alohida coin qoidasi bo‘lishi mumkin.

## Xavfsizlik

- Biometrik ma'lumotlar shifrlansin.
- Ota-ona roziligi jarayoni hisobga olinsin.
- Ma'lumotlarni saqlash va o‘chirish siyosati bo‘lsin.
- O‘quvchi maktabdan ketganda yuz ma'lumotini qurilma va serverdan o‘chirish imkoniyati bo‘lsin.
- Biometrik ma'lumotlar va voyaga yetmaganlar ma'lumotlariga oid O‘zbekiston qonunchiligi alohida huquqiy tekshiruvdan o‘tkazilsin.
- Server hosting joylashuvi bo‘yicha production qarori huquqiy talablar tekshirilgandan keyin qabul qilinsin.

**Muhim:** qarzdorlik sababli o‘quvchini maktabga kiritmaslik default holatda o‘chirilgan bo‘lsin. Har bir qurilma uchun alohida siyosat bo‘lsin. Standart rejim — ogohlantirish va vasiyga xabar.

---

# 12. BALL VA BAHOLASH TIZIMI

Bu loyiha uchun eng muhim modullardan biri.

Akademik ball, davriy baholash va Coin bir-biridan mustaqil bo‘lishi kerak.

Ular kerakli joyda integratsiya qilinadi, lekin bitta balansga aralashtirilmaydi.

## 12.1. Ball turlari

Uchta tushunchani alohida saqla:

1. Academic Score — darslarda olingan akademik ball.
2. Period Assessment — choraklik/yarm yillik yakuniy natija.
3. Coin — rag‘batlantirish va jarima uchun alohida hisob birligi.

## 12.2. Kunlik ball

O‘qituvchi o‘ziga biriktirilgan sinf va fan bo‘yicha o‘quvchilarga ball beradi.

Har bir baholash:

- Student
- Teacher
- Subject
- Grade
- AcademicYear
- Date
- LessonSession yoki TimeSlot
- Criterion
- MaxScore
- EarnedScore
- Note
- Source

Admin ball limitlarini mustaqil belgilashi kerak.

Masalan:

- Bir dars uchun maksimal 10 ball.
- Bir kun uchun maksimal 50 ball.
- Bir fan uchun kunlik maksimal 10 ball.
- O‘qituvchi bo‘yicha limit.
- O‘quvchi bo‘yicha limit.
- Haftalik yoki oylik limit.

Limitlar iyerarxiyasi:

- Global.
- Sinf.
- Fan.
- O‘qituvchi.
- Dars.
- Dars vaqti.

Aniqroq qoida umumiy qoidadan ustun bo‘lsin.

Ammo global xavfsizlik limiti hech qachon buzilmasin.

Bitta o‘quvchiga bir nechta o‘qituvchi bergan ballar ham limitlarni tekshirishda birgalikda hisobga olinsin.

## 12.3. Kunlik hisoblash rejimlari

Admin quyidagilardan birini tanlay olsin:

**A. Umumiy kunlik natija**

Barcha fanlar/darslardan olingan ballar qo‘shiladi.

Misol:

- 5 ta dars.
- Har bir dars maksimal 10 ball.
- Maksimal natija 50.
- O‘quvchi 45 ball olgan.
- Natija: 45/50 = 90%.

**B. Fanlar alohida**

Har bir fan o‘zining kunlik natijasi bilan ko‘rsatiladi.

Barcha fanlar yig‘indisidan umumiy natija hisoblanmaydi.

**C. Ikkalasi ham**

Fanlar alohida ko‘rsatiladi va umumiy natija ham chiqariladi.

**D. Vaznli natija**

Fanlar yoki darslarga koeffitsiyent beriladi.

Masalan:

- Matematika: 1.5
- Informatika: 1.2
- Boshqa fanlar: 1.0

Admin hisoblash qoidalarini o‘zi belgilaydi.

## 12.4. Hisoblash davrlari

- Kunlik.
- Haftalik.
- Oylik.
- Choraklik.
- Yarim yillik.
- Yillik.

Har bir davrni mustaqil yoqish/o‘chirish mumkin.

## 12.5. Istisno holatlari

Admin quyidagilarni sozlay olsin:

- O‘quvchi darsga kelmasa.
- Sababli kelmasa.
- Sababsiz kelmasa.
- Dars bekor qilinsa.
- O‘qituvchi hali ball kiritmagan bo‘lsa.
- O‘quvchi qo‘shimcha ball olsa.
- Ball maksimal limitdan oshsa.

Baholanmagan darsni avtomatik 0 ball deb hisoblama.

Uning holati PENDING bo‘lsin.

Davomat bo‘yicha nol ball, hisobdan chiqarish yoki boshqa qoida admin tomonidan belgilanadi.

## 12.6. Fanlar bo‘yicha davriy natija

Fanlar alohida yuritilishi shart.

Maktab quyidagilardan birini tanlaydi:

- Faqat fanlar bo‘yicha natija.
- Umumiy natija.
- Fanlar va umumiy natija.

Chorak oxirida istalgan fan bo‘yicha alohida yakuniy natija olish mumkin bo‘lsin.

## 12.7. Baholash davri

Maktab admini baholash davrini belgilaydi:

- 4 ta chorak.
- 2 ta yarim yillik.
- Kelajakda maxsus davrlar yaratish imkoniyati.

AcademicPeriod:

- name
- type
- academicYearId
- startDate
- endDate
- status
- order

Har bir fan va o‘quvchi uchun davriy natija alohida saqlansin.

## 12.8. Davriy maksimal ball

Admin har bir chorak yoki yarim yillik uchun maksimal ballni belgilaydi.

Masalan:

1-chorak — 100 ball.

Uning tarkibi:

- Testlar — 50 ball.
- Darslardagi kundalik natijalar — 50 ball.

O‘quvchining darsdagi o‘rtacha natijasi 88% bo‘lsa:

88% × 50 = 44 ball.

Testlar bo‘yicha 43/50 olgan bo‘lsa:

43 + 44 = 87/100.

Yakuniy natija: 87/100.

Formula va hisoblash usullari admin sozlamalariga bog‘liq bo‘lsin.

## 12.9. Davriy baholash tarkibi

`AssessmentPolicy` va `AssessmentComponent` mexanizmini yarat.

Komponent turlari:

- DAILY_SCORES
- TESTS
- MANUAL_SCORE
- OTHER

Har bir komponent uchun:

- Name
- Type
- MaxWeight
- CalculationMethod
- IsEnabled
- Subject-specific yoki global
- Included assessment periods
- Rounding rule

Komponentlarning maksimal vaznlari yig‘indisi davriy maksimal ballga teng bo‘lishi kerak.

Masalan:

50 + 50 = 100.

Agar vaznlar yig‘indisi noto‘g‘ri bo‘lsa, adminni ogohlantir va sozlamani tasdiqlashga yo‘l qo‘yma.

## 12.10. Test va kundalik ballarni birlashtirish

Uchta rejim bo‘lsin:

1. COMBINED — test va kundalik ballar yakuniy natijaga qo‘shiladi.
2. SEPARATE — test va dars ballari alohida statistikada yuritiladi.
3. SELECTIVE — faqat admin tanlagan vaznli testlar yakuniy natijaga qo‘shiladi.

Bu sozlama maktab darajasida ham, zarurat bo‘lsa fan kesimida ham ishlashi mumkin.

## 12.11. Chorak va yarim yillik natijalar

Yarim yillik natija choraklardan shakllanishi mumkin.

Admin quyidagilarni belgilaydi:

- Choraklarning oddiy o‘rtachasi.
- Choraklar uchun alohida vazn.
- Yakuniy nazoratning alohida vazni.
- Maxsus formula.

Masalan:

1-chorak 40%, 2-chorak 60%.

Yarim yillik natija admin belgilagan qoida asosida hisoblanadi.

Barcha formulalar versiyalanishi va audit qilinishi kerak.

## 12.12. Natijani yopish

Davr yakunlanganda:

- O‘qituvchi ball kiritishni to‘xtatishi yoki cheklangan holatda davom ettirishi mumkin.
- Vakolatli admin natijani tasdiqlaydi.
- Snapshot saqlanadi.
- Qaysi qoida va vazn ishlatilgani saqlanadi.
- Keyingi o‘zgarishlar audit qilinadi.
- Qayta hisoblash faqat maxsus ruxsat bilan amalga oshiriladi.

Oldingi davr sozlamalari o‘zgarganda eski natijalar avtomatik o‘zgarmasin.

---

# 13. TEST TIZIMI — EDEX TEST INTEGRATSIYASI

Mavjud EdEx Test mexanizmini imkon qadar saqlab, yagona platformaga integratsiya qil.

Testlar uch xil auditoriya uchun ishlashi mumkin:

- STUDENT
- LEAD
- CANDIDATE

Asosiy o‘quv testlari o‘quvchi va sinf uchun.

## 13.1. Test shakli

- ONLINE
- OFFLINE

## 13.2. Test vazifasi

- PRACTICE
- WEIGHTED

PRACTICE — mashq va mustaqil statistika.

WEIGHTED — choraklik yoki yarim yillik baholashga qo‘shilishi mumkin bo‘lgan test.

Online/offline shakli va practice/weighted vazifasi bir-biridan mustaqil bo‘lsin.

Masalan:

- ONLINE + PRACTICE.
- ONLINE + WEIGHTED.
- OFFLINE + PRACTICE.
- OFFLINE + WEIGHTED.

## 13.3. Test turlari

- ChSB.
- BSB.
- Nazorat ishi.
- Sinov testi.
- Oddiy test.
- Maxsus test turi.

Admin yangi nazorat turlarini qo‘shishi mumkin.

## 13.4. Online test

Maydonlar:

- Title
- Subject
- Grade
- Teacher
- Description
- StartsAt
- EndsAt
- TimeLimit
- Audience
- QuestionCount
- ShuffleQuestions
- ShuffleOptions
- QuestionBank
- TestType
- AssessmentPeriod
- Weight
- MaxScore
- Status

Savol turlari:

- SINGLE
- MULTIPLE
- SHORT_TEXT
- MATCHING

Testni sinfga yoki tanlangan o‘quvchilarga berish mumkin.

## 13.5. Savollar banki

O‘qituvchining shaxsiy savollar banki bo‘lsin.

Savollar:

- Text.
- Image.
- Options.
- Correct answer.
- Question type.
- Subject.
- Grade.
- Difficulty.

Excel import/export.

Takror savollarni tekshirish.

Sinfga avval berilgan savollarni belgilash.

Testdagi savollar soniga admin limit belgilashi mumkin.

Testni saqlashdan oldin barcha validatsiyalar serverda ham tekshirilsin.

## 13.6. Testni yechish

- Bitta savol — bitta ekran.
- Keyingi / oldingi savol.
- Har bir javob autosave.
- Joriy savol raqami saqlanadi.
- Sahifa yangilanganda davom etadi.
- Har bir o‘quvchi uchun savollar tartibi alohida.
- Variantlar ham har bir o‘quvchida alohida aralashtiriladi.
- Taymer server vaqti asosida ishlaydi.

## 13.7. Test xavfsizligi

TestAttempt modeli:

- startedAt
- deadline
- answers
- events
- status
- finishReason

Yakunlash sabablari:

- SUBMITTED
- TIME_UP
- VIOLATION

Lekin finishReason brauzerdan ishonchli qiymat sifatida qabul qilinmasin. Server o‘z event log'i asosida aniqlasin.

Anti-cheat:

- visibilitychange asosiy event.
- blur ikkilamchi event.
- Takror eventlarni deduplicate qilish.
- Ogohlantirishlar.
- Belgilangan chegaradan oshganda server avtomatik yakunlashi.
- Admin qayta ochishi mumkin.

Javoblar faqat test oxirida yuborilmasin. Har bir javob serverga darhol saqlansin.

TIME_UP bo‘lganda internet uzilgan bo‘lsa ham serverdagi saqlangan javoblar baholansin.

Variant matni emas, optionId saqlansin.

Admin testni vaqtini o‘zgartirishi faqat tugamagan testlarda mumkin.

Retake — tanlangan o‘quvchilarga alohida yangi vaqt berish.

## 13.8. Offline test

O‘qituvchi qog‘ozda o‘tkazilgan test natijasini kiritadi.

Baholash shkalasi:

- 5
- 10
- 20
- 25
- 40
- 50
- 100

Natija foizga aylantirilishi mumkin.

Bo‘sh qoldirilgan o‘quvchi qatnashmagan deb belgilanadi. Uni avtomatik 0 deb hisoblash faqat admin siyosati bo‘yicha amalga oshsin.

OFFLINE + WEIGHTED testlar ham davriy bahoga qo‘shila olsin.

## 13.9. Vaznli test

Test yaratishda:

- AssessmentPeriod.
- MaxScore.
- Weight.
- MaxContribution.
- RetakePolicy.
- IncludedInAssessment.

belgilansin.

Bir nechta vaznli test bo‘lsa, ularning vazni davriy test komponentining limitidan oshib ketmasligi kerak.

Test natijasi va davriy bahoga qo‘shilgan hissasi alohida ko‘rsatilsin.

## 13.10. Test statistikasi

- Test natijalari.
- O‘quvchi natijasi.
- Sinf o‘rtachasi.
- Fan o‘rtachasi.
- Oldingi test bilan taqqoslash.
- Savollar kesimida statistika.
- Excel eksport.
- O‘quvchi kartasidagi test tarixi.

---

# 14. COIN / GAMIFIKATSIYA

Coin akademik ballardan mustaqil.

CoinTransaction yagona ledger bo‘lsin.

Manbalar:

- teacher_criterion
- attendance
- test_result
- admin_adjust
- shop_purchase
- refund
- other

## Mezonlar

- REWARD
- PENALTY
- BOTH

Maydonlar:

- Name
- Description
- MinAmount
- MaxAmount
- SubjectSpecific
- IsAutomatic
- IsActive
- EligibleRoles

## Limitlar

- Scope.
- Period.
- MaxCoin.
- MaxCount.
- BOTH.

Limitlar barcha o‘qituvchilarning bir o‘quvchiga bergan coinlarini birga hisoblasin.

## O‘qituvchi faolligi

Admin so‘nggi N kun ichida o‘qituvchi o‘z o‘quvchilarining kamida X foizini baholagan bo‘lishini talab qilishi mumkin.

Holatlar:

- ACTIVE
- LOW_ACTIVITY
- INACTIVE
- UNASSIGNED

## Coin Shop

- Product image.
- Name.
- Description.
- Price.
- Stock.
- Visibility.

Xarid jarayoni:

PENDING → APPROVED → DELIVERED.

Qo‘shimcha:

- REJECTED.
- CANCELLED.

Xaridni tasdiqlash admin sozlamasiga bog‘liq.

## Coin debt

Ixtiyoriy.

- Coin balans manfiyga tushishi mumkin.
- Chegara admin tomonidan belgilanadi.
- Qarzdor o‘quvchi xarid qila olmaydi.
- Keyingi mukofotlar avval qarzni yopadi.

## Avtomatik coin

- Vaqtida kelish: +1.
- Kechikish: admin belgilagan jarima.
- Yuqori test natijasi: ixtiyoriy.
- Kitobxonlik: ixtiyoriy.
- Kunlik topshiriqlar: ixtiyoriy.

Coin tizimining barcha qismlari admin sozlamalaridan yoqib/o‘chirilishi mumkin.

Tranzaksiyalarni o‘chirma. Xatoni reversal transaction bilan tuzat.

---

# 15. MOLIYA VA TO‘LOVLAR

Registo'dagi moliya modelini yagona platformaga integratsiya qil.

Zanjir:

ContractType → Contract → PaymentPlan → Payment → PaymentAllocation.

## ContractType

- Name
- Description
- Grade range
- Monthly fee
- Status

## Contract

- Contract number
- Student
- AcademicYear
- Grade/Class
- ContractType
- MonthlyFee
- StartDate
- EndDate
- SignedFile
- Discount
- Services
- Status

Sinf shartnomaga bog‘langan bo‘lishi mumkin. Yangi o‘quv yilida yangi shartnoma yaratiladi.

## PaymentPlan

Shartnoma oylar bo‘yicha rejalashtiriladi.

Har bir oy:

- Base amount.
- Discount.
- Services.
- Total.
- Paid.
- Remaining.
- Status.

## Payment

- Contract.
- Payment type.
- Amount.
- Date.
- Receipt.
- Note.

PaymentAllocation orqali to‘lovlar eng eski qarzdan boshlab FIFO tartibida taqsimlanadi.

Ortiqcha to‘lov alohida balansda saqlanadi.

PDF chek chiqariladi.

## Payment methods

- CASH.
- BANK_TRANSFER.
- CLICK.
- TERMINAL.

Har bir to‘lov usuli uchun komissiya sozlamasi bo‘lishi mumkin.

Click integratsiyasi kelajakda yoqiladigan qilib ishlab chiqilsin.

## Cashbox

- Income.
- Expense.
- Transfer.
- Dividend.
- Balance.

Kassalar orasida pul o‘tkazish.

## Qarzdorlik

- Qarzdorlar ro‘yxati.
- Qarzdorlik miqdori.
- Joriy oygacha qarz.
- Collector employee.
- Eslatmalar.
- CollectionTask.
- Qo‘ng‘iroq izohi.

Qarzdorlik siyosati Face ID qurilmasiga bog‘lanishi mumkin, ammo default bloklash o‘chirilgan bo‘lsin.

Moliyaviy yozuvlarni o‘chirib yubormaslik kerak. Tuzatishlar audit bilan amalga oshsin.

---

# 16. KADRLAR VA XODIMLAR KPI

Employee profili:

- F.I.O.
- Tug‘ilgan sana.
- Gender.
- Telefon.
- Address.
- Education.
- Experience.
- Resume.
- Passport.
- INN.
- Bank account/card.
- Position.
- Employment status.
- Face ID.

Sezgir ma'lumotlar shifrlansin.

## Maosh

EmployeeContract / SalaryConvention.

- Base salary.
- Month.
- Payment type.
- Planned amount.
- Paid amount.
- Receipt.
- Apply to remaining months.

Konvensiya summasidan ortiq to‘lovga yo‘l qo‘yilmasin.

Xodim indeksidagi jarimalar maoshdan avtomatik ushlanmasin. Faqat tavsiya sifatida ko‘rsatilsin.

## Staff Index

Har oy xodim 100 balldan boshlaydi.

Violation:

- Name.
- Deducted points.
- EvidenceRequired.
- DirectorApprovalRequired.

Tasdiqlanmagan qoidabuzarlik ballga ta'sir qilmasin.

Zonalar admin tomonidan sozlanadi.

Dars kuzatuvi:

- Observation.
- Score percentage.
- Comment.
- Observer.

60% dan past natija bo‘lsa, qoidabuzarlik taklifi yaratish mumkin.

AI xulosa keyingi bosqichda qo‘shiladi.

---

# 17. KUTUBXONA VA INVENTAR

## Kutubxona

Book va BookCopy alohida yuritilsin.

- Kitob nomi.
- Muallif.
- ISBN.
- Category.
- Copies.
- Available copies.
- Issued copies.

Loan:

- Student.
- BookCopy.
- IssueDate.
- DueDate.
- ReturnDate.
- Status.

Kechikkan kitoblar uchun eslatma.

Excel import/export.

## Inventar

- Item.
- Category.
- Room.
- Quantity.
- Status.
- Responsible employee.
- Purchase date.

Excel import/export.

---

# 18. CRM VA QABUL

Qabul jarayonida Lead modeli ishlatiladi.

Ommaviy ariza formasi:

- Ism.
- Telefon.
- Qiziqayotgan sinf.
- Manba.
- Izoh.

Lead pipeline:

Yangi → Bog‘lanildi → Uchrashuv → Maktabga keldi → Taqdimot → Maslahat → Yutildi.

Yutildi holatida o‘quvchi va shartnoma yaratish jarayoni taklif qilinsin.

Referal tizimi:

- ReferredBy.
- Lead source.
- Conversion report.

Marketing:

- Instagram.
- Telegram.
- Facebook.
- TikTok.
- Google.
- Advertising expense.
- Lead cost.
- Conversion rate.

Vakansiyalar va Candidate pipeline:

Yangi ariza → Ko‘rib chiqilmoqda → Intervyu → Taklif → Qabul.

Nomzodlarga ham test berish imkoniyati bo‘lsin.

Meta Pixel kabi integratsiyalar konfiguratsiya orqali yoqiladi.

---

# 19. KOMMUNIKATSIYA VA TELEGRAM

Notification service markazlashgan bo‘lsin.

Kanallar:

- Telegram.
- SMS.
- In-app notification.
- Email (kelajakda).

Telegram bot:

- Vasiy kabineti.
- Davomat.
- Kechikish.
- Test natijasi.
- Kunlik natija.
- Coin.
- To‘lov.
- Qarzdorlik.
- E'lonlar.
- Murojaatlar.

Ommaviy xabar:

- O‘quv yili.
- Sinf.
- Guruh.
- Kanal.
- Preview.
- Tasdiqlash.
- Yuborish tarixi.

SMS zaxira kanal sifatida ishlashi mumkin.

Xabarlar queue orqali yuborilsin.

Bir xil event uchun takror xabar yuborilmasin.

---

# 20. DASHBOARD VA HISOBOTLAR

Dashboard rolga qarab farq qiladi.

## SCHOOL_ADMIN / DIRECTOR

- Jami o‘quvchilar.
- Faol o‘quvchilar.
- Xodimlar.
- Bugungi davomat.
- Kechikkanlar.
- Davomat foizi.
- To‘langan summa.
- Qarzdorlik.
- Oylik reja.
- Coin statistikasi.
- Test natijalari.
- Fanlar kesimida natijalar.
- Sinflar kesimida natijalar.
- Xodimlar KPI.
- Grafiklar.

## TEACHER

- Biriktirilgan sinflar.
- Fanlar.
- Bugungi darslar.
- Baholanmagan o‘quvchilar.
- Testlar.
- Natijalar.
- Coin berish.
- Jadval.

## STUDENT

- Mening fanlarim.
- Bugungi jadval.
- Davomat.
- Kunlik ballar.
- Fanlar kesimidagi natijalar.
- Choraklik/yarm yillik natijalar.
- Testlar.
- Coin balansi.
- Coin tarixi.
- Kutubxona.
- Bildirishnomalar.

## GUARDIAN

- Farzand profili.
- Bugungi kelish/ketish.
- Davomat tarixi.
- Test natijalari.
- Kunlik va davriy ballar.
- Coin.
- To‘lovlar.
- Qarzdorlik.
- Bildirishnomalar.

## ACCOUNTANT

- To‘lovlar.
- Qarzdorlar.
- Kassalar.
- Kirim/chiqim.
- Maoshlar.
- Hisobotlar.

## Hisobotlar

Excel va PDF eksport.

Davr, sinf, fan, o‘qituvchi va o‘quvchi kesimida filtrlar.

20 ga yaqin asosiy hisobotni bosqichma-bosqich qo‘shish uchun arxitektura tayyor bo‘lsin.

---

# 21. AI YORDAMCHI

AI modulini alohida service sifatida loyihala.

Kelajakdagi imkoniyatlar:

- Maktab statistikasi bo‘yicha savol-javob.
- O‘quvchilar natijalari tahlili.
- Fanlar kesimida muammolarni aniqlash.
- Xodimlar KPI tahlili.
- Marketing tahlili.
- Call-center skript tahlili.
- Hisobot xulosalari.

AI faqat foydalanuvchining ruxsatiga ega ma'lumotlarni ko‘ra olishi kerak.

AI bergan natija rasmiy baho, moliyaviy amal yoki intizomiy qarorni avtomatik tasdiqlamasin.

---

# 22. AUDIT VA XAVFSIZLIK

AuditLog barcha muhim amallarni yozsin.

- Kim amalga oshirdi?
- Qachon?
- Qaysi modul?
- Qaysi obyekt?
- Oldingi qiymat.
- Yangi qiymat.
- IP / metadata.
- Amal sababi.

Ayniqsa:

- Ball o‘zgartirish.
- Test natijasini qayta hisoblash.
- Davriy natijani tasdiqlash.
- Davomatni qo‘lda o‘zgartirish.
- Face ID ma'lumotini almashtirish.
- To‘lovni tuzatish.
- Coin transaction.
- Foydalanuvchi permission o‘zgarishi.

Xavfsizlik:

- Input validation.
- SQL injection himoyasi.
- XSS himoyasi.
- CSRF himoyasi.
- Rate limiting.
- Secure headers.
- Strict CSP.
- File upload validation.
- MIME type tekshirish.
- Fayl hajmi cheklovi.
- Secrets encryption.
- Token rotation.
- Webhook signature/key validation.
- Sensitive data masking.
- Authorization backendda.
- Backup va restore.

`dangerouslySetInnerHTML` faqat zarur holatda va sanitization bilan ishlatilsin.

Loglarda token, parol, webhook kaliti va shaxsiy ma'lumotlar chiqmasin.

---

# 23. API ARXITEKTURASI

REST API versiyalangan bo‘lsin.

Base path:

`/api/v1`

Asosiy modullar:

- `/auth`
- `/users`
- `/roles`
- `/permissions`
- `/students`
- `/guardians`
- `/employees`
- `/academic-years`
- `/academic-periods`
- `/grades`
- `/subjects`
- `/teacher-assignments`
- `/timetable`
- `/lesson-sessions`
- `/attendance`
- `/devices`
- `/face-sync`
- `/assessments`
- `/scores`
- `/gradebook`
- `/tests`
- `/question-bank`
- `/test-attempts`
- `/coins`
- `/coin-shop`
- `/contracts`
- `/payments`
- `/finance`
- `/collections`
- `/salaries`
- `/staff-index`
- `/library`
- `/inventory`
- `/crm`
- `/notifications`
- `/reports`
- `/settings`
- `/audit-logs`

Har bir modul:

- Controller.
- Service.
- Validation schema.
- DTO.
- Repository kerak bo‘lsa.
- Tests.

Business logic controller ichida yozilmasin.

API xatolari yagona formatda qaytarilsin.

Swagger/OpenAPI hujjatlari bo‘lsin.

---

# 24. TESTING VA SIFAT NAZORATI

Quyidagi testlar bo‘lishi shart:

- Unit tests.
- Integration tests.
- API tests.
- E2E tests.
- Authorization tests.
- Tenant isolation tests.
- Assessment calculation tests.
- Coin limit tests.
- Payment allocation tests.
- Face ID event idempotency tests.
- TestAttempt security tests.

Ayniqsa baholash hisob-kitoblarini ko‘plab edge case'lar bilan tekshir.

Misollar:

1. 5 dars × 10 ball = 50 maksimal.
2. 45/50 = 90%.
3. Fanlar alohida rejimida umumiy natija chiqmasligi.
4. Umumiy rejimda fanlar natijasi to‘g‘ri qo‘shilishi.
5. 50 test + 50 daily = 100.
6. Test vaznlari 50 limitdan oshmasligi.
7. Baholanmagan dars avtomatik nol bo‘lmasligi.
8. Bekor qilingan dars maksimal balldan chiqarilishi.
9. Chorak vaznlari to‘g‘ri hisoblanishi.
10. Oldingi chorak snapshot'i yangi sozlamalar sabab o‘zgarmasligi.

Har bir muhim biznes qoidasiga test yoz.

---

# 25. AMALGA OSHIRISH BOSQICHLARI

Barcha modullarni birdaniga ishlab chiqishga urinma.

Quyidagi tartibda ishlashni taklif qilaman.

## M0 — Repository audit va arxitektura

- Mavjud kodni tekshirish.
- EdEx Test tahlili.
- Prisma schema audit.
- Arxitektura.
- DB diagram.
- API plan.
- UI structure.
- Roadmap.

Natija: tasdiqlashga tayyor texnik reja.

## M1 — Core platform

- Auth.
- RBAC.
- Tenant foundation.
- School settings.
- Branding.
- AcademicYear.
- Grade.
- Subject.
- User.
- Student.
- Guardian.
- Employee.
- Dashboard skeleton.

## M2 — Dars jadvali va o‘quv jarayoni

- Shift.
- Timetable.
- TIME_SLOTS.
- LessonSession.
- TeacherAssignment.
- Manual timetable.
- Solver architecture.
- Excel/PDF export.

## M3 — Baholash engine

- DailyScore.
- Criteria.
- Score limits.
- Subject-specific scores.
- General daily score.
- AssessmentPolicy.
- AssessmentComponent.
- AcademicPeriod.
- Quarter / Semester.
- PeriodScore.
- Weight calculations.
- Snapshots.
- Audit.

## M4 — EdEx Test integration

- Online tests.
- Offline tests.
- Question bank.
- TestAttempt.
- Autosave.
- Anti-cheat.
- Test results.
- Weighted tests.
- Assessment integration.

## M5 — Coin

- Criteria.
- Limits.
- Transactions.
- Teacher activity.
- Coin Shop.
- Purchases.
- Automatic attendance/test rewards.

## M6 — Face ID

- Hikvision integration.
- Devices.
- Separate IN/OUT cameras.
- Webhook.
- FaceSyncJob.
- Bridge.
- AttendanceRecord.
- Monitoring.
- Face Check.

Avval bitta haqiqiy Hikvision qurilmasida MVP sinovini o‘tkaz. 20 nafar o‘quvchi bilan bir hafta davomida xatosiz ishlashini tekshirmasdan kengaytirma.

## M7 — Guardian va notifications

- Guardian portal.
- Telegram.
- Attendance alerts.
- Test alerts.
- Score alerts.
- Payment alerts.
- SMS fallback.

## M8 — Finance

- Contracts.
- Payment plans.
- Payments.
- FIFO.
- Cashbox.
- Expenses.
- Collections.
- Debt reports.

## M9 — HR

- Employee management.
- Salary.
- Staff index.
- Violation.
- Lesson observation.
- KPI.

## M10 — CRM, library, inventory

- Leads.
- Marketing.
- Vacancies.
- Library.
- Inventory.
- Appeals.
- Surveys.
- Tasks.

## M11 — Analytics va AI

- Dashboard.
- Excel reports.
- PDF reports.
- AI assistant.
- Marketing insights.
- KPI insights.

## M12 — Production hardening

- Security audit.
- Load testing.
- Backup/restore.
- Monitoring.
- Logging.
- CI/CD.
- Deployment.
- Documentation.

Har bir bosqichda ishlaydigan natija bo‘lsin.

---

# 26. CLAUDE CODE UCHUN ISH QOIDALARI

1. Har bir bosqichni boshlashdan oldin reja tuz.
2. Katta o‘zgarishlardan oldin mavjud kodni o‘rgan.
3. TypeScript strict mode'dan foydalan.
4. `any` ishlatishni imkon qadar chekla.
5. Kodni modul va domain bo‘yicha tashkil qil.
6. Business logic'ni frontendga joylashtirma.
7. Hisob-kitoblarni backendda amalga oshir.
8. Moliyaviy va baholash operatsiyalarida database transaction ishlat.
9. Takror so‘rovlar uchun idempotency mexanizmini yarat.
10. Audit yozuvlarini muhim operatsiyalar bilan bir transaction ichida saqla.
11. Background job'larda retry va failed state bo‘lsin.
12. Barcha muhim endpointlarga authorization qo‘sh.
13. API va UI bir-biriga mos bo‘lsin.
14. Loading, error, empty va success holatlarini yarat.
15. Testlarsiz modulni tugallangan deb hisoblama.
16. Mavjud funksiyalarni regressiya testlari bilan himoya qil.
17. Environment variable'larni `.env.example`da hujjatlashtir.
18. Maxfiy ma'lumotlarni repository'ga kiritma.
19. Har bosqich oxirida bajarilgan ishlar, test natijalari va qolgan muammolarni hisobot qil.
20. Keyingi bosqichga o'tishdan oldin jiddiy xatolarni tuzat.

## Yakuniy talab

Idrok System quyidagi xususiyatlarga ega bo‘lishi kerak:

- Bir maktabda to‘liq ishlaydi.
- Keyinchalik boshqa maktabga moslashtiriladi.
- Maktab nomi, logo va ranglari konfiguratsiya orqali o‘zgaradi.
- Dars jadvali va vaqt oralig‘i rejimlarini qo‘llab-quvvatlaydi.
- Fanlar bo‘yicha va umumiy baholashni ixtiyoriy boshqaradi.
- Kunlik, haftalik, oylik, choraklik va yarim yillik hisob-kitoblarni bajaradi.
- Test va kundalik ballarni birlashtirish yoki alohida yuritish imkonini beradi.
- Online, offline, practice va weighted testlarni qo‘llab-quvvatlaydi.
- Face ID davomatini Hikvision qurilmalari orqali yuritadi.
- Coin, moliya, HR, CRM, kutubxona va boshqa modullarni birlashtiradi.
- Xavfsiz, audit qilinadigan va kengaytiriladigan bo‘ladi.

**Birinchi vazifang — mavjud repository va berilgan hujjatlarni chuqur tahlil qilish. Darhol kod yozishni boshlama. Avval M0 audit natijasi, arxitektura, database modeli va amalga oshirish rejasini tayyorla.**

Keyingi implementatsiya bosqichlarida yuqoridagi talablarni asos qilib ol. Biror muhim talabni o‘zboshimchalik bilan olib tashlama yoki soddalashtirma.