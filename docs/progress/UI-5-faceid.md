# Audit 5-bosqich — Face ID: vasiy roziligi, xodimlar, qurilma holati

Sana: 2026-11-11. Qarorlar: `open-questions.md` T-75, T-76, T-81…T-84; ochiq savollar Q-54, Q-55.

## Nima qilindi

| Ish | Joy |
|---|---|
| Migratsiya `20261110090000_face_consent`: `FaceConsent` (bitta amaldagi rozilik, bekor qilish sabab bilan), `AttendanceSettings.faceConsentRequired` | `packages/db` |
| Migratsiya `20261111090000_face_staff`: `FaceProfile`/`FaceSyncJob` o'quvchi yoki xodim (check), `AccessEvent.employeeId`, xodim ish kuni sozlamalari. Faqat qo'shimcha, mavjud qatorlar o'zgarmadi | `packages/db` |
| Rozilik: qayd etish, tarix, bekor qilish (yuz shu transaction'da o'chadi), yuklashda tekshiruv lock ostida | `face.service.ts`, `face.routes.ts` |
| Yuz rasmini ko'rish audit qilinadi | `face.routes.ts` |
| Yuz servisi o'quvchi va xodim uchun umumiy (`FaceSubject`); xodim: `E-<kod>`, telefon va kod majburiy | `face.service.ts`, `bridge.service.ts` |
| Ingest: `E-<kod>` xodimga bog'lanadi, "mos kelmagan" deb sanalmaydi | `ingest.ts`, `domain/attendance.ts` |
| Xodimlar davomati: `GET /attendance/staff/day` | `staff-attendance.service.ts` |
| Web: Face Check'da "O'quvchilar / Xodimlar", yuz oynasida rozilik bo'limi va xodim kartasi ogohlantirishi; Davomat → "Xodimlar"; sozlamalarda rozilik majburiyligi va xodim ish kuni; hodisalarda xodim ismi | `components/attendance/*` |
| Bosh sahifa: Face ID terminallari kartasi (oflayn terminallar birinchi, ogohlantirish bilan) | `views/dashboard.tsx` |

## Acceptance

| Mezon | Holat |
|---|---|
| Roziliksiz o'quvchi yuzi saqlanmaydi (sozlama o'chirilsa — saqlanadi) | ✅ API test |
| Vasiy faqat bog'langan bo'lsa; sana kelajakda emas; ikkinchi amaldagi rozilik — 409; o'qituvchi — 403 | ✅ API test |
| Bekor qilish: sabab majburiy, yuz o'chadi, tarix qoladi, keyin yuklash rad etiladi | ✅ API test |
| Bekor qilish va yuklash bir vaqtda — roziliksiz yuz qolmaydi | ✅ API test |
| Yuz rasmini ko'rish audit qilinadi | ✅ API test |
| Xodim yuzi: kod va telefon majburiy, terminalga `E-<kod>` | ✅ API test |
| Xodim o'tishi xodimga bog'lanadi; kechikish / erta ketish xodim ish kuni bo'yicha; ma'lumotsiz kun ≠ kelmadi | ✅ API test |
| Xodimlar kunini faqat `employees.view` ko'radi | ✅ API test |
| Xodimlarning dam olish kuni maktab kalendaridan; ta'til ish kuni; bayramda kelmaganlar kelmadi emas (T-86) | ✅ API test |
| Mavjud Face ID oqimi (bridge, to'g'ridan-to'g'ri qurilma, sinxron, o'chirish) | ✅ mavjud testlar (rozilik qo'shilgan holda) |
| UI: rozilik → yuz yuklash; xodimlar yorliqlari | ✅ e2e `attendance.spec.ts`, ko'zdan |
| Haqiqiy DS-K1T343MWX bilan pilot | ❌ qurilma yo'q (M6 #17 dan beri ochiq) |
| O'qituvchining "Mening davomatim" sahifasi | ❌ keyingi qadam |
| Avval roziliksiz yuklangan yuzlar: 30 kun, keyin tungi tozalashda o'chiriladi (T-85) | ✅ API test (muddat ichida qoladi, keyin o'chadi, rozilik borlari qoladi, qoida o'chiq — o'chmaydi), ko'zdan |

## Tekshiruvlar

`pnpm lint`, `pnpm typecheck`, `pnpm build` — o'tdi. Testlar (T-85, T-86 bilan): api 439, db 44, shared 36, config 12, web 27, hikvision 9, bridge 5; e2e 42 — hammasi o'tdi.

## Qolgan muammolar

- Smenali xodimlar uchun alohida ish jadvali yo'q: hamma xodim bitta ish kuni bo'yicha (T-86 — maktab kalendari).
- Xodimlar kuni o'qishda hisoblanadi va kichik ro'yxat uchun xotirada sahifalanadi (xodimlar soni ~50).
