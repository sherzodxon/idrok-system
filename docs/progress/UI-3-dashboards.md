# Audit 3-bosqich — rollar bo'yicha bosh sahifalar

Sana: 2026-11-05. Asos: audit maketlari (https://claude.ai/artifact/NvVRtFeT8jZLW7pgvS4Rb6) va 2-bosqich komponentlari.
DB sxemasi o'zgarmadi (migratsiya yo'q). Barcha hisob-kitob backendda, web faqat ko'rsatadi.

## Backend

| Endpoint | Ruxsat | Nima beradi |
|---|---|---|
| `GET /attendance/summary?days=1..31` (yangi) | `attendance.view` (sinf rahbari — o'z sinfi) | Bugun: kutilganlar, holatlar soni, foiz, sinflar bo'yicha. Trend: oxirgi N kun, faqat terminal ma'lumoti bor maktab kunlari |
| `GET /me/lessons/day` (yangi) | `lessons.view` | O'qituvchining bugungi darslari + har birida ball olgan o'quvchilar soni (bekor qilingan ball sanalmaydi), davomat belgilanganmi, dars boshlanganmi; oxirgi 7 kunda tugagan, lekin hech kimga ball qo'yilmagan darslar soni |
| `GET /me/timetable` | o'zgarmagan ruxsat | Javobga `today` (maktab sanasi) qo'shildi |

Davomat foizi (`domain/attendance.ts` `attendanceRate`): (keldi + kechikdi) / (keldi + kechikdi + kelmadi + hali kelmagan). Sababli va "ma'lumot yo'q" kunlar hisobga kirmaydi. Bir xona, HALF_UP, Decimal. Kun davomida "hozirgacha necha foiz keldi" ma'nosini beradi.

## Web

| Sahifa | Nima o'zgardi |
|---|---|
| `/dashboard` (maktab rollari) | KPI: bugun keldi %, kechikdi / kelmadi, 7 kunda ball qo'yilmagan darslar (o'qituvchilar soni bilan), 7 kunlik coin va do'kondagi buyurtmalar. 14 kunlik davomat trendi, ball qo'ymagan o'qituvchilar ro'yxati, sinflar bo'yicha bugungi davomat. Har vidjet faqat o'z ruxsati bilan |
| `/dashboard` (o'qituvchi) | Bugungi darslar, ball qo'yilgan / boshlangan darslar, 7 kunda ball qo'yilmaganlar; sinf rahbariga o'z sinfining bugungi davomati. "Bugungi darslarim" kartasida har darsda "Ball: N" / "Ball yo'q" belgisi |
| `/home` (o'quvchi) | Coin balansi va chorak natijasi plitkalari, bugungi darslar, ochiq va yaqin testlar (oldingi bo'sh holat o'rniga). Vasiy ko'rinishi o'zgarmadi |

Har vidjetda yuklanish (skeleton), bo'sh va xato holatlari bor. Telefonda KPI plitkalari 2 ustunda.

Lokal stek (`e2e/local/dev-stack.ts`): birinchi demo o'quvchi ham lokal parolni oladi, shunda o'quvchi ko'rinishini sinab ko'rish mumkin (faqat soxta demo ma'lumot).

## Acceptance

| Mezon | Holat |
|---|---|
| Raqamlar backendda hisoblanadi, `schoolDate` bo'yicha | ✅ |
| Ruxsat va scope: sinf rahbari faqat o'z sinfini ko'radi, fan o'qituvchisi va vasiy uchun 403 | ✅ API test |
| Terminal ma'lumoti yo'q kun trendga 0% bo'lib tushmaydi | ✅ API test |
| Bekor qilingan ball "ball qo'yilgan" deb sanalmaydi | ✅ API test (dars boshlangan bo'lsa; aks holda o'tgan dars bilan tekshiriladi) |
| Loading / empty / error holatlari | ✅ |
| 375 px'da gorizontal scroll yo'q (admin, o'qituvchi, o'quvchi) | ✅ e2e `dashboards.spec.ts` |
| Ko'zdan: admin (kompyuter), o'qituvchi (kompyuter, telefon), o'quvchi (telefon) | ✅ |
| Face ID qurilma holati paneli bosh sahifada | ❌ 5-bosqichda (qurilmalar sahifasi bilan) |

## Tekshiruvlar

`pnpm lint`, `pnpm typecheck`, `pnpm build` — o'tdi. Testlar: api 415, db 44, shared 36, config 12, web 27, hikvision 9, bridge 5; e2e 40 — hammasi o'tdi.

## Qolgan muammolar

- `/attendance/summary` har kun uchun alohida hisoblaydi (14 kun — taxminan 14 × 4 so'rov). Qisqa oraliq uchun yetarli; 6-bosqichda (DB unumdorligi) bitta agregat so'rovga o'tkaziladi.
- Demo ma'lumotda bir xil ismli o'qituvchilar bor — "Ball qo'ymaganlar" ro'yxatida takror ko'rinadi (ma'lumot xususiyati, kod emas).
- `uz-UZ` raqam formati brauzerda nuqta bilan chiqadi (`94.2%`), ilovaning boshqa joylari bilan bir xil.
