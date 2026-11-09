# M7 — Vasiy portali va Telegram: reja

Qarorlar: `open-questions.md` T-87…T-95, ochiq savollar Q-56…Q-58.

## Komponentlar

| Qism | Joy | Vazifa |
|---|---|---|
| Webhook | `apps/api/src/modules/telegram/webhook.routes.ts` | `POST /telegram/webhook` (public, secret header). `TelegramUpdate` + outbox, darhol `200` |
| Bot | `modules/telegram/bot.ts` (worker) | `/start [kod]`, kontakt, `/unlink`, `/help`; javoblar `TelegramClient` orqali |
| Bog'lash | `modules/telegram/linking.service.ts` | kontakt → telefon mosligi, bir martalik kod, uzish; audit; Telegram sessiyalarini bekor qilish |
| Mini App kirish | `modules/telegram/webapp-auth.ts`, `POST /auth/telegram` | `initData` HMAC, `TELEGRAM` sessiya (bearer) |
| Bildirishnomalar | `modules/notifications/*` | `Notification` (dedupe), sozlamalar, tinch soatlar, cheklov, render (uz/ru), yetkazish; SMS interfeysi |
| Worker | `worker/index.ts` | `telegram` (update), `notifications` (deliver, limiter 25/s), maintenance: kunlik xulosa, past davomat |
| Admin UI | `/admin/telegram` | bog'lanish holati, kod berish, uzish, ommaviy xabar (preview → tasdiq → tarix), sozlamalar |
| Portal | `/me` (vasiy) | xabar sozlamalari, tinch soatlar, Telegram holati |
| Mini App | `/tg` | `initData` → token → mavjud portal sahifalari (bearer rejimi, Telegram mavzusi) |

## Oqimlar

1. **Kod bilan bog'lash:** admin `/admin/telegram` → "Kod berish" → kod va `t.me/<bot>?start=<kod>` bir marta ko'rinadi → vasiy havolani ochadi → bot `/start <kod>` → worker kodni tekshiradi (hash, muddat, bir marta) → `TelegramLink` → "Bog'landi" xabari va Mini App tugmasi.
2. **Kontakt bilan:** `/start` → "Kontaktni yuborish" tugmasi → kontakt (o'ziniki) → telefon bitta vasiyga mos → bog'lanadi.
3. **Mini App:** bot menyu tugmasi → `/tg#tgWebAppData=…` → `POST /auth/telegram` → bearer tokenlar (sessionStorage) → `/home`.
4. **Kelish:** terminal hodisasi → `recomputeDay` (bugun, `firstInAt` paydo bo'ldi) → outbox `notify.attendance` → worker → har bir vasiy uchun `Notification` (dedupe `arrival:<o'quvchi>:<sana>`) → tinch soat/cheklov → Telegram.

## Ma'lumotlar (yangi migratsiya `20261113090000_m7_telegram`)

`TelegramLink`, `TelegramLinkCode`, `TelegramUpdate`, `NotificationSettings`, `NotificationPreference`, `Notification`, `Broadcast`. Yangi ruxsatlar: `telegram.manage`, `notifications.broadcast`.
