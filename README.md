# Idrok System — Claude Code uchun prompt to'plami

## Tarkib

| Fayl | Vazifasi |
|---|---|
| `CLAUDE.md` | Doimiy qoidalar. Claude Code har sessiyada avtomatik o'qiydi |
| `docs/ROADMAP.md` | Bosqichlar (M0–M8) va har birining scope/acceptance'i |
| `docs/spec/lesson-plan.md` | M2: kalendar, dars jadvali, kalendar-tematik reja |
| `docs/spec/scoring.md` | M3: ball engine, limitlar, davriy natija, 5 ballik shkala |
| `docs/spec/tests.md` | M4: savollar banki, online/offline/weighted test |
| `docs/MASTER_SPEC.md` | Dastlabki to'liq topshiriq (eskirgan qismlari boshida ko'rsatilgan) |
| `docs/prompts/M0-audit.md` | Birinchi ish uchun prompt |

Ziddiyat bo'lsa ustunlik tartibi: `CLAUDE.md` > `docs/spec/*` > `ROADMAP.md` > `MASTER_SPEC.md`.

## Qanday boshlash

1. Yangi GitHub repo oching va shu papka tarkibini ildizga joylashtiring.
2. Qo'shing:
   - `docs/references/registo-edextest-analysis.pdf`
   - `docs/references/design-reference.png`
3. Joylashuv: yangi repo `~/idrok-system`, EdexTest `~/Edex/EdexTest` (promptda yozilgan).
4. Claude Code'ni `idrok-system` ildizida EdexTest'ga ham ruxsat bilan oching — `cd ~/idrok-system && claude --add-dir ~/Edex/EdexTest` — va yozing:
   `docs/prompts/M0-audit.md dagi vazifani bajar.`
5. M0 natijalarini (`docs/architecture/`) ko'rib chiqing, `open-questions.md`ga javob bering, keyin M1 ga o'ting.

## Har bosqich uchun prompt shabloni

```
docs/ROADMAP.md dagi M<N> bosqichini bajar.
Spec: docs/spec/<fayl>.md
Oldingi bosqich hisoboti: docs/progress/M<N-1>.md
Avval qisqa reja yoz va kutib tur. Tasdiqlagandan keyin kichik qadamlar bilan ishla.
Oxirida lint/typecheck/test/build va docs/progress/M<N>.md.
```

## Ochiq savollar (M3 dan oldin maktab hal qilishi kerak)

- Choraklar sanalari, ta'tillar, ish kunlari (5 yoki 6 kunlik hafta).
- Bir dars uchun maksimal ball va kunlik/haftalik limitlar.
- Chorak tarkibi (kundalik va test nisbati), yarim yillik formulasi.
- Sababsiz kelmaganlik va qatnashilmagan test: 0 yoki hisobdan chiqarish.
- 5 ballik shkala kerakmi va oraliqlari.
- Dars rejasini kim tasdiqlaydi.
