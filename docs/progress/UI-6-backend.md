# Audit 6-bosqich — hisobotlar, unumdorlik, xato ogohlantirishlari, zaxira

Sana: 2026-11-09. DB sxemasi o'zgarmadi (migratsiya yo'q).

## Nima qilindi

| Ish | Joy |
|---|---|
| Hisobotlar markazi: 4 ta Excel (uz/ru) — davomat (jami + kunma-kun, ≤ 92 kun, sinf rahbari faqat o'z sinfi), xodimlar davomati (≤ 92 kun), ballar va coin daftari (≤ 366 kun, bekor qilishlar alohida qator). Har eksport `AuditLog`da (`report.export`) | `modules/reports/*`, `labels.*.ts` |
| Web: `/admin/reports` (oraliq, sinf, ruxsatga qarab kartalar), menyuda "Hisobotlar" (bir nechta ruxsatdan biri bilan — `anyOf`) | `components/reports/reports-page.tsx`, `nav-config.ts` |
| Unumdorlik: "kim kutiladi" endi oraliq uchun 3 ta so'rov bilan (`studentDaysRange`) — o'quvchi tarixi, bosh sahifa trendi va hisobot har kun uchun alohida so'rov qilmaydi | `attendance/school-day.ts`, `attendance.service.ts` |
| Xato ogohlantirishlari: `ALERT_WEBHOOK_URL` (ixtiyoriy) — API 500, tenant buzilishi, worker job xatosi, coin daftari nomuvofiqligi qisqa JSON bilan yuboriladi (tur, bir qator xato, request id, niqoblangan yo'l; ma'lumot, query string, token yo'q), 5 daqiqada bir xil xabar bir marta. Yangi kutubxona qo'shilmadi | `infra/alerts.ts`, `http/errors.ts`, `worker/index.ts`, `.env.example` |
| Zaxira: shifrlangan `pg_dump` (+ fayllar) skripti, tiklash skripti (production'ga himoya bilan), tekshiruv SQL, runbook | `scripts/backup/*`, `docs/ops/backup-restore.md` |
| Tuzatish: CORS `Content-Disposition`ni ochadi — yuklangan fayllar server bergan nom bilan saqlanadi (oldin "download" bo'lib qolardi, test natijalari eksportida ham) | `app.ts` |

## Acceptance

| Mezon | Holat |
|---|---|
| Davomat hisoboti kunlik sahifa bilan bir xil; ma'lumotsiz kun "kelmadi" emas; jami va foiz | ✅ API test (Excel o'qiladi) |
| Scope: sinf rahbari — o'z sinfi, fan o'qituvchisi — 403; xodimlar / coin / ballar — o'z ruxsatlari | ✅ API test |
| Uzoq yoki teskari oraliq — 400; ruscha fayl | ✅ API test |
| Eksport audit qilinadi | ✅ API test |
| Hisobotlar sahifasi, yuklab olish fayl nomi, 375 px | ✅ e2e `reports.spec.ts` |
| Oraliq so'rovlari bilan davomat natijalari o'zgarmadi | ✅ mavjud davomat testlari |
| Ogohlantirish: niqoblash, takrorni bostirish, qabul qiluvchi ishlamasa ham xato yo'q, 500 → bitta ogohlantirish, 404 → yo'q | ✅ unit + API test |
| `verify.sql` joriy sxemada ishlaydi | ✅ db test |
| Zaxira / tiklash skriptlari oxirigacha | ❌ lokal muhitda `pg_dump`, `pg_restore`, `age` yo'q — faqat `bash -n`. Birinchi sinov VPS'dagi tiklash mashqida |
| Face Check va kunlik ro'yxatning DB darajasida sahifalanishi | ❌ holatlar o'qishda hisoblanadi; 300 o'quvchida tez, katta maktab uchun keyingi ish |

## Tekshiruvlar

`pnpm lint`, `pnpm typecheck`, `pnpm build` — o'tdi. Testlar: api 450, db 45, shared 36, config 12, web 27, hikvision 9, bridge 5; e2e 44 — hammasi o'tdi.

Bir marta: `staff-faceid` testi to'liq to'plamda yiqildi — test boshqa tenant'ning hodisasini topib olgan edi (ikki test faylida bir xil `E-T001`). So'rov tenant bilan cheklandi; kod xatosi emas.

## Ochiq

- Ogohlantirish kanali: qaysi xizmat (Telegram bot, Slack, Sentry relay) — egasi tanlaydi; kod har qanday JSON webhook bilan ishlaydi.
