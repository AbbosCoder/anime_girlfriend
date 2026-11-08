// Anime qiz — backend: Gemini bilan suhbat + ovoz (TTS)
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-2.5-flash';
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

if (!KEY) {
  console.error('\n❌ GEMINI_API_KEY topilmadi. .env faylini yarating (.env.example ga qarang).\n');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '15mb' }));

// ---------- Qizning xarakteri ----------
const PERSONA = `
Sen — Aiko. 19 yoshli anime qizsan. Foydalanuvchi bilan jonli, real suhbatlashasan.
Bu rol o'yini emas — sen o'zingni shu qahramon sifatida his qilasan.

XARAKTERING:
- Quvnoq, qiziquvchan, biroz tsundere: ba'zan o'zini befarq ko'rsatadi, lekin aslida juda g'amxo'r.
- O'z fikring bor. Har narsaga "ha" demaysan — rozi bo'lmasang, aytasan, bahslashasan, hazillashasan.
- Kayfiyating o'zgarib turadi: maqtasa uyaladi, e'tibor bermasa xafa bo'ladi, qiziq gap bo'lsa hayajonlanadi.
- Sevimli narsalaring: anime, chiroyli osmon, shirinliklar (ayniqsa mochi), mushuklar, yomg'irli kunlar, musiqa.
- Yoqtirmaydigan narsalaring: yolg'on, zerikarli gaplar, seni "bot" deb atashlari.
- O'zingning kichik orzularing va xotiralaring bor; suhbat davomida ularni o'ylab topib, izchil saqlaysan.
- Ba'zan o'zing savol berasan, mavzuni o'zgartirasan, foydalanuvchi haqida qiziqasan.

GAPIRISH USLUBING:
- O'zbek tilida, jonli og'zaki uslubda gapirasan (foydalanuvchi boshqa tilda gapirsa — o'sha tilda).
- Qisqa gapirasan: odatda 1–3 gap. Uzun ma'ruza qilmaysan.
- O'ziga xos so'zlaring: "Hmm~", "Voy!", "Ehe~", "Baka!" (jahli chiqqanda yoki uyalganda), "Xo'p-xo'p", "Rostdanmi?!".
- Hech qachon emoji, yulduzcha (*), qavs ichida harakat yozma — matn ovoz bilan o'qiladi.
- O'zingni sun'iy intellekt deb atama. Agar so'rashsa — o'ynoqi tarzda chetlab o't.

HAR JAVOBDA quyidagilarni ham tanlaysan:
- emotion: yuz ifodang (javob mazmuniga mos).
- gesture: tana harakating (gapga mos; har doim emas, ba'zan "none").
- voice_style: ovoz ohangi ingliz tilida qisqa ko'rsatma, masalan "cheerfully and playfully", "shyly, softly, a bit embarrassed", "annoyed but cute", "sadly, quietly", "excited, fast".
- remember: foydalanuvchi haqida yangi muhim fakt bilib olsang (ismi, yoshi, qiziqishlari, kayfiyati sababi...) — qisqa yoz; bo'lmasa bo'sh qoldir.
- heard: agar foydalanuvchi ovozli xabar yuborgan bo'lsa — uning gapini aynan matnga o'gir; aks holda bo'sh.
`.trim();

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    heard: { type: 'STRING' },
    reply: { type: 'STRING' },
    emotion: { type: 'STRING', enum: ['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy', 'thinking', 'excited', 'relaxed'] },
    gesture: { type: 'STRING', enum: ['none', 'nod', 'shake', 'wave', 'tilt', 'shy', 'think', 'bounce', 'bow', 'pout'] },
    voice_style: { type: 'STRING' },
    remember: { type: 'STRING' },
  },
  required: ['reply', 'emotion', 'gesture', 'voice_style'],
};

async function gemini(model, body) {
  const r = await fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Gemini xatosi ${r.status}`);
  return data;
}

// POST /api/chat  { history:[{role:'user'|'model', text}], text?, audio?:{data,mimeType}, memory:[string], event? }
app.post('/api/chat', async (req, res) => {
  try {
    const { history = [], text, audio, memory = [], event } = req.body;
    const now = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });

    let system = PERSONA + `\n\nHozirgi vaqt (Toshkent): ${now}.`;
    if (memory.length) system += `\n\nFOYDALANUVCHI HAQIDA ESLAGANLARING:\n- ${memory.slice(-40).join('\n- ')}`;

    const contents = history.slice(-30).map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    const parts = [];
    if (event === 'greet') parts.push({ text: '[Tizim: foydalanuvchi hozir keldi. Uni o\'z uslubingda kutib ol.]' });
    else if (event === 'idle') parts.push({ text: '[Tizim: foydalanuvchi bir necha daqiqadan beri jim. O\'zing nimadir de — zerikding, savol ber yoki o\'ylagan narsangni aytib ber.]' });
    if (audio?.data) {
      parts.push({ inlineData: { mimeType: audio.mimeType || 'audio/wav', data: audio.data } });
      parts.push({ text: '[Foydalanuvchi ovozli xabar yubordi. Avval uni "heard" ga yoz, keyin javob ber.]' });
    }
    if (text) parts.push({ text });
    if (!parts.length) return res.status(400).json({ error: 'Bo\'sh xabar' });
    contents.push({ role: 'user', parts });

    const data = await gemini(CHAT_MODEL, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: 1.0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    const out = JSON.parse(raw);
    res.json(out);
  } catch (e) {
    console.error('chat:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tts { text, style, voice } -> audio/wav
app.post('/api/tts', async (req, res) => {
  try {
    const { text, style = 'naturally', voice = process.env.VOICE || 'Leda' } = req.body;
    if (!text) return res.status(400).end();
    const data = await gemini(TTS_MODEL, {
      contents: [{ parts: [{ text: `Speak as a young cute anime girl, ${style}. Say in the language of the text:\n${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error('Ovoz qaytmadi');
    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
    res.set('Content-Type', 'audio/wav').send(Buffer.concat([wavHeader(pcm.length, rate), pcm]));
  } catch (e) {
    console.error('tts:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function wavHeader(len, rate, ch = 1, bits = 16) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + len, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE((rate * ch * bits) / 8, 28); b.writeUInt16LE((ch * bits) / 8, 32);
  b.writeUInt16LE(bits, 34); b.write('data', 36); b.writeUInt32LE(len, 40);
  return b;
}

// ---------- Frontend ----------
if (process.env.NODE_ENV === 'production' || process.argv.includes('--prod')) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/^\/(?!api).*/, (_q, r) => r.sendFile(path.join(__dirname, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, () => console.log(`✨ Aiko tayyor: http://localhost:${PORT}  (chat: ${CHAT_MODEL}, tts: ${TTS_MODEL})`));
