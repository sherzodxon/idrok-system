# Audit 2-bosqich — dizayn tizimi

Sana: 2026-11-05. Asos: 1-bosqich auditi (https://claude.ai/artifact/NvVRtFeT8jZLW7pgvS4Rb6), egasi Q1–Q5 tavsiyalarini qabul qildi (`open-questions.md` T-74…T-78).
DB sxemasi va API o'zgarmadi.

## Nima qilindi

| Ish | Joy |
|---|---|
| Q1–Q5 qarorlari yozildi | `docs/architecture/open-questions.md` T-74…T-78 |
| Yon menyu guruhlarga bo'lindi: maktab 7 guruh, o'qituvchi 4 guruh; yig'ilgan menyuda guruhlar chiziq bilan ajraladi | `shell/nav-config.ts` (`group`, `groupNav`), `shell/app-shell.tsx`, `nav.groups.*` |
| O'qituvchi menyusi tartibi: Bugun → Dars → Tayyorgarlik → Odamlar | `nav-config.ts` |
| Grafik komponentlari (kutubxonasiz SVG, faqat tokenlar): `TrendChart`, `BarList`, `AttendanceHeatmap`, `LimitMeter` | `components/ui/charts.tsx` |
| Sof shkala funksiyalari (grid, yo'qolgan kunlarda chiziq uziladi, chegaralangan foiz) | `lib/chart-scale.ts` |
| `StatCard`ga `delta` (o'zgarish va uning ohangi) | `components/ui/stats.tsx` |
| Komponentlar namunasi sahifasi, faqat dev rejimida (production'da 404) | `/dev/ui-kit`, `views/ui-kit.tsx` |
| Tarjimalar: `charts.*`, `uiKit.*`, `nav.groups.*` (uz, ru) | `messages/*.json` |

Mavjud va qayta ishlatiladi: `Button`, `Select`, `Modal`/`ConfirmDialog`, `Drawer`, `Tabs`, `Toolbar`, `DataTable`, `Badge`, `EmptyState`/`ErrorState`/`LoadingState`/`QueryBoundary`, `KpiHeroCard`, `ProgressRing`, `Skeleton`, portalning pastki panel menyusi.

## Acceptance

| Mezon | Holat |
|---|---|
| Menyu guruhlari tarjima qilingan, ruxsat bo'yicha filtrlash avvalgidek | ✅ unit (`shell.test.ts`), e2e |
| Grafiklar ikkala mavzuda tokenlar bilan, qo'lda rang yo'q | ✅ ko'zdan (light, dark) |
| 375 px'da gorizontal scroll yo'q | ✅ `scrollWidth = 375` (`TrendChart` tuzatildi) |
| Yig'ilgan menyu va telefon drawer'i | ✅ ko'zdan |
| Shkala funksiyalari testlangan | ✅ `chart-scale.test.ts` |
| Bildirishnoma qo'ng'irog'i, global qidiruv | ❌ backend kerak (bildirishnoma va qidiruv API'si yo'q) — 3/6-bosqichda, soxta UI qo'yilmadi |

## Tekshiruvlar

`pnpm lint`, `pnpm typecheck`, `pnpm build` — o'tdi. Testlar: api 412, db 44, shared 36, config 12, web 27, hikvision 9, bridge 5; e2e 37 — hammasi o'tdi.

## Keyingi qadam (3-bosqich)

Admin, o'qituvchi va o'quvchi bosh sahifalari shu komponentlar bilan; ular uchun agregat endpointlar (hisob backendda, `schoolDate` bo'yicha).
