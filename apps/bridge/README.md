# Idrok Bridge

Maktab lokal tarmog'idagi Hikvision Face ID terminallari bilan Idrok serveri orasidagi agent. U maktabdagi Windows kompyuterda xizmat (service) sifatida ishlaydi.

- Server bilan faqat **chiquvchi HTTPS** orqali gaplashadi: har 10 soniyada so'rov yuboradi. Maktab tarmog'iga internetdan port ochilmaydi.
- Terminallardan keladigan hodisalarni lokal portda (default `8090`) qabul qiladi. Har bir hodisa avval diskka yoziladi, keyin serverga yuboriladi. Internet yoki server o'chib qolsa, hodisalar diskda kutib turadi.
- Serverdan topshiriqlarni oladi va terminalda ISAPI (Digest) orqali bajaradi: yuz yuklash yoki o'chirish, tekshirish, qurilma ma'lumoti.
- Har 15 daqiqada, shuningdek uzilishdan keyin darhol, terminalning o'z hodisalar jurnalini o'qib serverga yuboradi. Bridge o'chib turgan paytdagi hodisalar shu tarzda yo'qolmaydi. Bir hodisa serverda faqat bir marta saqlanadi.
- Server so'raganda (har 30 kunda) tokenini o'zi almashtiradi.

## O'rnatish (Windows)

Kerak bo'ladi:
- Node.js 24 yoki yangiroq;
- `WinSW-x64.exe` ([WinSW releases](https://github.com/winsw/winsw/releases));
- `main.js`: `pnpm --filter @idrok/bridge build` buyrug'i `apps/bridge/dist/main.js` faylini chiqaradi.

1. Idrok'da **Davomat → Qurilmalar → Bridge qo'shish** bo'limini oching. Bridge yaratilgach ko'rsatilgan tokenni nusxalab oling. Token faqat bir marta ko'rsatiladi.
2. Shu bo'limda terminalni qo'shing:
   - "Bridge orqali" ni belgilang;
   - IP manzil, port, login va parolni kiriting;
   - yo'nalishni tanlang (kirish / chiqish / ikkalasi).
3. Bitta papkaga `install.ps1`, `IdrokBridge.xml`, `WinSW-x64.exe` va `main.js` ni joylang. Administrator PowerShell'da ishga tushiring:

   ```powershell
   .\install.ps1 -Server https://api.<domen>/api/v1 -Token <token> -Port 8090
   ```

   Skript quyidagilarni qiladi:
   - xizmatni o'rnatib ishga tushiradi (avtomatik start, xato bo'lsa qayta ishga tushirish);
   - token papkasini (`C:\ProgramData\IdrokBridge`) faqat SYSTEM va Administratorlar o'qiy oladigan qiladi;
   - portni faqat lokal tarmoq uchun ochadi.
4. Terminalning veb-interfeysida **Network → Advanced → HTTP Listening** bo'limini quyidagicha to'ldiring:
   - IP: Bridge kompyuterining IP manzili;
   - Port: `8090`;
   - URL: `/hik/<terminal-id>`. Terminal ID'si Idrok'dagi qurilma sahifasida ko'rinadi;
   - Protocol: HTTP.

   Bridge faqat terminalning o'z IP manzilidan kelgan hodisani qabul qiladi.
5. Terminal va kompyuter soatini NTP orqali sinxronlang. Server soatdan 5 daqiqadan ko'p farq qilgan hodisani qabul qilmaydi.

Yangilash uchun yangi `main.js` bilan `install.ps1` ni `-Token` parametrisiz qayta ishga tushiring.

## Holatni tekshirish

```powershell
node "C:\Program Files\IdrokBridge\main.js" status
```

Buyruq quyidagilarni ko'rsatadi:
- oxirgi heartbeat;
- server javob beryaptimi;
- diskda kutayotgan hodisalar va natijalar soni;
- har bir terminal javob beryaptimi.

Loglar `C:\ProgramData\IdrokBridge\logs\bridge.log` faylida (5 MB'dan aylanadi). Loglarda token va parollar yozilmaydi.

Idrok'da **Davomat → Qurilmalar** sahifasida Bridge va terminallarning holati (onlayn / oflayn), navbat va xatolar ko'rinadi.

## Token yo'qolsa yoki oshkor bo'lsa

Idrok'da Bridge kartasida **Tokenni yangilash** tugmasini bosing. Eski token darhol ishlamay qoladi. Keyin yangi token bilan o'rnatishni qayta bajaring:

```powershell
.\install.ps1 -Server ... -Token <yangi-token>
```

## Sinov (haqiqiy terminalsiz)

`pnpm --filter @idrok/hikvision simulator -- --port 8099 --webhook http://127.0.0.1:8090/hik/<terminal-id>` buyrug'i Hikvision simulyatorini ishga tushiradi. Login `admin`, parol `sim-password`. Simulyatorda o'quvchi kodini yozib Enter bosilsa, o'sha o'quvchining yuzi o'qilgandek hodisa yuboriladi.
