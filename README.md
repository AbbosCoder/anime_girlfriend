# 🌸 Aiko — siz bilan gaplashadigan 3D anime qiz

- **3D VRM model** (three.js + three-vrm): sochlari va kiyimi fizika bilan tebranadi (spring bones),
  ko'zlari pirpiraydi, sizga (sichqonchaga) qaraydi, nigohi tabiiy yuguradi, nafas oladi.
- **Mimika**: quvonch, xafalik, jahl, hayrat, uyalish, o'ylash — gap mazmuniga qarab o'zi tanlaydi.
- **Tana harakatlari**: bosh irg'ash, bosh chayqash, qo'l silkitish, uyalish, iyakni ushlab o'ylash, arazlab qo'l chalishtirish, ta'zim, sakrash.
- **Ovoz**: Gemini TTS, har bir javobda ohangni o'zi tanlaydi (quvnoq / uyalib / jahl bilan...). Lab harakati ovozga sinxron.
- **Mikrofon**: gapiring — Gemini ovozingizni o'zi tushunadi (o'zbekcha ham). Klaviaturada **Space**ni bosib turib gapirish mumkin.
- **Xarakter**: o'z fikri, kayfiyati, o'ziga xos so'zlari bor. Siz haqingizda eslab qoladi. Uzoq jim tursangiz, o'zi gap boshlaydi. Boshini bossangiz (headpat) — uyaladi 😳.

## Kompyuterda ishga tushirish

1. `.env` fayliga Gemini kalitingizni yozing:
   ```
   GEMINI_API_KEY=AIza...
   ```
2. ```bash
   npm install
   ```
3. ```bash
   npm run dev
   ```
4. Brauzerda: http://localhost:3000

## Serverga joylash (Ubuntu + domen)

Serverda Node.js 22+ bo'lishi kerak.

```bash
# 1) papkani serverga ko'chiring (node_modules siz), masalan:
scp -r anime_girlfriend user@SERVER_IP:/opt/aiko

# 2) serverda:
cd /opt/aiko
npm ci
npm run build
nano .env            # GEMINI_API_KEY=... yozing
sudo npm i -g pm2
pm2 start "npm start" --name aiko
pm2 save && pm2 startup
```

**Nginx + HTTPS** (mikrofon faqat HTTPS'da ishlaydi!):

```nginx
# /etc/nginx/sites-available/aiko
server {
    server_name aiko.sizningdomen.uz;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/aiko /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d aiko.sizningdomen.uz
```

Domen DNS'ida `A` yozuvi server IP'siga qaratilgan bo'lishi kerak.

## Boshqa qiz modeli

Hozirgi model — three-vrm namunaviy modeli (sinov uchun). O'zingizniki uchun:
- **VRoid Studio** (bepul) — o'zingiz chiroyli anime qiz yaratasiz va `.vrm` eksport qilasiz.
- **VRoid Hub** (hub.vroid.com) — tayyor modellar; litsenziyasi yuklab olish/ishlatishga ruxsat berganlarini tanlang.

Faylni `public/models/girl.vrm` o'rniga qo'ying yoki sayt sozlamalaridan (⚙) yuklang / ekranga sudrab tashlang.

## Sozlash

- Xarakter, ism, gapirish uslubi: `server.js` dagi `PERSONA`.
- Modellar: `.env` da `CHAT_MODEL`, `TTS_MODEL`, `VOICE` (Leda, Kore, Aoede, Zephyr...).
- Harakatlar: `src/avatar.js` dagi `GESTURES`.

> Eslatma: Gemini TTS o'zbek tilini rasmiy ro'yxatda ko'rsatmaydi — talaffuz biroz aksentli bo'lishi mumkin. Ovozni sozlamalardan o'zgartirib ko'ring.
