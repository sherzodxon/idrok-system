# Xavfsizlik bazasini joriy etish (M1 ichida, 5-qadamdan oldin)

`docs/spec/security-baseline.md` yangi majburiy spec. Uni o'qi va quyidagilarni bajar. Alohida branch: `m1/04b-security-baseline`, har punkt alohida commit, oxirida `main`ga merge. Keyin M1 5-qadamdan davom et.

1. `CLAUDE.md`:
   - boshidagi "Batafsil talablar" qatoriga `docs/spec/security-baseline.md` (barcha bosqichlar uchun majburiy) havolasini qo'sh;
   - §4 "Xavfsizlik" bo'limiga qisqa qatorlar: "Default-deny: autentifikatsiyasiz route faqat `public-routes.ts` ro'yxatida, `route-guard.test.ts` buni tekshiradi"; "O'quvchi/vasiy DTO'larida to'g'ri javob ma'lumoti yo'q (S4)"; "Hech qaysi skript/log/API parolni qayta chiqarmaydi".

2. **S1 default-deny**:
   - `apps/api/src/http/public-routes.ts` — ochiq route'lar ro'yxati (hozir: healthz, readyz, auth login/refresh va hozir mavjud bo'lgan boshqa zarur auth route'lar — ro'yxatni menga hisobotda ko'rsat).
   - `apps/api/test/route-guard.test.ts` — app'dagi barcha route'larni avtomatik yig'adi (router stack yoki OpenAPI registry), ro'yxatda yo'q har biri token'siz `401`; har himoyalangan route permission metadata'siga ega (yo'q bo'lsa test yiqiladi — buning uchun `requirePermission` metadata qoldirishi kerak bo'lsa, shunga mosla).
   - Test ataylab ochiq qoldirilgan soxta route bilan yiqilishini bir marta tekshir (keyin olib tashla).

3. **S2 login**: hozirgi kod (username va IP mustaqil limit, umumiy xato, `TRUST_PROXY`) talabga mos — faqat yetishmayotgan testlarni qo'sh: `X-Forwarded-For`ni har so'rovda o'zgartirib bitta username'ga limit+1 urinish → 429; mavjud bo'lmagan user va noto'g'ri parol javobi bir xil (status, body). `docs/DEPLOY.md`ga Render uchun to'g'ri `TRUST_PROXY` qiymati va sababini yoz.

4. **S3 secret'lar**:
   - `config/env.ts`dagi barcha secret'lar default'siz majburiy ekanini test bilan tasdiqla.
   - `scripts/seed.ts`: admin parolini chiqarish faqat interaktiv terminalda (`process.stdout.isTTY`) va `NODE_ENV=production`da `--yes-i-understand` bayrog'isiz ishlamasin.
   - CI'ga `gitleaks` (yoki ekvivalent) qadami; `.gitignore` va `.env.example`ni tekshir.
   - Pino redact testi: password, token, refreshToken, authorization, cookie, apiKey, secret → `[Redacted]`.

5. **S7**: CI'ga `pnpm audit --prod` (yiqitmaydi, natijani chiqaradi). Hozirgi `pnpm-lock.yaml`da 14 kundan yangi versiyalar bo'lsa — ro'yxatini hisobotga yoz (o'zgartirmasdan).

S4–S6 — M4 va keyingi bosqichlarda spec'lar bo'yicha bajariladi; hozir kod yozma.

Oxirida: lint/typecheck/test/build o'tadi; `docs/progress/M1.md`ga "Xavfsizlik bazasi" bo'limi (S1–S3, S7 holati ✅/❌).
