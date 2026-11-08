// Aiko — server: sayt, API, ovozli suhbat (WebSocket /live), Telegram bot
import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as DB from './lib/db.js';
import { Conversation, MODELS, VOICES, TTS_INFO } from './lib/ai.js';
import { CHARACTERS, publicCharacters } from './lib/characters.js';
import { startBot, botEnabled, botUsername } from './lib/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes('bu_yerga')) {
  console.error('\n❌ GEMINI_API_KEY topilmadi. .env fayliga kalitingizni yozing.\n');
  process.exit(1);
}

// Bot tokeni bo'lmasa — SINOV rejimi: bitta test foydalanuvchi, obuna faol
const DEV = !botEnabled;
if (DEV) {
  DB.upsertUser({ id: 1, first_name: 'Sinov', username: 'test' });
  if (!DB.isActive(DB.getUser(1))) DB.extendSub(1, 3650);
}

function authUser(token) {
  if (DEV) return DB.getUser(1);
  return DB.userBySession(token);
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

// Telegram Mini App initData tekshiruvi
function checkWebAppData(initData) {
  const p = new URLSearchParams(String(initData || ''));
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const h = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (h.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

const app = express();
app.use(express.json({ limit: '100kb' }));

function me(u) {
  return {
    user: { id: u.id, name: u.first_name, character: u.character || null, voice: u.voice || null, active: DB.isActive(u), subUntil: u.sub_until },
    characters: publicCharacters(),
    voices: TTS_INFO.provider === 'azure' ? [] : [...VOICES],
    bot: botUsername,
    dev: DEV,
  };
}
const requireUser = (req, res, next) => {
  const u = authUser(bearer(req));
  if (!u) return res.status(401).json({ error: 'auth' });
  req.user = u;
  next();
};

app.get('/api/config', (_q, res) => res.json({ bot: botUsername, dev: DEV }));
app.post('/api/auth/link', (req, res) => {
  if (DEV) return res.json({ token: 'dev' });
  const uid = DB.useLoginCode(req.body?.code);
  if (!uid) return res.status(401).json({ error: 'Havola eskirgan yoki ishlatilgan. Botdan yangisini oling.' });
  res.json({ token: DB.createSession(uid) });
});
app.post('/api/auth/webapp', (req, res) => {
  if (DEV) return res.json({ token: 'dev' });
  const tg = checkWebAppData(req.body?.initData);
  if (!tg?.id) return res.status(401).json({ error: 'Telegram tekshiruvidan o\'tmadi' });
  const u = DB.upsertUser(tg);
  res.json({ token: DB.createSession(u.id) });
});
app.post('/api/logout', (req, res) => { DB.deleteSession(bearer(req)); res.json({ ok: true }); });
app.get('/api/me', requireUser, (req, res) => res.json(me(req.user)));
app.post('/api/character', requireUser, (req, res) => {
  if (!CHARACTERS[req.body?.id]) return res.status(400).json({ error: 'Noto\'g\'ri personaj' });
  DB.setUserField(req.user.id, 'character', req.body.id);
  DB.setUserField(req.user.id, 'voice', null); // personajning o'z ovozi
  res.json(me(DB.getUser(req.user.id)));
});
app.post('/api/voice', requireUser, (req, res) => {
  if (!VOICES.has(req.body?.voice)) return res.status(400).json({ error: 'Noto\'g\'ri ovoz' });
  DB.setUserField(req.user.id, 'voice', req.body.voice);
  res.json({ ok: true });
});
app.get('/api/memory', requireUser, (req, res) => {
  const ch = req.user.character || 'aiko';
  res.json({ facts: DB.getMemories(req.user.id, ch).map((m) => m.fact), days: DB.getSummaries(req.user.id, ch) });
});
app.post('/api/forget', requireUser, (req, res) => { DB.forget(req.user.id, req.user.character || 'aiko'); res.json({ ok: true }); });

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/live') return; // boshqalari (Vite HMR) o'zi hal qiladi
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, url.searchParams.get('token')));
});

wss.on('connection', (ws, token) => {
  const user = authUser(token);
  if (!user) { ws.send(JSON.stringify({ type: 'auth' })); return ws.close(4001, 'auth'); }
  if (!DB.isActive(user)) { ws.send(JSON.stringify({ type: 'paywall' })); return ws.close(4002, 'paywall'); }
  const c = new Conversation(ws, user);
  let busyUntil = 0;
  ws.send(JSON.stringify({ type: 'ready', character: c.character, voice: c.voice }));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'interrupt') return c.interrupt();
    // obuna suhbat paytida tugasa
    if (!DB.isActive(DB.getUser(user.id))) { ws.send(JSON.stringify({ type: 'paywall' })); return ws.close(4002, 'paywall'); }
    // juda tez-tez so'rovdan himoya
    const now = Date.now();
    if (now < busyUntil) return;
    busyUntil = now + 300;
    if (m.type === 'text' && typeof m.text === 'string' && m.text.trim()) c.respond({ text: m.text.slice(0, 2000) });
    else if (m.type === 'audio' && typeof m.data === 'string') c.respond({ audio: m.data });
    else if (['greet', 'idle', 'pat'].includes(m.type)) c.respond({ event: m.type });
  });
  ws.on('close', () => c.interrupt());
});

// ---------- Frontend ----------
if (process.env.NODE_ENV === 'production' || process.argv.includes('--prod')) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/^\/(?!api|live).*/, (_q, r) => r.sendFile(path.join(__dirname, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}

server.listen(PORT, () => {
  console.log(`✨ Sayt: http://localhost:${PORT}  (chat: ${MODELS.CHAT_MODEL}, ovoz: ${MODELS.TTS_MODEL})${DEV ? '  [SINOV REJIMI]' : ''}`);
  startBot().catch((e) => console.error('Bot ishga tushmadi:', e.message));
});
