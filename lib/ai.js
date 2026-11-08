// Suhbat zanjiri: (ovoz/matn) -> CHAT_MODEL (oqimli) -> TTS_MODEL (oqimli ovoz)
// Birinchi gap tayyor bo'lishi bilan ovoz boshlanadi. Gap bo'linsa — hammasi to'xtatiladi.
import * as DB from './db.js';
import { CHARACTERS, DEFAULT_CHARACTER, personaFor } from './characters.js';

const KEY = process.env.GEMINI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-3.5-flash';
const THINKING = process.env.THINKING || 'low';
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const API = 'https://generativelanguage.googleapis.com/v1beta';
export const MODELS = { CHAT_MODEL, get TTS_MODEL() { return TTS_INFO.model; } };
// true: birinchi gap alohida o'qiladi (tezroq, lekin 2 ta TTS so'rov). false: butun javob bitta so'rovda (limitni tejaydi, ohang bir tekis)
const SPLIT = process.env.TTS_SPLIT === 'true';
// eski javoblardagi taqiqlangan so'zlar yangi javoblarga "yuqmasligi" uchun
const scrub = (t) => t.replace(/Hmpf/gi, 'Hm').replace(/baka/gi, 'ahmoq').replace(/~/g, '');

const EMOTIONS = new Set(['neutral', 'happy', 'sad', 'angry', 'surprised', 'shy', 'thinking', 'excited', 'relaxed']);
const GESTURES = new Set(['none', 'nod', 'shake', 'wave', 'tilt', 'shy', 'think', 'bounce', 'bow', 'pout', 'laugh', 'bellylaugh', 'clap', 'cover', 'excited']);
export const VOICES = new Set(['Leda', 'Kore', 'Aoede', 'Zephyr', 'Callirrhoe', 'Despina', 'Laomedeia', 'Autonoe', 'Sulafat', 'Achernar', 'Vindemiatrix', 'Achird']);

async function* sse(res) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim();
        if (d && d !== '[DONE]') { try { yield JSON.parse(d); } catch {} }
      }
    }
  }
}

async function post(url, body, signal) {
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try { msg = JSON.parse(t).error?.message || t; } catch {}
    throw new Error(`${r.status}: ${msg.slice(0, 300)}`);
  }
  return r;
}

// Ovozga ketadigan matnni tozalash (talaffuz yaxshi bo'lishi uchun)
const APOS = process.env.TTS_APOSTROPHE || 'uzbek';
export function cleanForTts(t) {
  t = t.replace(/[~*_#]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\b[Bb]aka\b/g, 'ahmoq')
    .replace(/\s{2,}/g, ' ').trim();
  if (APOS === 'uzbek') {
    // o' g' -> oʻ gʻ (U+02BB), tutuq belgisi -> ʼ (U+02BC)
    t = t.replace(/([oOgG])['‘’`ʼ]/g, '$1ʻ').replace(/(\p{L})['’`](?=\p{L})/gu, '$1ʼ');
  }
  return t;
}

// Ovoz doim BITTA modeldan (personaj ovozi o'zgarmasligi uchun). TTS_FALLBACKS faqat ataylab yoqilsa ishlaydi.
const TTS_CHAIN = [TTS_MODEL, ...(process.env.TTS_FALLBACKS || '').split(',').map((s) => s.trim()).filter(Boolean)];
const cooldown = new Map();
// ---------- Microsoft Azure ovozi (o'zbek tilida tug'ma gapiradigan ovoz) ----------
const PROVIDER = (process.env.TTS_PROVIDER || 'gemini').toLowerCase();
const AZ_KEY = process.env.AZURE_SPEECH_KEY;
const AZ_REGION = process.env.AZURE_SPEECH_REGION || 'westeurope';
const AZ_VOICE = process.env.AZURE_VOICE || 'uz-UZ-MadinaNeural';
export const TTS_INFO = { provider: PROVIDER, model: PROVIDER === 'azure' ? AZ_VOICE : TTS_MODEL };
if (PROVIDER === 'azure' && !AZ_KEY) console.warn('⚠️ TTS_PROVIDER=azure, lekin AZURE_SPEECH_KEY yo\'q — ovoz ishlamaydi');

const xml = (s) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
async function azureTts(text, prosody = {}, signal, onAudio) {
  // <laugh>, <sigh> kabi teglar Azure'da yo'q — olib tashlaymiz
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!text) return;
  const { rate = '0%', pitch = '0%' } = prosody;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="uz-UZ"><voice name="${AZ_VOICE}"><prosody rate="${rate}" pitch="${pitch}">${xml(text)}</prosody></voice></speak>`;
  const r = await fetch(`https://${AZ_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', signal,
    headers: {
      'Ocp-Apim-Subscription-Key': AZ_KEY || '',
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
      'User-Agent': 'aiko-companion',
    },
    body: ssml,
  });
  if (!r.ok) throw new Error(`${r.status}: Azure ovoz xatosi ${(await r.text()).slice(0, 200)}`);
  // PCM16 bo'laklari juft baytda kesilishi kerak (aks holda shitirlaydi)
  let rest = Buffer.alloc(0);
  for await (const chunk of r.body) {
    const buf = Buffer.concat([rest, Buffer.from(chunk)]);
    const even = buf.length & ~1;
    if (even) onAudio(buf.subarray(0, even).toString('base64'));
    rest = buf.subarray(even);
  }
}

export async function tts(text, style, voice, signal, onAudio, character) {
  text = cleanForTts(text);
  if (!text) return;
  if (PROVIDER === 'azure') return azureTts(text, character?.azure, signal, onAudio);
  let lastErr;
  for (const model of TTS_CHAIN) {
    if ((cooldown.get(model) || 0) > Date.now()) continue;
    try {
      if (model.startsWith('gemini-2.')) {
        // eski modellar: generateContent; ko'rsatma matnga qo'shilmaydi (aks holda uni ham o'qib yuboradi)
        const r = await post(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        }, signal);
        for await (const ev of sse(r)) for (const p of ev.candidates?.[0]?.content?.parts || []) if (p.inlineData?.data) onAudio(p.inlineData.data);
        return;
      }
      const r = await post(`${API}/interactions?alt=sse`, {
        model,
        stream: true,
        store: false,
        input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: style || 'warm, natural young girl' }] }] }],
        response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 },
        generation_config: { speech_config: [{ voice }] },
      }, signal);
      for await (const ev of sse(r)) if (ev.delta?.data) onAudio(ev.delta.data);
      return;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      if (/^429/.test(e.message)) {
        // "retry in 13h29m17s" — shu vaqtgacha bu modelni qayta urinmaymiz
        const m = /retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(e.message);
        const wait = m ? ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000 : 60000;
        cooldown.set(model, Date.now() + Math.max(wait, 10000));
        console.warn(`⚠️ ${model} limitga tushdi — zaxira modelga o'tilmoqda`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Barcha ovoz modellari band');
}

async function generate(system, contents, maxOutputTokens = 400) {
  const r = await post(`${API}/models/${CHAT_MODEL}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5, maxOutputTokens, thinkingConfig: { thinkingLevel: THINKING } },
  });
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
}

function splitFirstSentence(text) {
  const m = /^(.{8,}?[.!?…~]+)(\s+|$)/s.exec(text);
  return m ? [m[1].trim(), text.slice(m[0].length)] : null;
}

const fmtDate = (ts) => new Date(ts).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} daqiqa`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} soat`;
  return `${Math.round(h / 24)} kun`;
}
function dayLabel(day) {
  const today = DB.dayOf(Date.now());
  const yesterday = DB.dayOf(Date.now() - DB.DAY);
  return day === yesterday ? `kecha (${day})` : day === today ? 'bugun' : day;
}

// O'tgan kunlarning suhbatlarini qisqa xulosaga aylantirish ("kecha nima deganini" eslash uchun)
export async function summarizePastDays(userId, character) {
  const days = DB.daysNeedingSummary(userId, character);
  for (const [day, rows] of days) {
    const transcript = rows.map((r) => `${r.role === 'user' ? 'U' : 'Qiz'}: ${r.text}`).join('\n').slice(-12000);
    try {
      const s = await generate(
        'Sen suhbat xulosasini yozuvchisan. Quyidagi suhbatdan foydalanuvchi haqida keyin eslash kerak bo\'lgan narsalarni o\'zbek tilida 2-5 qisqa gapda yoz: nima bo\'lgani, kayfiyati va sababi, rejalari, muammolari, keyingi safar so\'rab qo\'yish mumkin bo\'lgan narsalar. Faqat xulosa.',
        [{ role: 'user', parts: [{ text: transcript }] }],
      );
      if (s) DB.saveSummary(userId, character, day, s);
    } catch (e) { console.warn('xulosa:', e.message); }
  }
}

export class Conversation {
  constructor(ws, user) {
    this.ws = ws;
    this.user = user;
    this.character = CHARACTERS[user.character] ? user.character : DEFAULT_CHARACTER;
    const c = CHARACTERS[this.character];
    this.voice = VOICES.has(user.voice) ? user.voice : c.voice;
    this.turn = 0;
    this.abort = null;
  }

  send(obj) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  interrupt() {
    this.abort?.abort();
    this.abort = null;
    this.turn++;
  }

  systemText() {
    const u = this.user, ch = this.character;
    let s = personaFor(ch);
    s += `\n\nHOZIR: ${fmtDate(Date.now())} (Toshkent vaqti).`;
    s += `\nFoydalanuvchining Telegram'dagi ismi: ${u.first_name || 'noma\'lum'} (agar o'zi boshqa ism aytgan bo'lsa — o'shani ishlat).`;
    const mem = DB.getMemories(u.id, ch);
    if (mem.length) s += `\n\nFOYDALANUVCHI HAQIDA ESLAGANLARING:\n` + mem.map((m) => `- ${m.fact} (${DB.dayOf(m.ts)})`).join('\n');
    const sums = DB.getSummaries(u.id, ch);
    if (sums.length) s += `\n\nOLDINGI KUNLARDAGI SUHBATLARINGIZ XULOSASI (vaqti kelganda o'zing so'ra, qiziqib):\n` + sums.map((d) => `- ${dayLabel(d.day)}: ${d.summary}`).join('\n');
    return s;
  }

  async respond({ text, audio, event }) {
    this.interrupt();
    const turn = this.turn;
    const ctrl = new AbortController();
    this.abort = ctrl;
    const alive = () => turn === this.turn;
    const t0 = Date.now();
    const u = this.user, ch = this.character;

    if (event === 'greet') {
      await Promise.race([summarizePastDays(u.id, ch), new Promise((r) => setTimeout(r, 5000))]);
      if (!alive()) return;
      const last = DB.lastMessageTs(u.id, ch);
      text = last
        ? `[Tizim: foydalanuvchi qaytib keldi. Oxirgi suhbatingiz ${ago(Date.now() - last)} oldin bo'lgan. Uni o'z uslubingda iliq kutib ol; kerak bo'lsa oldingi gaplaringizdan birini eslab so'ra.]`
        : `[Tizim: foydalanuvchi siz bilan birinchi marta gaplashyapti. O'zingni qisqa tanishtir, uni iliq kutib ol va ismini so'ra.]`;
    } else if (event === 'idle') {
      text = '[Tizim: foydalanuvchi bir necha daqiqadan beri jim. O\'zing nimadir de — savol ber yoki o\'ylagan narsangni aytib ber.]';
    } else if (event === 'pat') {
      text = '[Tizim: foydalanuvchi sening boshingni siladi (headpat).]';
    }

    const parts = [];
    if (audio) parts.push({ inlineData: { mimeType: 'audio/wav', data: audio } }, { text: '[Foydalanuvchi ovozli xabar yubordi.]' });
    if (text) parts.push({ text });
    const history = DB.recentMessages(u.id, ch, 30);
    const contents = [
      ...history.map((m) => ({ role: m.role, parts: [{ text: m.role === 'model' ? `SAY: ${scrub(m.text)}` : m.text }] })),
      { role: 'user', parts },
    ];
    // Gemini ketma-ket bir xil rolni yoqtirmaydi — birlashtiramiz
    for (let i = contents.length - 1; i > 0; i--) {
      if (contents[i].role === contents[i - 1].role) { contents[i - 1].parts.push(...contents[i].parts); contents.splice(i, 1); }
    }

    let raw = '', said = '';
    let heard = text && !text.startsWith('[Tizim') ? text : '';
    let mood = null, spoken = 0;
    const style = CHARACTERS[ch].voiceStyle; // doimiy ohang — personaj ovozi o'zgarmaydi
    let playing = Promise.resolve();
    const speak = (sentence) => {
      if (!sentence.trim()) return;
      const chunks = [];
      let done = false, wake = null, err = null;
      tts(sentence, style, this.voice, ctrl.signal, (d) => { chunks.push(d); wake?.(); }, CHARACTERS[ch])
        .catch((e) => { err = e; }).finally(() => { done = true; wake?.(); });
      playing = playing.then(async () => {
        if (!alive()) return;
        this.send({ type: 'say', text: sentence, turn });
        while (alive()) {
          while (chunks.length && alive()) this.send({ type: 'audio', data: chunks.shift(), turn });
          if (done) break;
          await new Promise((r) => { wake = r; });
          wake = null;
        }
        if (err && alive() && err.name !== 'AbortError') {
          console.error('tts:', err.message);
          this.send({ type: 'tts_error', turn });
        }
      });
    };

    try {
      const r = await post(`${API}/models/${CHAT_MODEL}:streamGenerateContent?alt=sse`, {
        systemInstruction: { parts: [{ text: this.systemText() }] },
        contents,
        generationConfig: { temperature: 0.8, maxOutputTokens: 600, thinkingConfig: { thinkingLevel: THINKING } },
      }, ctrl.signal);

      for await (const ev of sse(r)) {
        if (!alive()) return;
        for (const p of ev.candidates?.[0]?.content?.parts || []) if (p.text && !p.thought) raw += p.text;
        if (!mood) {
          const mm = /MOOD:\s*(\w+)\s+(\w+)\s*\|?\s*([^\n]*)\n/.exec(raw);
          if (mm) {
            mood = { emotion: EMOTIONS.has(mm[1]) ? mm[1] : 'neutral', gesture: GESTURES.has(mm[2]) ? mm[2] : 'none' };
            this.send({ type: 'mood', ...mood, turn });
          }
        }
        const hm = /HEARD:\s*([^\n]*)\n/.exec(raw);
        if (hm && audio && !heard && hm[1].trim() !== '-') { heard = hm[1].trim(); this.send({ type: 'heard', text: heard, turn }); }
        const si = raw.indexOf('SAY:');
        if (si >= 0) {
          said = raw.slice(si + 4).trimStart();
          if (spoken === 0 && SPLIT) {
            const sp = splitFirstSentence(said);
            if (sp) { speak(sp[0]); spoken = said.length - sp[1].length; }
          }
        }
      }
      if (!alive()) return;
      if (!said) said = raw.replace(/^(HEARD|MOOD|REMEMBER):.*$/gm, '').trim();
      speak(said.slice(spoken));

      const rm = /REMEMBER:\s*([^\n]*)/.exec(raw);
      const fact = rm?.[1]?.trim();
      if (fact && fact !== '-' && fact.length > 2) { DB.addMemory(u.id, ch, fact.slice(0, 300)); this.send({ type: 'remember', fact }); }
      const userLine = heard || (text?.startsWith('[Tizim') ? '' : text);
      if (userLine) DB.addMessage(u.id, ch, 'user', userLine);
      else if (audio) DB.addMessage(u.id, ch, 'user', '(ovozli xabar)');
      if (said) DB.addMessage(u.id, ch, 'model', said);

      await playing;
      if (alive()) this.send({ type: 'done', turn, user: userLine, reply: said, ms: Date.now() - t0 });
    } catch (e) {
      if (e.name === 'AbortError' || !alive()) return;
      console.error('respond:', e.message);
      this.send({ type: 'error', message: 'Javob olishda xato. Birozdan keyin qayta urinib ko\'ring.', turn });
    }
  }
}
