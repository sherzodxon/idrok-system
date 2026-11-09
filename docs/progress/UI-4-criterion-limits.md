# Audit 4-bosqich — mezon bo'yicha limitlar va chegaralar (T-77)

Sana: 2026-11-09. Qarorlar: `open-questions.md` T-77, T-79, T-80; ochiq savol Q-53.

## Nima qilindi

| Ish | Joy |
|---|---|
| Migratsiya `20261109090000_scores_criterion_limits` — faqat qo'shimcha: `ScoreLimitScope.CRITERION`, `ScoreCriterion.minPoints/maxPoints` (Decimal, nullable, `ScoreCriterion_points_check`), `ScoreLimitRule.criterionId` (FK, indeks), scope check va "bitta faol qoida" indeksi yangi ustunni hisobga oladi | `packages/db/prisma` |
| Domen: `CRITERION` scope (mezonsiz baho kirmaydi), `criterionBoundsError` | `apps/api/src/domain/score-limits.ts` |
| Ball yozish: mezon chegarasi limitlardan oldin; limitlar mezon bo'yicha ham, o'quvchi lock'i ostida | `scores.service.ts` |
| Sozlamalar API: mezon chegaralari (yaratish, o'zgartirish, tozalash `null` bilan), `CRITERION` qoidasi (mezon shu maktabniki bo'lishi shart), saqlangan chegara bilan to'qnashuv → maydon xatosi | `score-config.service.ts`, `dto/scores.ts` |
| Admin UI (Baholash → Limitlar): mezon qo'shishda min/maks, "Chegaralar" oynasi, limit qoidasida "Mezon" turi va mezon tanlovi | `assessment-admin.tsx` |
| Jurnal: mezon tanlovida chegara ko'rinadi ("Faollik (1–4)"); xato matni chegarani aytadi | `scores-pages.tsx`, `use-error-text.ts` |
| Tarjimalar uz, ru | `messages/*.json` |

## Acceptance

| Mezon | Holat |
|---|---|
| Migratsiya qo'shimcha, eski qoidalar va mezonlar o'zgarmaydi; sxema va migratsiya o'rtasida farq yo'q | ✅ db testlari (drift, constraint ro'yxati) |
| Bir baho mezon chegarasidan chiqsa rad etiladi, mezonsiz baho ta'sirlanmaydi | ✅ API test |
| Mezonning o'z qoidasi va "hammasi (default)" har mezon uchun alohida | ✅ unit + API test |
| Bekor qilingan ball limitni bo'shatadi | ✅ unit + API test |
| Ikki so'rov bir vaqtda mezon limitidan o'ta olmaydi | ✅ API test (lock) |
| Bitta faol qoida (mezon + oyna), boshqa maktab / noma'lum mezon 404, o'qituvchi 403 | ✅ API test |
| Admin UI va jurnal xatosi | ✅ e2e `scores.spec.ts`, ko'zdan (dark) |
| Mezon "turi" (jarima) | ❌ Q-53 — egasining qarori kerak; hozircha qo'shilmadi |

## Tekshiruvlar

`pnpm lint`, `pnpm typecheck`, `pnpm build` — o'tdi. Testlar: api 423, db 44, shared 36, config 12, web 27, hikvision 9, bridge 5; e2e 41 — hammasi o'tdi.

## Qolgan muammolar

- Jurnaldagi "bugun qoldi" (`remainingToday`) mezonsiz hisoblanadi — mezon limitini ko'rsatmaydi (rad etilganda xato aniq qoldiqni aytadi).
- Limit qoidalari formasi tor ekranda ikki qatorga o'tadi (oldin ham shunday edi).
