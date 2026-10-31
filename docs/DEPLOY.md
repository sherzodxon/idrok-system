# Deploy (Render + Supabase)

> To'liq qadamma-qadam yo'riqnoma M1 8-qadamda yoziladi. Hozir — xavfsizlikka oid majburiy sozlamalar.

## Klient IP va `TRUST_PROXY` (security-baseline.md S2)

API klient IP'sini **faqat** Express `trust proxy` orqali oladi (`req.ip`). `X-Forwarded-For`, `CF-Connecting-IP` kabi
sarlavhalar kodda qo'lda o'qilmaydi. Login rate limitining IP qismi shu IP'ga tayanadi, shuning uchun qiymat proxy
zanjiriga aniq mos bo'lishi kerak:

| Zanjir | `TRUST_PROXY` | Sabab |
|---|---|---|
| Lokal (proxy yo'q) | `0` (default) | `X-Forwarded-For`ni har kim yozishi mumkin — ishonilmaydi |
| Klient → Render load balancer → API | `1` | Render bitta proxy: u qo'shgan oxirgi `X-Forwarded-For` qiymati — haqiqiy klient IP. Klient o'zi yozgan qiymatlar chapda qoladi va e'tiborga olinmaydi |
| Klient → Cloudflare → Render → API | `2` | Ikki ishonchli hop. Cloudflare yoqilsa qiymat **albatta** o'zgartiriladi |
| Keyin: klient → Nginx (VPS) → API | `1` | Nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` bilan |

Noto'g'ri qiymat xavfi:
- **Kichik** (masalan Render ortida `0`): hamma so'rov load balancer IP'sidan keladi → IP limiti barcha foydalanuvchilarni birga sanaydi (30 xato urinishdan keyin hamma bloklanadi).
- **Katta** (masalan Render ortida `2`): hujumchi o'zi yozgan `X-Forwarded-For` qiymati "klient IP" bo'lib qoladi → IP limitini chetlab o'tadi. Username limiti baribir ishlaydi (u IP'ga bog'liq emas — `login-limits.test.ts`).

Staging'da tekshirish: ikki xil tarmoqdan (masalan uy Wi-Fi va mobil internet) bitta noto'g'ri username bilan 5 tadan urinib ko'ring — ikkala tarmoqda ham username limiti 6-urinishda ishlashi, lekin bir tarmoqdagi 30 ta urinish ikkinchi tarmoqni bloklamasligi kerak.

## Redis (Render Key Value)

`maxmemory-policy` = `noeviction` (BullMQ talabi). Boshqa siyosatda navbatdagi job'lar yo'qolishi mumkin.
