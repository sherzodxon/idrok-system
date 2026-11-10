# Idrok System — foydalanuvchi sinovi (UAT) rejasi

Maqsad: haqiqiy server (VPS) sotib olishdan oldin tizimni Render + Supabase'dagi **staging**da har rol ko'zi bilan
to'liq sinab chiqish. Staging'da **faqat sun'iy (demo) ma'lumot** (Q-30): sinovchilar haqiqiy odamlar bo'lishi
mumkin, lekin tizimdagi o'quvchi, vasiy, telefon raqamlari soxta.

Natijalarni belgilash: har ssenariy uchun ✅ (o'tdi), ❌ (xato), ⏸ (bloklangan — oldingi qadam ishlamadi).
Interaktiv ro'yxat (sinovchilar birga belgilaydi, natijalar hammaga ko'rinadi): https://claude.ai/artifact/E1wS2UiE4dvXXxG9UNrXZ1 — egasi uni sinovchilarga Share menyusidan ulashadi.

## 0. Tayyorgarlik (egasi)

| # | Ish | Qanday | Tayyor |
|---|---|---|---|
| P-01 | Domen | Masalan `test.idrok.uz`: `app.test.idrok.uz` (sayt), `api.test.idrok.uz` (API). Usiz login ishlamaydi | ☐ |
| P-02 | GitHub | `main` push qilingan | ☐ |
| P-03 | Supabase loyihasi | eu-central-1, DB parol; `DATABASE_URL` (6543), `DIRECT_URL`, Storage bucket `idrok-files` | ☐ |
| P-04 | Render Blueprint | `render.yaml` → 4 servis; maxfiy qiymatlar `docs/DEPLOY.md` §2 bo'yicha | ☐ |
| P-05 | `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32`, parol menejerida saqlang | ☐ |
| P-06 | Domenlar ulandi | `idrok-web` → `app.`, `idrok-api` → `api.`; `CORS_ORIGINS`, `COOKIE_DOMAIN` | ☐ |
| P-07 | Seed | `seed.ts` (admin) va `seed-demo.ts` (300 o'quvchi, 40 o'qituvchi, 10 sinf) — DEPLOY §5 | ☐ |
| P-08 | Smoke | DEPLOY §6 jadvali — hammasi ✅ | ☐ |
| P-09 | Sinov akkauntlari | Admin: 2–3 o'qituvchi, 2 sinf rahbari, 5-sinfdan yuqori 5–10 o'quvchi, 3–5 vasiy uchun parolni tiklab, sinovchilarga beradi | ☐ |
| P-10 | Qurilmalar | Har sinovchida telefon (Android va iPhone ikkalasi), admin va o'qituvchi uchun kompyuter | ☐ |
| P-11 | Telegram (M7 tayyor bo'lgach) | BotFather'da bot, `TELEGRAM_BOT_TOKEN`, webhook `api.` domeniga | ☐ |

**Xato topilsa** — skrinshot, vaqt, qaysi akkaunt, qaysi qadam. Xato xabarida "So'rov raqami" bo'lsa, uni yozing:
u bilan server jurnalidan aniq so'rov topiladi.

## 1. Admin (maktab ma'muriyati)

| # | Ssenariy | Kutilgan natija |
|---|---|---|
| A-01 | `admin` vaqtinchalik parol bilan kirish | Parolni almashtirish sahifasi, keyin bosh sahifa |
| A-02 | Bosh sahifa | KPI plitkalari, 14 kunlik davomat grafigi, ball qo'ymagan o'qituvchilar, sinflar bo'yicha davomat, terminallar kartasi |
| A-03 | Sozlamalar → Brending: rang va maktab nomi | Butun interfeys rangi o'zgaradi; yorug'/qorong'i mavzu ishlaydi |
| A-04 | Sozlamalar → Foydalanuvchilar → "Yangi foydalanuvchi" (yangi xodim) | Login va vaqtinchalik parol **bir marta** ko'rsatiladi; yangi xodim kira oladi va parolni almashtiradi |
| A-05 | Foydalanuvchi sahifasi: loginni o'zgartirish, "hamma qurilmadan chiqarish" | Eski login bilan kirib bo'lmaydi; foydalanuvchi qayta kirishi kerak |
| A-06 | O'quvchilar: qidirish, sinf filtri, kartani ochish | Kartada ballar trendi, davomat, coin |
| A-07 | Import → O'quvchilar shabloni → 3 qator → yuklash | Oldindan ko'rish → saqlash → yangi o'quvchilar ro'yxatda; loginlar fayli bir marta yuklanadi |
| A-08 | Import: noto'g'ri faylda xato (bo'sh ism, noto'g'ri sinf) | Qaysi qator va maydon xatoligi aniq yoziladi, hech narsa saqlanmaydi |
| A-09 | Kalendar: bayram kuni qo'shish | O'sha kunda darslar va davomat "dam olish" bo'ladi |
| A-10 | Dars jadvali: bir slotga ikki o'qituvchi qo'yish | To'qnashuv ko'rsatiladi, e'lon qilib bo'lmaydi |
| A-11 | Darslar: darsni bekor qilish (sabab bilan) | O'qituvchi va vasiy jadvalida "bekor qilindi" |
| A-12 | Baholash → Limitlar: mezon qo'shish (min 1, maks 4) va kunlik limit | Mezon "Bir baho: 1–4"; qoida ro'yxatda |
| A-13 | Baholash → Siyosat: yangi versiya, komponentlar yig'indisi | Yig'indi 100 bo'lmasa e'lon qilib bo'lmaydi |
| A-14 | Baholash → "Kim ball qo'ymagan" | O'tgan darslarga ball qo'ymagan o'qituvchilar ro'yxati |
| A-15 | Coin: mezon, limit, admin tuzatishi (sabab bilan) | Balans o'zgaradi; tuzatish tarixda qoladi, o'chirilmaydi |
| A-16 | Coin do'koni: mahsulot qo'shish, buyurtmani tasdiqlash/rad etish | Rad etilsa coin qaytadi |
| A-17 | Davomat → Jurnal: o'quvchiga qo'lda "sababli" belgisi | Belgi qo'yiladi, sabab yoziladi; tozalash qurilma holatini qaytaradi |
| A-18 | Davomat → Face Check: rozilik qayd etish, keyin rasm yuklash | Roziliksiz yuklab bo'lmaydi; rozilikdan keyin yuklanadi |
| A-19 | Rozilikni bekor qilish (sabab bilan) | Yuz rasmi o'chadi; rozilik tarixda qoladi |
| A-20 | Davomat → Xodimlar | Ish kuni ko'rsatiladi; bayram kunida "dam olish kuni" |
| A-21 | Hisobotlar: davomat, ballar, coin, xodimlar — Excel | Fayllar ochiladi, raqamlar sahifadagi bilan bir xil; 92/366 kundan uzun oraliq rad etiladi |
| A-22 | Davrni yopish (chorak) | Natijalar muzlatiladi; keyin sozlama o'zgarsa ham yopilgan natija o'zgarmaydi |
| A-23 | Telefonda (375 px) asosiy sahifalar | Gorizontal aylantirish yo'q, menyu ochiladi |

## 2. O'qituvchi

| # | Ssenariy | Kutilgan natija |
|---|---|---|
| T-01 | Birinchi kirish (admin bergan parol) | Parolni almashtirish, keyin bosh sahifa: bugungi darslar, "Ball qo'yilgan darslar", "Ball qo'yilmagan (7 kun)" |
| T-02 | Menyu | Faqat o'qituvchi bo'limlari; Sozlamalar yo'q |
| T-03 | Jurnal → guruh va fan → dars | Faqat o'z guruhlari; o'quvchilar ro'yxati |
| T-04 | Davomat belgilash ("Keldi", "Kelmadi") | Belgilar saqlanadi |
| T-05 | Ball qo'yish (tugma bilan) | "Darsda" yig'indisi o'sadi; bosh sahifada dars "Ball: N" |
| T-06 | Mezon tanlab ball qo'yish (chegaradan yuqori) | "Bu mezon bo'yicha bir baho ko'pi bilan … ball" xabari, ball qo'yilmaydi |
| T-07 | Kunlik limitdan oshirish | Qancha qolgani aytilgan xabar; ball qo'yilmaydi |
| T-08 | Kelmagan o'quvchiga ball | Rad etiladi (sozlama o'chiq bo'lsa) |
| T-09 | Ballni bekor qilish | Yig'indi kamayadi; bekor qilish tarixda ko'rinadi |
| T-10 | Jurnal jadvali: raqam yozib Enter (tez kiritish), o'q tugmalari | Katak yangilanadi; o'qlar kataklar orasida yuradi |
| T-11 | Tez-tez ikki marta bosish (sekin internet) | Ball ikki marta yozilmaydi |
| T-12 | Savollar banki: savol yaratish (bitta va ko'p javobli, rasm bilan) | Savol saqlanadi, ro'yxatda |
| T-13 | Savollarni Excel'dan import | Oldindan ko'rish, xatolar qator bo'yicha |
| T-14 | Test tuzish: fan, sinf, savollar, vaqt, oyna (boshlanish–tugash) | Qoralama; muammolar bo'lsa e'lon qilib bo'lmaydi |
| T-15 | Testni e'lon qilish va guruhga berish | O'quvchilarda test "Hali boshlanmagan" yoki "Ochiq" |
| T-16 | Natijalar va savol statistikasi, Excel | Har o'quvchi bali, savollar bo'yicha to'g'ri javob foizi |
| T-17 | Retake oynasi (bitta o'quvchiga qayta topshirish) | Faqat o'sha o'quvchi qayta topshira oladi |
| T-18 | Offline natija kiritish (qog'ozdagi test) | Natija saqlanadi; "kelmadi"/"sababli" farqlanadi |
| T-19 | Coin berish | Limitdan oshsa rad etiladi; o'quvchi balansida ko'rinadi |
| T-20 | Dars rejalari: rejani ochish, mavzular | Darslarga mavzular bog'langan |
| T-21 | Sinf rahbari: bosh sahifada "Sinfim bugun", Davomat — faqat o'z sinfi | Boshqa sinflar ko'rinmaydi |
| T-22 | Boshqa o'qituvchining guruhiga ball qo'yishga urinish (URL orqali) | Ruxsat yo'q |
| T-23 | Telefonda jurnal | Ball qo'yish qulay, aylantirish to'g'ri |

## 3. O'quvchi (5-sinfdan)

| # | Ssenariy | Kutilgan natija |
|---|---|---|
| S-01 | Telefondan kirish (admin bergan parol) | Parolni almashtirish, keyin "Bosh": coin, chorak natijasi, bugungi darslar, ochiq testlar |
| S-02 | Jadval: hafta | Darslar, mavzu va uy vazifasi; bekor qilingan dars belgilangan |
| S-03 | Testlar → ochiq testni boshlash | Savollar, vaqt hisoblagichi, savollar navigatori |
| S-04 | Javob tanlash, keyin sahifani yangilash | Javoblar saqlangan, test davom etadi |
| S-05 | Internet uzilib qaytishi | Javoblar yo'qolmaydi |
| S-06 | Boshqa varaqqa o'tish (ko'chirishga urinish) | Qoidabuzarlik sanaladi; chegaradan oshsa test yopiladi |
| S-07 | Yakunlash (javobsiz savollar bilan) | Tasdiqlash so'raladi; yakunlangach o'zgartirib bo'lmaydi |
| S-08 | Vaqt tugashi | Test avtomatik topshiriladi |
| S-09 | Natijani ko'rish | O'qituvchi sozlamasiga ko'ra (darhol yoki test yopilgandan keyin); to'g'ri javoblar o'quvchiga ko'rsatilmaydi |
| S-10 | Baholar: hafta, oy, chorak | Fanlar bo'yicha foiz va trend |
| S-11 | Davomat | Kunlar, kelgan vaqti |
| S-12 | Coin → Do'kon → buyurtma | Balans yetsa — buyurtma; yetmasa tugma ishlamaydi |
| S-13 | Boshqa o'quvchining sahifasiga URL bilan kirish | Topilmadi |
| S-14 | iPhone va Android, yorug' va qorong'i mavzu | Hammasi o'qiladi, tugmalar siqilmaydi |

## 4. Vasiy (ota-ona) — sayt

| # | Ssenariy | Kutilgan natija |
|---|---|---|
| G-01 | Telefon raqami (istalgan formatda) va parol bilan kirish | Portal: farzandlar ro'yxati |
| G-02 | Ikki farzandli vasiy: farzandni almashtirish | Har sahifada tanlangan farzand ma'lumoti |
| G-03 | Jadval, baholar, davomat, coin, testlar tarixi | Faqat o'z farzandi; begona o'quvchi ko'rinmaydi |
| G-04 | Bekor qilingan dars | Jadvalda "bekor qilindi" |
| G-05 | Telefonda | Pastki menyu, aylantirish to'g'ri |

## 5. Vasiy — Telegram (M7 tayyor bo'lgach)

| # | Ssenariy | Kutilgan natija |
|---|---|---|
| TG-01 | Botni ochish, telefon raqamini ulashish | Raqam vasiy kartasidagiga mos kelsa — bog'lanadi; mos kelmasa — tushuntirish |
| TG-02 | Admin bergan bir martalik kod bilan bog'lash | Bog'lanadi; kod qayta ishlamaydi |
| TG-03 | Mini App'ni ochish | Login so'ramaydi; saytdagi portal bilan bir xil ma'lumot |
| TG-04 | Bildirishnomalar: farzand keldi/ketdi, yangi baho, test natijasi, coin | Xabar keladi; sokin soatlarda kelmaydi |
| TG-05 | Botdan uzish | Xabarlar to'xtaydi; Mini App kirish so'raydi |
| TG-06 | Admin: sinfga ommaviy xabar | Faqat tanlangan sinf vasiylariga keladi |

## 6. Face ID (ixtiyoriy — terminal bo'lsa)

| # | Ssenariy | Kutilgan natija |
|---|---|---|
| F-01 | Qurilmalar: terminal qo'shish (IN va OUT), Bridge ulash | Terminal "Onlayn" |
| F-02 | O'quvchi yuzini yuborish | Face Check: "Yuklangan" |
| F-03 | Terminal oldidan o'tish | Davomat jurnalida vaqt va holat (kechikish bilan) |
| F-04 | Xodim yuzi (kartada kod va telefon) | Davomat → Xodimlar: kelish vaqti |
| F-05 | Terminalni o'chirib qo'yish | Bosh sahifada "terminal javob bermayapti"; qayta yoqilgach o'tishlar yuklanadi |

## 7. Umumiy

| # | Tekshiruv | Kutilgan natija |
|---|---|---|
| X-01 | O'zbekcha va ruscha | Barcha matnlar tarjima qilingan |
| X-02 | Noto'g'ri parolni ko'p marta kiritish | Vaqtincha bloklanadi, xabar aniq |
| X-03 | Chiqish | Orqaga tugmasi bilan sahifa ochilmaydi |
| X-04 | Bir vaqtda ikki o'qituvchi bitta o'quvchiga limit chegarasida ball | Faqat biri o'tadi |
| X-05 | Sahifa yuklanishi, bo'sh holat, xato holati | Har sahifada tushunarli xabar |

## Yakun

Sinov tugagach: ❌ bo'lganlar ro'yxati → tuzatish → qayta sinov. Hammasi ✅ (Telegram va Face ID ham) bo'lgach — VPS
sotib olinadi, zaxira (`docs/ops/backup-restore.md`) sozlanadi va birinchi tiklash mashqi o'tkaziladi.
