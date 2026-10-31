# M1 — Core platforma (Claude Code uchun prompt)

> Ishga tushirish: `cd ~/idrok-system && claude --add-dir ~/Edex/EdexTest`
> So'ng: `docs/prompts/M1-core.md dagi vazifani bajar.`

---

M0 tasdiqlandi. Endi `docs/ROADMAP.md` dagi **M1** bosqichini bajarasan.

## 0. Avval o'qi

1. `CLAUDE.md`
2. `docs/architecture/open-questions.md` — boshidagi **"Qabul qilingan qarorlar"** bo'limi majburiy.
3. `docs/architecture/implementation-plan.md` — M1 ning 8 qadami.
4. `docs/architecture/architecture.md`, `data-model.md`, `api-plan.md`, `ui-structure.md`.
5. `docs/architecture/schema.draft.prisma` — faqat referens.

## 1. Tayyorgarlik (1-qadamdan oldin, alohida commit)

- Repo'da git yo'q bo'lsa: `git init`, `main` branch, `.gitignore` (node_modules, .env*, `!.env.example`, .DS_Store, build papkalari), joriy holatni birinchi commit.
- `references/` papkasini `docs/references/` ga ko'chir (`git mv`), hujjatlardagi havolalarni tekshir.
- `CLAUDE.md` §1 jadvalida `Hosting (hozir)` qatorini quyidagiga almashtir va undan keyin 3 qator qo'sh:

```
| Hosting (hozir) | Web + backend + worker: Render. DB: Supabase PostgreSQL. Redis: Render Key Value |
| Haqiqiy ma'lumot | VPS'ga ko'chguncha Render/Supabase'da faqat demo ma'lumot. Haqiqiy o'quvchi/vasiy ma'lumoti faqat VPS'da |
| Shaxsiy hujjatlar | Pasport, tug'ilganlik guvohnomasi, INN yig'ilmaydi va modelda yo'q |
| Login | O'quvchi: 5-sinfdan. Vasiy: telefon raqami (login) + admin bergan vaqtinchalik parol. Telegram — M7 |
```

## 2. M1 qoidalari

- **Faqat M1 modellari** migratsiyaga kiradi (tenant, settings, branding, identity/auth, RBAC, audit, idempotency/outbox, fayllar, import, o'quv yili, Grade, ClassGroup, TeachingGroup(+Member), Subject, TeacherAssignment, Student, Guardian, StudentGuardian, StudentEnrollment, Employee). M2–M5 modellari qoralamada qoladi va o'z bosqichida qo'shiladi.
- Shu modellarga tegishli SQL-only invariantlar (`data-model.md` §8: partial unique, CHECK, EXCLUDE, `AuditLog` append-only trigger) migratsiya SQL'ida yoziladi va integration test bilan tekshiriladi.
- Student modelida pasport/guvohnoma/INN maydonlari **yo'q** (Q-29). Import shablonida ham yo'q.
- Login qoidasi (Q-26, Q-27): o'quvchi akkaunti 5-sinfdan yuqori uchun importda avtomatik yaratiladi (quyi sinflar — ixtiyoriy belgi bilan); vasiy login = E.164 telefon; vaqtinchalik parol bir marta ko'rsatiladi (yoki Excel hisobotida bir marta yuklab olinadi), `mustChangePassword = true`.
- Rollar (Q-39): SUPER_ADMIN, SCHOOL_ADMIN, DIRECTOR, DEPUTY_DIRECTOR, METHODIST, TEACHER, CLASS_TEACHER, STUDENT, GUARDIAN. Ruxsat matritsasini `docs/architecture/rbac-matrix.md` ga jadval qilib yoz — 7-qadamdan oldin men ko'rib chiqaman.
- Seed va staging — **faqat sun'iy ma'lumot** (Q-30). Haqiqiy ism-familiyalarga o'xshamagan, aniq "demo" deb belgilangan generator.
- Staging deploy (8-qadam) uchun Render/Supabase'da men hisob ochaman. Sen `render.yaml`, `.env.example` va `docs/DEPLOY.md` (qadamma-qadam) tayyorla; secret'larni so'rama va kiritma.

## 3. Ish tartibi

- `implementation-plan.md` dagi 8 qadam bo'yicha. Har qadam — alohida branch (`m1/01-scaffold`, ...) va bir yoki bir nechta commit, oxirida `main` ga merge.
- Har qadam oxirida: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` o'tadi; qadamning "qanday tekshiriladi" bandi bajarilgan.
- Har qadamdan keyin menga 5–10 qatorlik qisqa hisobot va davom et.
- **To'xtab ruxsat so'ra:** (a) 2-qadamdan keyin — birinchi migratsiya SQL'ini ko'rsat; (b) 7-qadamdan oldin — `rbac-matrix.md`; (c) 8-qadamda deploy'dan oldin.
- Noaniq narsa chiqsa — default bilan davom et va `open-questions.md` ga yoz; spec talabini olib tashlash kerak bo'lsa — so'ra.

## 4. M1 acceptance (ROADMAP)

- Admin Excel orqali 300 o'quvchi va 40 o'qituvchini xatolarni preview'da ko'rib import qila oladi.
- O'qituvchi faqat o'z sinf/fanlarini, vasiy faqat o'z farzandini ko'radi (API testlari bilan).
- Tenant isolation testlari o'tadi.
- Brending rangini o'zgartirish butun UI'ni yangilaydi; LIGHT/DARK/SYSTEM ishlaydi.
- Barcha UI matnlari `uz` va `ru` da.

Oxirida `docs/progress/M1.md` (acceptance ✅/❌, testlar, qolgan muammolar). M2 ga o'zing o'tma.
