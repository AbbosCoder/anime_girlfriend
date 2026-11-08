# 🌸 Aiko — ishdan charchab kelgan odamni kutib oladigan 3D anime qiz

Pullik sayt + Telegram bot. Foydalanuvchi bot orqali ro'yxatdan o'tadi, kartaga to'lab chekni yuboradi, admin tasdiqlaydi —
keyin saytda (yoki Telegram ichida) o'zi tanlagan qiz bilan ovoz chiqarib gaplashadi.

## Imkoniyatlar

- **3 ta personaj**: Aiko (muloyim), Yuki (quvnoq), Rin (tsundere). Har birining rasmi, xarakteri, ovozi bor.
- **3D VRM model**: sochlari fizika bilan tebranadi, ko'zlari pirpiraydi va sizga qaraydi, nafas oladi, mimika va tana harakatlari gapga mos.
- **Ovozli suhbat**: mikrofon doim yoqiq — shunchaki gapirasiz. U gapirayotganda gap boshlasangiz — darhol to'xtab, tinglaydi.
  `gemini-3.5-flash` (fikrlash) + `gemini-3.8-flash-tts` (o'zbekchani rasman qo'llaydigan ovoz). Birinchi so'z ~2–2,5 soniyada.
- **Xotira**: ismingiz, ishingiz, muammolaringiz eslab qolinadi; har kun suhbat xulosasi saqlanadi va ertasi kuni o'zi so'raydi
  ("kecha aytgan taqdimoting qanday o'tdi?").
- **Psixolog kabi**: tinglaydi, his-tuyg'uni tan oladi, tinchlantiruvchi nafas mashqlarini qildiradi. Xavfli holatda haqiqiy yordamga (103, yaqinlar, mutaxassis) undaydi.
- **Telegram bot**: ro'yxatdan o'tish, Mini App, brauzer uchun shaxsiy kirish havolasi, obuna (kartaga qo'lda to'lov, admin tasdiqlaydi), tugashidan oldin eslatma.

## Kompyuterda ishga tushirish

1. `.env` faylida `GEMINI_API_KEY` ni yozing (`.env.example` ga qarang).
2. ```bash
   npm install
   ```
3. ```bash
   npm run dev
   ```
4. http://localhost:3000

`BOT_TOKEN` bo'sh bo'lsa — **sinov rejimi**: kirish va to'lovsiz, bitta test foydalanuvchi bilan ishlaydi.

## Telegram botni ulash

1. @BotFather → `/newbot` → tokenni `.env` dagi `BOT_TOKEN` ga yozing.
2. O'z Telegram ID'ingizni @userinfobot dan bilib, `ADMIN_IDS` ga yozing (bir nechta bo'lsa vergul bilan).
3. `PRICE`, `CARD_NUMBER`, `CARD_HOLDER`, `SUB_DAYS` ni to'ldiring.
4. `PUBLIC_URL` — saytning to'liq HTTPS manzili. HTTPS bo'lsa, botda "🌸 Ochish" tugmasi Telegram ichida Mini App bo'lib ochiladi.

**To'lov jarayoni:** foydalanuvchi "💳 Obuna olish" → karta raqamini ko'radi → pul o'tkazadi → chek skrinshotini botga yuboradi →
chek adminga "✅ Tasdiqlash / ❌ Rad etish" tugmalari bilan keladi → tasdiqlansa obuna `SUB_DAYS` kunga ochiladi va foydalanuvchiga kirish havolasi boradi.

**Admin buyruqlari (botda):** `/stats` — statistika, `/give <user_id> <kun>` — qo'lda obuna berish.

## Serverga joylash — Docker (tavsiya)

```bash
# serverda, /opt/aiko papkasida (kod + .env):
docker compose up -d --build      # yig'ish va ishga tushirish
docker compose logs -f            # loglar
docker compose restart            # qayta ishga tushirish
```

Konteyner `172.17.0.1:8094` da ishlaydi (xotira chegarasi 512 MB), baza `./data` papkasida.
Tashqariga HTTPS orqali serverdagi Caddy chiqaradi:

```
aiko.sizningdomen.uz {
    reverse_proxy 172.17.0.1:8094
}
```

## Serverga joylash — Docker'siz (Ubuntu + domen)

Serverda **Node.js 22.13+** (tavsiya: 24) bo'lishi kerak.

```bash
# papkani serverga ko'chiring (node_modules, data siz), so'ng:
cd /opt/aiko
npm ci
npm run build
nano .env            # kalitlar, BOT_TOKEN, ADMIN_IDS, PUBLIC_URL, karta
sudo npm i -g pm2
pm2 start "npm start" --name aiko
pm2 save && pm2 startup
```

**Nginx + HTTPS** (mikrofon va Mini App faqat HTTPS'da ishlaydi):

```nginx
# /etc/nginx/sites-available/aiko
server {
    server_name aiko.sizningdomen.uz;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;                     # /live WebSocket uchun shart
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/aiko /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d aiko.sizningdomen.uz
```

Ma'lumotlar bazasi: `data/aiko.db` — uni muntazam zaxiralang (backup).

## Personajlar va modellar

- 3D modellar: `public/models/aiko.vrm`, `yuki.vrm`, `rin.vrm`. Fayl bo'lmasa — umumiy `public/models/girl.vrm` ishlatiladi.
- Karta rasmlari: `public/characters/aiko.jpg` (yoki .png/.webp). Bo'lmasa — rasm 3D modeldan avtomatik chiziladi.
- Xarakter matnlari, ovozi, ismi: `lib/characters.js`.
- Model faqat **.vrm** formatida bo'lishi kerak (FBX/OBJ/BLEND to'g'ridan-to'g'ri ishlamaydi).
  Eng oson yo'l — **VRoid Studio** (bepul): unda yaratilgan qizning ko'z qisishi, lab harakati, mimikasi va soch fizikasi tayyor bo'ladi.
  Sayt pullik bo'lgani uchun boshqa joydan olingan modelning litsenziyasi **tijoriy foydalanishga** ruxsat berishini tekshiring.

## Ovoz: Gemini yoki Azure

| | Gemini (`TTS_PROVIDER=gemini`) | Azure (`TTS_PROVIDER=azure`) |
|---|---|---|
| Ovoz | Anime qizdek, hissiy | O'zbek tilida tug'ma gapiradigan ovoz (Madina), oddiyroq |
| Limit | Tier 1: kuniga ~100 javob | Bepul: oyiga 500 000 belgi (~5 000 javob) |

**Azure kalitini olish (bepul):**
1. portal.azure.com — Microsoft akkaunt bilan kiring (ro'yxatdan o'tishda karta so'raladi, bepul tarifda pul yechilmaydi).
2. "Create a resource" → **Speech** (Azure AI Speech) → Region: **West Europe** → Pricing tier: **Free F0** → Create.
3. Yaratilgan resurs → **Keys and Endpoint** → **KEY 1** ni nusxalang.
4. `.env` da: `TTS_PROVIDER=azure`, `AZURE_SPEECH_KEY=<KEY 1>`, `AZURE_SPEECH_REGION=westeurope` → serverni qayta ishga tushiring.

## Sozlash

- Modellar: `.env` da `CHAT_MODEL`, `THINKING`, `TTS_MODEL`. Tezroq ovoz kerak bo'lsa: `TTS_MODEL=gemini-3.8-flash-lite-tts`.
- O'z ovozini karnaydan eshitib to'xtab qolsa — sayt sozlamalarida "Gapni bo'lish sezgirligi"ni oshiring yoki quloqchin taqing.
- Harakatlar: `src/avatar.js` dagi `GESTURES`.
