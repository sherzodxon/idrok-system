# M0 — Audit va arxitektura (Claude Code uchun prompt)

> Bu promptni Claude Code'ga yangi repo ildizida bering. Oldindan joylashtiring:
> - `CLAUDE.md`, `docs/` (shu to'plam)
> - `docs/references/registo-edextest-analysis.pdf` — Registo va EdEx Test tahlili
> - `docs/references/design-reference.png` — dashboard dizayn namunasi
> - Yangi repo: `~/idrok-system`. EdexTest kodi: `~/Edex/EdexTest`.
> - Claude Code'ni EdexTest papkasiga ham ruxsat bilan oching:
>   `cd ~/idrok-system && claude --add-dir ~/Edex/EdexTest`

---

Sen Idrok System loyihasining texnik rahbarisan. Bu bosqichda **kod yozmaysan** (scaffold, paket o'rnatish, migratsiya ham yo'q). Natija — tasdiqlashga tayyor hujjatlar.

## O'qish tartibi

1. `CLAUDE.md` — buzilmas qoidalar va qabul qilingan qarorlar.
2. `docs/ROADMAP.md` — bosqichlar.
3. `docs/spec/lesson-plan.md`, `docs/spec/scoring.md`, `docs/spec/tests.md` — M2–M4 batafsil talablari.
4. `docs/MASTER_SPEC.md` — umumiy topshiriq (eskirgan qismlari boshida ko'rsatilgan).
5. `docs/references/registo-edextest-analysis.pdf` va `docs/references/design-reference.png`.
6. EdexTest kodi: `~/Edex/EdexTest` — **faqat o'qish**. Hech narsa yozma, ishga tushirma, uning bazasiga ulanma.

## 1. EdexTest auditi → `docs/architecture/edextest-audit.md`

- Stack, papka tuzilishi, Prisma sxemasi (modellar va munosabatlar qisqacha).
- Rollar va auth qanday ishlaydi.
- Ball/coin mantig'i: qanday yoziladi, limitlar qanday tekshiriladi, kunlik chegara qanday aniqlanadi.
- Test oqimi: yaratish, savollar, yechish, taymer, autosave, anti-cheat, natija hisoblash.
- **Ma'lum muammolar sabablarini kodda top**: (a) kunlik limitning UTC/Toshkent farqi bilan xato hisoblanishi, (b) ball loglarining yo'qolishi. Har biri uchun: sabab, kod joyi, yangi tizimda qaysi qoida uni oldini oladi (`CLAUDE.md` §4 ga havola).
- Qayta ishlatiladigan qismlar jadvali: `| Qism | Fayl(lar) | Qanday ishlatiladi (as-is / moslashtirib / faqat g'oya) | Izoh |`.
- Yangi tizimga olib o'tilmasligi kerak bo'lgan yondashuvlar (sabab bilan).

## 2. Arxitektura → `docs/architecture/architecture.md`

- Monorepo tuzilishi (`CLAUDE.md` §2) — har paket/app vazifasi, ular orasidagi bog'liqlik.
- Backend qatlamlari, modul shabloni, domain (sof hisoblash) qatlami qayerda.
- Auth dizayni: cookie (web) + bearer (mobil/Mini App), refresh rotation, session revoke, multi-role.
- Tenant izolyatsiyasi: `tenantId` qayerdan olinadi, Prisma darajasida qanday majburlanadi (masalan extension/middleware), testlash usuli.
- RBAC: permission ro'yxati qayerda saqlanadi (`packages/shared`), seed, tekshiruv middleware.
- Vaqt: `packages/shared/time` API'si (funksiya imzolari), `schoolDate` hisoblash.
- Queue: qaysi job'lar (M1–M5), retry/failed holati, worker deploy.
- Storage abstraksiyasi interfeysi.
- i18n: web (next-intl) va API xato kalitlari.
- Deploy: Render (api, worker), Supabase (DB, pooler/direct URL), Render Key Value (Redis), web uchun variant (Vercel yoki Render) — tavsiya va sabab. Environmentlar: local, staging, production.
- CI: GitHub Actions bosqichlari.
- Mermaid diagramma: komponentlar va asosiy oqimlar (login, ball qo'yish, test topshirish).

## 3. Ma'lumotlar modeli → `docs/architecture/data-model.md` + `docs/architecture/schema.draft.prisma`

- Faqat **M1–M5** modellari (spec'lardagi modellar asosida). Keyingi bosqichlar uchun faqat "kengaytirish nuqtalari" ro'yxati.
- Har model: maqsadi, asosiy maydonlar, munosabatlar, unique va indekslar (qaysi so'rov uchun), o'chirish siyosati (archive/ledger).
- `schema.draft.prisma` — to'liq, `prisma format` / `prisma validate` dan o'tadigan qoralama (faqat fayl; migratsiya yaratilmaydi). Buni tekshirish uchun prisma CLI'ni vaqtinchalik `npx` bilan ishlatish mumkin.
- ER diagramma (Mermaid) — asosiy domenlar bo'yicha bo'lingan.
- Spec'lar orasida ziddiyat yoki bo'shliq topsang — `open-questions.md`ga yoz, o'zing hal qilma.

## 4. API rejasi → `docs/architecture/api-plan.md`

- M1–M5 endpointlari: method, path, permission, qisqa tavsif, asosiy request/response tiplari.
- Umumiy konvensiyalar: xato formati, pagination, idempotency header, versiyalash.

## 5. UI tuzilishi → `docs/architecture/ui-structure.md`

- Har rol uchun navigatsiya (sidebar) va sahifalar ro'yxati (M1–M5).
- Asosiy ekranlar uchun qisqa wireframe tavsifi: o'qituvchi jurnali, dars rejasi muharriri, test yechish ekrani, o'quvchi progress sahifasi, admin policy muharriri.
- Design tokenlar ro'yxati (light + dark), dizayn namunasidan olingan prinsiplar.
- Umumiy komponentlar ro'yxati (MASTER_SPEC §5.7) va qaysi bosqichda kerakligi.

## 6. Bosqichlar rejasi → `docs/architecture/implementation-plan.md`

- M1 ni 4–8 ta kichik qadamga bo'l (har biri alohida PR hajmida), har qadam uchun: nima qilinadi, qanday tekshiriladi.
- M2–M5 uchun yuqori darajadagi qadamlar.
- Xavflar va ularni kamaytirish.

## 7. Ochiq savollar → `docs/architecture/open-questions.md`

Spec'lardagi "Ochiq savollar" bo'limlarini yig', o'zingnikini qo'sh. Format:
`| # | Savol | Nega muhim | Variantlar | Tavsiya etilgan default | Kim hal qiladi |`

## Yakunlash

- `docs/progress/M0.md` yoz: yaratilgan hujjatlar, eng muhim 5 ta topilma, ochiq savollar soni.
- Javobingda qisqacha xulosa ber va egasidan tasdiqlashni so'ra. M1 ga o'zing o'tma.
