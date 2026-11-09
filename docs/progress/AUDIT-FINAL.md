# Audit yakuniy hisoboti (1–8-bosqichlar)

Sana: 2026-11-09. Audit sahifasi: https://claude.ai/artifact/NvVRtFeT8jZLW7pgvS4Rb6 (har topilma holati bilan yangilangan).
Bosqich hisobotlari: `UI-2-design-system.md` … `UI-6-backend.md`. Qarorlar: `docs/architecture/open-questions.md` T-74…T-86.

## Bosqichlar

| # | Bosqich | Natija | Hisobot |
|---|---|---|---|
| 1 | Audit va dizayn rejasi | 16 topilma, 5 ziddiyat (Q1–Q5 — egasi tavsiyalarni qabul qildi), sahifalar inventari, maketlar | audit sahifasi |
| 2 | Dizayn tizimi | Guruhlangan menyu, SVG grafiklar (trend, ustunlar, davomat xaritasi, limit o'lchagich), KPI o'zgarishi, `/dev/ui-kit` | `UI-2-design-system.md` |
| 3 | Asosiy UI | Admin, o'qituvchi, o'quvchi bosh sahifalari; `/attendance/summary`, `/me/lessons/day` | `UI-3-dashboards.md` |
| 4 | Biznes mantiq | Mezon bo'yicha limit va bir baho chegarasi (T-77, T-79, T-80) | `UI-4-criterion-limits.md` |
| 5 | Face ID va davomat | Vasiy roziligi (T-75, T-81), eski yuzlar uchun 30 kun (T-85), xodimlar Face ID va davomati (T-76, T-83, T-84), dam olish kunlari kalendardan (T-86), terminal holati bosh sahifada | `UI-5-faceid.md` |
| 6 | Backend va DB | Hisobotlar markazi (4 Excel), oraliq so'rovlari, xato ogohlantirishlari, zaxira/tiklash runbook | `UI-6-backend.md` |
| 7 | Testlash | Yangi endpointlar uchun tenant izolyatsiyasi; 3 rol × ~36 sahifa 375 px'da yorug' va qorong'i mavzuda (gorizontal scroll, JS xatosi, sarlavha); bog'liqliklar auditi | shu hujjat |
| 8 | Yakuniy hisobot | Shu hujjat va yangilangan audit sahifasi | — |

## Topilmalar holati

| Daraja | Topilma | Holat |
|---|---|---|
| Critical | Zaxira va tiklash runbook'i yo'q | ✅ qisman: skriptlar, runbook, `verify.sql` testi. ❌ skriptlar haqiqiy `pg_dump`/`age` bilan sinalmagan (VPS'dagi birinchi tiklash mashqi) |
| Critical | Voyaga yetmaganlar yuzi uchun vasiy roziligi | ✅ T-75, T-81, T-85 |
| High | Xato monitoringi yo'q | ✅ provayderdan mustaqil webhook (`ALERT_WEBHOOK_URL`); kanal — egasi tanlaydi |
| High | Bosh sahifalar deyarli bo'sh | ✅ 3 rol |
| High | O'qituvchi Face ID va xodim davomati | ✅ T-76, T-83, T-84, T-86 |
| High | Hisobotlar va Excel eksport kam | ✅ hisobotlar markazi |
| High | Mezon bo'yicha limit, min/max | ✅ T-77, T-79. Mezon "turi" (jarima) — Q-53 ochiq |
| Medium | Xotirada sahifalash, har kunlik so'rov | ✅ qisman: oraliq so'rovlari (tarix, trend, hisobot). ❌ Face Check va kunlik ro'yxat hali xotirada sahifalanadi |
| Medium | Parol tiklash, bildirishnomalar, global qidiruv | ❌ keyingi bosqich (bildirishnoma va qidiruv API'si kerak; parol tiklash — M7 Telegram bilan) |
| Medium | 1000+ qatorli komponentlar | ❌ bo'linmagan (xatti-harakat o'zgarmasligi uchun alohida ish) |
| Medium | Admin menyusi guruhlanmagan | ✅ |
| Medium | Haqiqiy terminal pilot | ❌ qurilma yo'q |
| Medium | Staging smoke | ❌ egasi akkauntlari kerak |
| Low | Seed vaqtinchalik parolni konsolga chiqaradi | ❌ o'zgartirilmadi |
| Low | Offline test qoralamasi UI'da yo'q | ❌ |
| Low | Yuz rasmini ko'rish audit qilinmagan | ✅ T-82 |

## Tekshiruvlar (oxirgi to'liq yugurish)

| Tekshiruv | Natija |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | ✅ |
| API | ✅ 454 |
| db (migratsiyalar, drift, constraint'lar, `verify.sql`) | ✅ 45 |
| shared 36, config 12, web 27, hikvision 9, bridge 5 | ✅ |
| e2e (Playwright) | ✅ 47 (shu jumladan 3 ta telefon "aylanmasi", yorug' + qorong'i) |
| `pnpm audit --prod --audit-level high` | ✅ yuqori darajali yo'q. 3 ta o'rta, hammasi bilvosita: `uuid` (exceljs ichida; bizning kod bufer bermaydi), `glob` (e2e asbobi), `minimatch` (eslint) — production yo'lida ishlatilmaydi |

Yangi migratsiyalar (hammasi qo'shimcha, mavjud migratsiyalar tahrirlanmadi): `20261109090000_scores_criterion_limits`, `20261110090000_face_consent`, `20261111090000_face_staff`, `20261112090000_face_consent_grace`.

## Egasining qarori kutilayotganlar

- Q-53: ballda jarima mezoni (tavsiya: yo'q, jarima coin'da).
- Ogohlantirish kanali (Telegram bot / Slack / boshqa).
- Haqiqiy DS-K1T343MWX bilan pilot va staging smoke (akkauntlar va qurilma kerak).

## Keyingi ishlar (tavsiya tartibi)

1. VPS: zaxira cron, birinchi tiklash mashqi, ogohlantirish kanali — haqiqiy ma'lumotdan oldin.
2. Haqiqiy terminal pilot (1 hafta, 20 o'quvchi + xodimlar).
3. Bildirishnomalar va global qidiruv (API + UI), o'qituvchining "Mening davomatim".
4. Face Check va kunlik ro'yxatni DB darajasida sahifalash; katta komponentlarni bo'lish.
5. M7: vasiy portali va Telegram (parol tiklash shu yerda).
