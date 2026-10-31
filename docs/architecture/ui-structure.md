# UI tuzilishi (M1–M5)

> Stack: Next.js App Router, Tailwind + CSS variables, TanStack Query, React Hook Form + Zod, next-intl, Recharts.
> Barcha matnlar `messages/{uz,ru}.json`da; ranglar faqat semantic token orqali (`bg-primary`, `text-muted`).
> Ruxsat: menyu va tugmalar `MeDto.permissions` bo'yicha yashiriladi; haqiqiy tekshiruv backendda.

## 1. Marshrutlar tuzilmasi

```
app/
  (auth)/login, (auth)/change-password
  (app)/layout.tsx              — sidebar + topbar + rol konteksti (desktop/planshet uchun)
  (app)/dashboard               — rolga qarab vidjetlar
  (app)/admin/...               — maktab boshqaruvi
  (app)/teacher/...             — o'qituvchi ish joyi
  (portal)/layout.tsx           — mobile-first: pastki tab-bar, sodda header
  (portal)/student/...          — o'quvchi
  (portal)/guardian/...         — vasiy (bir nechta farzand — tepada tanlagich)
  (exam)/attempt/[id]           — test yechish: chalg'ituvchi elementlarsiz to'liq ekran
```

Rol konteksti: bir nechta roli bor foydalanuvchi (masalan o'qituvchi + direktor o'rinbosari) topbar'dagi tanlagich orqali menyu to'plamini almashtiradi; tanlov `UserPreference`da emas, URL segmentida (`/admin` / `/teacher`).

## 2. Rollar bo'yicha navigatsiya va sahifalar

Belgilar: **M1**…**M5** — sahifa qaysi bosqichda paydo bo'ladi.

### 2.1. Maktab admini / direktor (`SCHOOL_ADMIN`, `DIRECTOR`, `DEPUTY_DIRECTOR` — permission'ga qarab)

| Sidebar bo'limi | Sahifalar | Bosqich |
|---|---|---|
| Bosh sahifa | Dashboard (o'quvchilar, xodimlar, bugungi darslar, ball qo'yilmagan darslar, test natijalari, coin statistikasi) | M1 skelet → M3–M5 vidjetlar |
| O'quvchilar | Ro'yxat (qidiruv, sinf/holat filtri), profil (tablar: umumiy, vasiylar, sinf tarixi, ballar M3, testlar M4, coin M5), qo'shish/tahrir drawer | M1 |
| Vasiylar | Ro'yxat, profil (farzandlari), bog'lash | M1 |
| Xodimlar | Ro'yxat, profil, biriktirishlar | M1 |
| O'quv tuzilmasi | O'quv yillari; Parallellar va sinflar; Guruhchalar; Fanlar; O'qituvchi biriktirishlari (matritsa: guruh × fan) | M1 |
| Kalendar | Davrlar; Oy kalendari (bayram/ta'til belgilash); Ish haftasi; Smenalar va qo'ng'iroq jadvali | M2 |
| Dars jadvali | Jadval versiyalari; Muharrir (sinf / o'qituvchi / xona ko'rinishi, to'qnashuvlar); Chop etish → generatsiya diff; "Darslar soni" hisoboti | M2 |
| O'quv rejalari | Barcha rejalar (holat badge'lari), tasdiqlash navbati | M2 |
| Baholash | Policy muharriri; Limitlar; Mezonlar; 5 ballik shkala; Davrni yopish ustasi; "Kim ball qo'ymagan"; Davr natijalari | M3 |
| Testlar | Barcha testlar (filtr: yil, sinf, fan, holat); test sahifasi (natijalar, retake/override, vaqtni o'zgartirish); Test turlari; Test sozlamalari | M4 |
| Coin | Dashboard; Tranzaksiyalar; Mezonlar; Limitlar; O'qituvchilar faolligi; Do'kon mahsulotlari; Buyurtmalar; Sozlamalar | M5 |
| Import / eksport | Importlar tarixi, yangi import ustasi | M1 |
| Sozlamalar | Maktab; Brending (jonli preview); Foydalanuvchilar; Rollar va ruxsatlar; Audit jurnali | M1 |

### 2.2. O'qituvchi (`TEACHER`, `CLASS_TEACHER`)

| Sidebar | Sahifalar | Bosqich |
|---|---|---|
| Bosh sahifa | Bugungi darslar (mavzu bilan), ball qo'yilmagan darslar, yaqin testlar | M1 skelet → M2–M4 |
| Mening guruhlarim | Guruh → o'quvchilar ro'yxati; (sinf rahbari: o'z sinfi profillari) | M1 |
| Jurnal | Guruh + fan + davr tanlash → jurnal (§3.1); "Telefon uchun tez rejim" | M3 |
| Dars rejalarim | Rejalar ro'yxati, shablonni yuklab olish, import (preview), reja muharriri (§3.2) | M2 |
| Jadvalim | Haftalik jadval | M2 |
| Savollar banki | Ro'yxat (filtr: mavzu, qiyinlik, "mavzusiz"), savol muharriri, Excel import/eksport | M4 |
| Testlar | Mening testlarim; yangi test ustasi (online/offline); natijalar va statistika; offline natija kiritish | M4 |
| Coin | Darsda tez baholash (sinf → o'quvchi kartasi → mezon, miqdor), tarixim | M5 |

### 2.3. O'quvchi (mobile-first, pastki tab-bar)

| Tab | Sahifalar | Bosqich |
|---|---|---|
| Bosh | Salomlashuv, bugungi jadval, yaqin testlar, oxirgi ballar | M1 skelet → M2–M4 |
| Fanlar | Fanlar kartochkalari (davr foizi, 5 ballik baho bo'lsa) → fan sahifasi (kun/hafta/oy grafigi, yozuvlar tarixi mavzu bilan, testlar) | M3 |
| Jadval | Haftalik jadval, har dars mavzusi va uy vazifasi | M2 |
| Testlar | Holatlar ro'yxati → test yechish (§3.3) → natija | M4 |
| Coin | Balans, tarix, faollik grafigi, do'kon, buyurtmalarim | M5 |
| Profil | Shaxsiy ma'lumot, parol, til, tema | M1 |

### 2.4. Vasiy (mobile-first)

Tepada farzand tanlagich (bitta bo'lsa yashirin). Tablar: Bosh (bugungi darslar, oxirgi ballar, testlar), Fanlar (o'quvchidagidek, faqat o'qish), Jadval, Testlar (natijalar), Coin (balans va tarix), Profil. M1 da: profil + farzandlar ro'yxati; qolganlari bosqichma-bosqich (M2–M5). To'liq vasiy portali va Telegram — M7.

## 3. Asosiy ekranlar wireframe tavsifi

### 3.1. O'qituvchi jurnali (desktop/planshet)

```
┌ Topbar: [7-A ▾] [Informatika ▾] [1-chorak ▾]          [Hammaga N ball] [Eksport] ┐
├──────────────┬─────────────────────────────────────────────────────────────────────┤
│ O'quvchilar  │  02.09 │ 04.09 │ 09.09 │ 11.09 │ ...   (sticky sarlavha: sana + mavzu │
│ (sticky)     │  Sikl  │ Sikl  │ Massiv│ Nazorat│        qisqa nomi, tooltip to'liq)  │
│ Aliyev A. ●  │  8/10  │  —   │ PEND  │  NB   │                                     │
│  bugun: 6 qoldi│                                                                    │
│ Karimova D.  │ 10/10  │  7   │  9    │  ...  │                                     │
├──────────────┴─────────────────────────────────────────────────────────────────────┤
│ Pastki panel (katak tanlanganda): Davomat [Keldi|Kechikdi|Sababli|Sababsiz]          │
│  Mezon [Faollik ▾]  Ball [ 0 1 2 ... 10 ]  Izoh [...]  [Saqlash]  qolgan: dars 2, kun 6│
└──────────────────────────────────────────────────────────────────────────────────────┘
```
- Katak holatlari: ball (net), `PENDING` (kulrang), `NB` (kelmagan), `—` (bekor), qulf belgisi (yopilgan davr).
- Klaviatura: strelkalar, raqam → ball, `Enter` saqlash, `A/L/E/U` davomat.
- Saqlash optimistik emas: server javobidan keyin yangilanadi; `SCORE_LIMIT_EXCEEDED` panelda aniq ko'rsatiladi (qaysi limit, qancha qoldi).
- Yozuv tarixi popover: har yozuv, kim, qachon, reverse tugmasi (ruxsat bo'lsa, sabab so'raladi).
- **Telefon tez rejimi:** "Bugungi darsim" → o'quvchilar ro'yxati (katta kartalar) → kartani bosish → bottom sheet: mezon + katta ball tugmalari.

### 3.2. Dars rejasi muharriri

```
┌ Informatika · 7-sinf · v3 [DRAFT]          [Shablon ⤓] [Import ⤒] [Yuborish] ┐
│ Ogohlantirishlar: Jami 34 soat, 7-A jadvalida 33 dars (−1) · 2 mavzu davrdan chiqadi│
├────┬────────┬───────────────────────────┬──────┬───────────┬──────────┬─────────┤
│ ⋮⋮ │ Chorak │ Mavzu (Topic qidiruv/yangi)│ Soat │ Dars turi │ Uy vazifa│ ...     │
│ ⋮⋮ │ 1      │ Algoritm tushunchasi       │ 2    │ Yangi     │ §1 1-3   │         │
│ ⋮⋮ │ 1      │ Nazorat ishi               │ 1    │ Nazorat   │          │         │
├────┴────────┴───────────────────────────┴──────┴───────────┴──────────┴─────────┤
│ O'ng panel: "Qo'llash" → guruhlar [7-A ✓][7-B ✓] → preview: sana ↔ mavzu jadvali   │
└───────────────────────────────────────────────────────────────────────────────────┘
```
- Drag-drop tartib, inline tahrir, qator qo'shish; APPROVED versiyada faqat "Yangi versiya" tugmasi.
- Import ustasi: fayl → rejim (qator=dars / faqat mavzular) → preview (OK/ogohlantirish/xato, sabab) → saqlash (DRAFT).
- Tasdiqlovchi ko'rinishi: farq (oldingi versiya bilan diff), Tasdiqlash / Rad etish (izoh majburiy).

### 3.3. Test yechish ekrani (mobile-first, `(exam)` layout)

```
┌ Informatika · BSB №2          ⏱ 14:32   ☁ Saqlandi   ⚠ 1/3 ┐
├─────────────────────────────────────────────────────────────┤
│ 5 / 20                                                      │
│ Savol matni (KaTeX, rasm — kattalashtirish)                 │
│ ○ A variant      (SINGLE: radio; MULTIPLE: checkbox;        │
│ ○ B variant       SHORT_TEXT: input; MATCHING: tanlov juftlik)│
│ ○ C variant                                                 │
├─────────────────────────────────────────────────────────────┤
│ [◀ Oldingi]   [Savollar ▦]   [Keyingi ▶]                    │
└─────────────────────────────────────────────────────────────┘
```
- Taymer: `deadline − (serverNow + (performance.now() − t0))`; serverga bog'liq, kompyuter soatiga emas.
- Saqlash indikatori: "Saqlandi" / "Saqlanmoqda…" / "N ta javob saqlanmagan — internet yo'q" (navbat, qayta ulanganda yuboriladi).
- Navigator (bottom sheet): savol raqamlari — javob berilgan/berilmagan/joriy.
- Buzilish ogohlantirishi: modal "Sahifadan chiqish taqiqlanadi. Yana N ta imkoniyat" (server javobidagi `remaining`).
- Yakunlash: tasdiq oynasi (javobsiz savollar soni). Natija sahifasi `showResultToStudent` bo'yicha (✅/❌, to'g'ri javob ko'rsatilmaydi — default).
- Boshlashdan oldingi sahifa: qoidalar, vaqt, savollar soni, "Boshlash".

### 3.4. O'quvchi progress sahifasi (mobile-first)

```
┌ Mening natijalarim     [Kun | Hafta | Oy | Chorak]   ◀ 30.10 ▶ ┐
│ Umumiy: 86%  (dailyView ≠ BY_SUBJECT bo'lsa)                    │
│ ┌ Matematika ───────────── 88%  "5" ┐ ┌ Informatika ─── 91% ┐ │
│ │ sparkline (oxirgi 4 hafta)        │ │ ...                  │ │
│ └───────────────────────────────────┘ └──────────────────────┘ │
│ Fan sahifasi: grafik (Recharts), yozuvlar ro'yxati:              │
│   04.09 · Massivlar · Faollik +8 · Karimov A.                    │
│   Test: BSB №2 — 17/20 (85%) · Davriy natijaga hissasi: 1/3      │
└──────────────────────────────────────────────────────────────────┘
```
- `null` foiz = "Hali baho yo'q" (0% emas). `PENDING` sessiyalar ko'rsatilmaydi.
- Vasiy uchun bir xil komponent, faqat o'qish.

### 3.5. Admin policy muharriri

```
┌ Baholash qoidasi: "Asosiy" · v4 [DRAFT]               [Tekshirish] [Chop etish] ┐
├ Ko'rinish ─────────────────────────────────────────────────────────────────────┤
│ Kunlik ko'rinish: (•) Fanlar va umumiy ( ) Faqat fanlar ( ) Faqat umumiy        │
│ Umumiy usul: (•) Bitta qozon ( ) Fan vaznlari → [vaznlar jadvali]              │
│ Davrlar: [x] Kun [x] Hafta [x] Oy [x] Davr                                     │
├ Istisnolar ────────────────────────────────────────────────────────────────────┤
│ Sababli kelmagan: [Hisobdan chiqarish ▾]  Sababsiz: [Hisobdan chiqarish ▾]      │
│ Baholanmagan dars: [Kutilmoqda ▾]                                               │
├ Davr tarkibi (davr maksimumi: 100) ────────────────────────────────────────────┤
│ Kundalik ballar  [ 50 ]   Testlar [ 50 ]   + Komponent                          │
│ Jami: 100 / 100 ✓   (jonli; mos kelmasa qizil va "Chop etish" o'chiq)           │
│ Testlar rejimi: [Hammasi ▾]  Qatnashmagan: [Chiqarish ▾]  Retake: [Oxirgisi ▾]  │
│ Bo'sh komponent: [Qayta taqsimlash ▾]                                           │
├ Yarim yillik / yillik ─────────────────────────────────────────────────────────┤
│ 1-yarim yil: [Vaznli ▾] 1-chorak [40]% 2-chorak [60]%                           │
├ Yaxlitlash va shkala ──────────────────────────────────────────────────────────┤
│ [Yarim yuqoriga ▾] [0] kasr · Shkala: [5 ballik ▾]                              │
├ Misol hisob (preview) ─────────────────────────────────────────────────────────┤
│ daily 88% × 50 = 44, tests 86% × 50 = 43 → 87/100 → "5"   (server /validate)   │
└────────────────────────────────────────────────────────────────────────────────┘
```
- Tekshiruv serverdagi `POST /policy-versions/:id/validate` (formula frontendda takrorlanmaydi; forma faqat zod sxema bilan).
- Versiyalar tarixi (o'ng panel), "joriy davrga qo'llash" alohida tasdiq oynasi (sabab majburiy).

## 4. Dizayn prinsiplari (`docs/references/design-reference.png` asosida)

1. **Och, havodor sirtlar:** sahifa foni `--color-background` (juda och ko'k-kulrang), kartalar oq, katta radius (12px), yengil soya yoki 1px chegara. Juda zich emas (COMFORTABLE).
2. **Bitta ko'k aksent:** asosiy amallar, faol menyu, KPI "hero" kartasi to'liq `primary` fonda oq matn bilan (namunadagi CGPA kartasi). Qolgan KPI kartalar oq, raqam katta va qalin, izoh kichik `muted`.
3. **Sidebar:** oq, ikonka + yozuv, faol element `primary-soft` fon + `primary` matn; pastda "Chiqish". Collapsed — faqat ikonka + tooltip.
4. **Topbar:** qidiruv (chapda/markazda), bildirishnoma, avatar + ism + rol.
5. **Salomlashuv bloki:** "Xush kelibsiz, {ism}" + qisqa izoh — dashboard tepasida.
6. **Kartalar ichida ro'yxat:** sarlavha + "Hammasi" havolasi; qator: rangli ikonka-badge (fan rangi `colorKey`dan), nom, ikkinchi qator `muted`, o'ngda qiymat/badge.
7. **Mobil:** pastki tab-bar (5 ta), 4×2 tez havolalar grid'i (ikonka plitkalari), "Bugungi jadval" kartasi vaqt va xona bilan, katta asosiy tugma pastda.
8. **Progress:** doira (ring) diagramma foiz uchun (davomat/progress), sparkline KPI'da.
9. **Tipografiya:** Inter (yoki shunga o'xshash grotesk), sarlavha 600–700, matn 400; raqamlar `tabular-nums`.
10. Namunadagi rasmli yangiliklar/kampus bo'limlari M1–M5 ga kirmaydi.

## 5. Design tokenlar

`apps/web/src/styles/tokens.css` — manba. Tailwind `theme.extend.colors` faqat `var(--color-*)`ga ishora qiladi. Brending (`SchoolBranding`) `primary*` tokenlarini runtime'da `<html style="--color-primary: ...">` orqali almashtiradi (SSR'da `GET /branding`dan, flash bo'lmasligi uchun).

| Token | Light | Dark | Ishlatilishi |
|---|---|---|---|
| `--color-primary` | `#4E92CF` | `#5FA0DA` | asosiy amal, faol holat |
| `--color-primary-hover` | `#397FBF` | `#78B0E2` | hover |
| `--color-primary-strong` | `#286FA9` | `#9CC6EC` | bosilgan, matn ustida primary |
| `--color-primary-soft` | `#EAF3FB` | `#1A2E42` | faol menyu foni, badge foni |
| `--color-on-primary` | `#FFFFFF` | `#0B1622` | primary fon ustidagi matn |
| `--color-background` | `#F5F8FC` | `#0E141B` | sahifa foni |
| `--color-surface` | `#FFFFFF` | `#161E27` | karta, modal |
| `--color-surface-muted` | `#F0F4F9` | `#1C2632` | jadval sarlavhasi, input foni |
| `--color-sidebar` | `#FFFFFF` | `#121A23` | sidebar |
| `--color-text-primary` | `#172B3A` | `#E6EDF3` | asosiy matn |
| `--color-text-secondary` | `#718096` | `#94A3B8` | izoh, muted |
| `--color-text-disabled` | `#A0AEC0` | `#5B6B7C` | |
| `--color-border` | `#E3EAF1` | `#2A3644` | chegaralar |
| `--color-border-strong` | `#CBD5E1` | `#3A4858` | input fokus emas chegarasi |
| `--color-focus-ring` | `#4E92CF66` | `#5FA0DA80` | fokus halqasi |
| `--color-success` / `-soft` | `#16A36A` / `#E7F6EF` | `#34C78A` / `#123227` | keldi, muvaffaqiyat |
| `--color-warning` / `-soft` | `#E9A23B` / `#FDF3E3` | `#F2B661` / `#3A2C14` | kechikdi, ogohlantirish |
| `--color-danger` / `-soft` | `#DC5A5A` / `#FBEAEA` | `#EF7B7B` / `#3D1C1E` | xato, sababsiz, jarima |
| `--color-info` / `-soft` | `#4E92CF` / `#EAF3FB` | `#5FA0DA` / `#1A2E42` | ma'lumot |
| `--color-chart-1..8` | ko'k, yashil, to'q sariq, binafsha, moviy, pushti, sariq, kulrang | dark uchun yorqinroq variantlar | grafiklar, fan `colorKey` |
| `--radius-card` | `12px` | ″ | |
| `--radius-button` / `--radius-input` | `8px` | ″ | |
| `--shadow-card` | `0 1px 2px rgb(23 43 58 / 0.04), 0 4px 12px rgb(23 43 58 / 0.04)` | `none` (chegara bilan) | |
| `--space-page` | `24px` (mobil `16px`) | ″ | |
| `--sidebar-width` / `--sidebar-collapsed` | `248px` / `72px` | ″ | |
| `--font-sans` | `Inter, system-ui, sans-serif` | ″ | |

Kontrast: brending rangi saqlanayotganda server WCAG AA (`on-primary` bilan ≥ 4.5:1) ni tekshiradi va ogohlantiradi; `primary-hover/strong/soft` berilmasa avtomatik hosil qilinadi (OKLCH'da yorug'likni o'zgartirib).

Tema: `LIGHT | DARK | SYSTEM` — `<html data-theme>`; SYSTEM `prefers-color-scheme` bo'yicha. Tanlov `UserPreference.themeMode`da, birinchi render uchun cookie'da ham.

## 6. Umumiy komponentlar (MASTER_SPEC §5.7)

| Komponent | Bosqich | Izoh |
|---|---|---|
| Button, Input, Select, Textarea, Checkbox, Radio, Switch | M1 | `cva` variantlar, faqat tokenlar |
| DatePicker (+ DateRangePicker) | M1 | `SchoolDate` bilan ishlaydi, Toshkent bo'yicha (`packages/shared/time`) |
| TimePicker ("08:30") | M2 | qo'ng'iroq jadvali |
| Modal, Drawer, ConfirmationDialog | M1 | forma — drawer (desktop), full-screen sheet (mobil) |
| BottomSheet | M1 | portal, jurnal tez rejimi |
| DataTable (+ Pagination, Search, FilterBar, ColumnVisibility) | M1 | URL'da `page/pageSize/sort/q/filtrlar` |
| Tabs, Badge, Dropdown/Menu, Tooltip, Breadcrumb, Avatar | M1 | |
| Toast | M1 | xato `code` → tarjima |
| EmptyState, LoadingSkeleton, ErrorState | M1 | har sahifada majburiy (QueryBoundary bilan) |
| StatCard, KpiHeroCard, ProgressRing | M1 (dashboard skelet) | |
| Chart (Line, Bar, Sparkline — Recharts o'rami) | M3 | tooltip matnlari escape; ranglar `--color-chart-*` |
| FileUpload (drag-drop, MIME/hajm) | M1 | import, logo |
| ImportWizard (yuklash → preview jadvali → commit) | M1 | barcha importlar uchun umumiy |
| ThemeToggle, LocaleSwitcher, RoleContextSwitcher | M1 | |
| AppShell (Sidebar collapsible, MobileDrawer, Topbar), PortalShell (tab-bar) | M1 | |
| PermissionGate (`<Can permission="...">`) | M1 | faqat UI |
| CalendarMonth (kun belgilash) | M2 | |
| TimetableGrid (kun × dars, drag-drop, to'qnashuv belgisi) | M2 | |
| SortableTable (reja qatorlari) | M2 | |
| GradebookGrid (virtual scroll, sticky ustun/qator, klaviatura) | M3 | eng murakkab komponent |
| ScoreInputPanel, AttendanceToggle | M3 | |
| PolicyEditor bo'laklari (ComponentSumField, BandEditor) | M3 | |
| RichQuestionView (KaTeX, rasm), QuestionEditor (4 tur) | M4 | |
| AttemptTimer, QuestionNavigator, SaveStatusIndicator | M4 | |
| CoinQuickAward (o'quvchi kartasi grid'i) | M5 | |
| ProductCard | M5 | |

## 7. Holatlar va qulaylik

- Har sahifada: loading (skeleton), empty (tushuntirish + asosiy amal), error (qayta urinish + requestId).
- Formalar: React Hook Form + zod (shared sxema), server xatolari maydonlarga map qilinadi.
- Ro'yxatlar: saqlangandan keyin `invalidateQueries`; filtrlar URL'da (EdexTest/Registo saboqi — F5 dan keyin ham saqlanadi).
- A11y: fokus halqasi, klaviatura navigatsiyasi (jurnal, test), `aria-live` saqlash holati va taymer uchun (har daqiqada).
- Mobil: gorizontal scroll yo'q; jadvallar mobil'da karta ro'yxatiga aylanadi (jurnal bundan mustasno — alohida tez rejim).
