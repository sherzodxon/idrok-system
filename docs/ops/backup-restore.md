# Zaxira nusxa va tiklash (runbook)

Audit topilmasi (Critical): haqiqiy ma'lumot VPS'ga kelishidan oldin zaxira va tiklash tartibi bo'lishi shart.
Hozir (Render + Supabase, faqat demo ma'lumot) Supabase'ning o'z kunlik zaxirasi yetarli; quyidagi tartib **VPS** uchun.

## Nima zaxiralanadi

| Nima | Qanday | Qayerda |
|---|---|---|
| PostgreSQL | `scripts/backup/backup.sh` — `pg_dump` (custom format) → `age` bilan shifrlangan | `BACKUP_DIR` (server) + `BACKUP_REMOTE` (off-site, rclone) |
| Fayllar (import fayllari, shifrlangan yuz rasmlari) | o'sha skript, `BACKUP_FILES_DIR` berilsa — `tar` → `age` | o'sha joylar |
| `DATA_ENCRYPTION_KEY` | **qo'lda, bir marta**: parol menejeri + qog'ozdagi nusxa seyfda | serverdan tashqarida |
| `age` maxfiy kaliti | **qo'lda**: zaxirani faqat u ochadi | serverda **saqlanmaydi** |

`DATA_ENCRYPTION_KEY` yo'qolsa, zaxiradan tiklangan yuz rasmlari va qurilma parollarini o'qib bo'lmaydi (ularni qayta yuklash kerak bo'ladi). `age` maxfiy kaliti yo'qolsa, zaxiraning o'zini ochib bo'lmaydi.

## Bir martalik sozlash (VPS)

1. Asboblar: `postgresql-client` (server versiyasi bilan bir xil yoki yangi), `age`, `rclone` (off-site uchun).
2. Kalit juftligi: boshqa kompyuterda `age-keygen -o idrok-backup.key`. Ochiq kalit (`age1...`) — serverdagi `BACKUP_AGE_RECIPIENT`. Maxfiy kalit — parol menejeri va seyf.
3. Faqat o'qiydigan DB roli: `CREATE ROLE idrok_backup LOGIN PASSWORD '…'; GRANT pg_read_all_data TO idrok_backup;` → `BACKUP_DATABASE_URL` (pooler emas, to'g'ridan-to'g'ri ulanish).
4. Off-site: rclone remote (masalan, Backblaze B2 yoki S3), bucket'da 90 kunlik lifecycle qoidasi. `BACKUP_REMOTE=b2:idrok-backups/db`.
5. Env fayl (`/etc/idrok/backup.env`, `chmod 600`, egasi backup foydalanuvchisi):

   ```
   BACKUP_DATABASE_URL=postgresql://idrok_backup:…@127.0.0.1:5432/idrok
   BACKUP_DIR=/var/backups/idrok
   BACKUP_AGE_RECIPIENT=age1…
   BACKUP_KEEP_DAYS=14
   BACKUP_REMOTE=b2:idrok-backups/db
   BACKUP_FILES_DIR=/var/lib/idrok/storage
   ```

6. Cron (Toshkent vaqti bilan 02:30, tungi tozalash 03:00 dan oldin):

   ```
   30 2 * * * set -a; . /etc/idrok/backup.env; set +a; /opt/idrok/scripts/backup/backup.sh >> /var/log/idrok-backup.log 2>&1
   ```

7. Monitoring: `ALERT_WEBHOOK_URL` ga ulangan kanalga zaxira jurnalini ham yo'naltirish (masalan, `cron` xatosi bo'lsa xabar). Kamida haftada bir marta off-site'da yangi fayl borligini tekshirish.

## Oylik tiklash mashqi (majburiy)

Zaxira tiklanmaguncha zaxira hisoblanmaydi. Har oyning birinchi dushanbasi:

1. Bo'sh vaqtinchalik baza yarating (production serveridan alohida bo'lsa yaxshi): `createdb idrok_restore_test`.
2. Oxirgi off-site faylni yuklab oling (`rclone copy …`), maxfiy kalitni vaqtincha olib keling.
3. Tiklang:

   ```
   RESTORE_DATABASE_URL=postgresql://…/idrok_restore_test \
   BACKUP_AGE_IDENTITY=./idrok-backup.key \
   PRODUCTION_DATABASE_URL="$DIRECT_URL" \
   scripts/backup/restore.sh idrok-db-20261201T213000Z.dump.age
   ```

4. Solishtiring: `psql … -f scripts/backup/verify.sql` ni tiklangan va jonli bazada ishga tushiring. Sonlar va ledger yig'indilari (`score sum`, `coin sum`) zaxira vaqtigacha bir xil bo'lishi kerak. Faqat sonlar chiqadi, shaxsiy ma'lumot chiqmaydi.
5. Natijani yozing (sana, fayl, tiklash vaqti, mos/mos emas) va vaqtinchalik bazani hamda maxfiy kalit nusxasini o'chiring.

`verify.sql` joriy sxemada ishlashini `packages/db/test/backup-verify.test.ts` har CI'da tekshiradi.

## Halokatdan tiklash

1. Ilovani to'xtating (API va worker), foydalanuvchilarga xabar bering.
2. Yangi bo'sh baza yarating; oxirgi zaxirani yuqoridagidek tiklang. Production bazasining ustiga tiklash faqat `CONFIRM_PRODUCTION_RESTORE=yes` bilan va egasining yozma roziligi bilan.
3. Fayllar zaxirasini `BACKUP_FILES_DIR` ga oching: `age -d -i key idrok-files-….tar.age | tar -xz -C /var/lib/idrok/storage`.
4. `DATA_ENCRYPTION_KEY` ni avvalgi qiymatiga qo'ying (aks holda yuzlar o'qilmaydi).
5. `pnpm --filter @idrok/db migrate:deploy` (faqat yangi migratsiyalar; `migrate reset` taqiqlangan).
6. Ilovani yoqing, smoke tekshiruv (`docs/DEPLOY.md` §6), keyin terminallarga yuzlarni qayta yuborish (Qurilmalar → "Hamma yuzlarni yuborish").
7. Zaxira vaqtidan keyingi o'zgarishlar yo'qoladi (RPO ≈ 24 soat). Terminallar o'z jurnalidan oxirgi 7 kunni Bridge orqali qayta yuboradi — davomat tiklanadi.

## Cheklovlar (hozirgi holat)

- Skriptlar lokal muhitda oxirigacha sinalmagan: bu yerda `pg_dump`, `pg_restore` va `age` yo'q. Faqat sintaksis (`bash -n`) va `verify.sql` (db testi) tekshirilgan. Birinchi haqiqiy sinov — VPS'dagi birinchi tiklash mashqi.
- Zaxira kuniga bir marta (RPO ≈ 24 soat). Kamroq yo'qotish kerak bo'lsa — WAL arxivlash (pgBackRest), alohida qaror.
