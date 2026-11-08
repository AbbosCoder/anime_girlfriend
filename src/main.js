import { Avatar, renderPortrait } from './avatar.js';
import { Player, Mic } from './audio.js';

const $ = (id) => document.getElementById(id);
const avatar = new Avatar($('scene'));
if (import.meta.env.DEV) window.avatar = avatar;
const TG = window.Telegram?.WebApp;
TG?.ready?.();
TG?.expand?.();

let ctx, player, mic, ws;
let ready = false, started = false, greeted = false;
let me = null, character = null;

// ---------- brauzerdagi sozlamalar ----------
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
let token = store.get('aiko_token', '');
const settings = { barge: 0.06, ...store.get('aiko_settings', {}) };
$('barge').value = settings.barge;
$('barge').oninput = (e) => { settings.barge = +e.target.value; store.set('aiko_settings', settings); };

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.status); e.status = r.status; throw e; }
  return j;
}

// ---------- ekranlar ----------
const screen = (name) => { $('gate').dataset.screen = name; $('gate').classList.toggle('gone', !name); };
const botLink = (start) => (me?.bot || cfgBot) ? `https://t.me/${me?.bot || cfgBot}${start ? `?start=${start}` : ''}` : '#';
let cfgBot = '';

async function boot() {
  screen('loading');
  try { cfgBot = (await api('/api/config')).bot; } catch {}
  $('loginBtn').href = botLink('login');
  $('payBtn').href = botLink('pay');

  // 1) havola orqali kirish: /?login=KOD
  const url = new URL(location.href);
  const code = url.searchParams.get('login');
  if (code) {
    url.searchParams.delete('login');
    history.replaceState(null, '', url.pathname + url.search);
    try { token = (await api('/api/auth/link', { code })).token; store.set('aiko_token', token); }
    catch (e) { $('loginErr').textContent = e.message; }
  }
  // 2) Telegram Mini App ichida — avtomatik
  if (TG?.initData) {
    try { token = (await api('/api/auth/webapp', { initData: TG.initData })).token; store.set('aiko_token', token); } catch {}
  }
  await refreshMe();
}

async function refreshMe() {
  try {
    me = await api('/api/me');
  } catch (e) {
    if (e.status === 401) { store.del('aiko_token'); token = ''; return screen('login'); }
    $('loginErr').textContent = 'Server bilan aloqa yo\'q: ' + e.message;
    return screen('login');
  }
  $('loginBtn').href = botLink('login');
  $('payBtn').href = botLink('pay');
  renderSubInfo();
  if (!me.user.active) return screen('paywall');
  if (!me.user.character) return showCharacters();
  selectCharacter(me.user.character);
}

function renderSubInfo() {
  const u = me.user;
  $('subInfo').textContent = me.dev ? 'Sinov rejimi (bot ulanmagan)' :
    u.active ? `Obuna: ${new Date(u.subUntil).toLocaleDateString('uz-UZ')} gacha` : 'Obuna yo\'q';
  $('voice').innerHTML = me.voices.map((v) => `<option>${v}</option>`).join('');
  $('voice').closest('label').style.display = me.voices.length ? '' : 'none';
}

// Har bir personaj portreti: public/characters/<id>.jpg bo'lsa — o'sha, bo'lmasa 3D modeldan chiziladi
const LOOKS = {
  aiko: { expression: 'relaxed', weight: 0.75, tilt: 0.12, turn: 0.2, bg: ['#5b3a6e', '#f7c6d9'] },
  yuki: { expression: 'happy', weight: 1.0, tilt: -0.12, turn: 0.1, bg: ['#ff8a65', '#ffe29a'] },
  rin: { expression: 'angry', weight: 0.35, tilt: 0.05, turn: -0.35, bg: ['#1c2550', '#7484e0'] },
};
// Umumiy modeldan foydalanilganda har bir qizning o'z ranglari
const FALLBACK = '/models/girl.vrm';
const COLORS = {
  aiko: { cloth: { h: 0.95, s: 0.45, lm: 0.95, la: 0.02 } },
  yuki: { hair: { h: 0.94, s: 0.6, lm: 0.9, la: 0.38 }, eyes: { h: 0.09, s: 0.8, lm: 1, la: 0.06 }, cloth: { h: 0.13, s: 0.6, lm: 0.95, la: 0 } },
  rin: { hair: { h: 0.64, s: 0.3, lm: 0.5, la: 0.02 }, eyes: { h: 0.58, s: 0.8, lm: 1, la: 0.05 }, cloth: { h: 0.7, s: 0.25, lm: 0.32, la: 0.04 } },
};
const lookFor = (c, url) => (url === FALLBACK ? COLORS[c.id] || null : null);
const portraits = {};
async function exists(url, typeRe) {
  try { const h = await fetch(url, { method: 'HEAD' }); return h.ok && typeRe.test(h.headers.get('content-type') || ''); } catch { return false; }
}
async function modelUrl(c) {
  const u = `/models/${c.model}.vrm`;
  return (await exists(u, /octet|model|gltf|vrm|^$/i)) ? u : FALLBACK;
}
async function portraitFor(c) {
  if (portraits[c.id]) return portraits[c.id];
  for (const ext of ['jpg', 'png', 'webp']) {
    const u = `/characters/${c.id}.${ext}`;
    if (await exists(u, /^image\//)) return (portraits[c.id] = u);
  }
  const url = await modelUrl(c);
  return (portraits[c.id] = await renderPortrait(url, { ...(LOOKS[c.id] || {}), look: lookFor(c, url) }));
}

function showCharacters() {
  $('charList').innerHTML = '';
  const imgs = [];
  for (const c of me.characters) {
    const b = document.createElement('button');
    b.className = 'char' + (c.id === me.user.character ? ' sel' : '');
    b.innerHTML = `<div class="pic"><img alt="" /></div><div class="info"><h3></h3><div class="tag"></div><p></p><span class="pick">Tanlash</span></div>`;
    b.querySelector('h3').textContent = c.name;
    b.querySelector('.tag').textContent = c.tagline;
    b.querySelector('p').textContent = c.description;
    b.querySelector('img').alt = c.name;
    b.onclick = async () => {
      me = await api('/api/character', { id: c.id });
      selectCharacter(c.id, true);
    };
    $('charList').append(b);
    imgs.push([c, b.querySelector('img'), b.querySelector('.pic')]);
  }
  screen('characters');
  // portretlarni birin-ketin chizamiz
  (async () => {
    for (const [c, img, pic] of imgs) {
      try { img.src = await portraitFor(c); img.onload = () => pic.classList.add('ready'); } catch (e) { console.warn('portret:', e); }
    }
  })();
}

let loadedModel = '';
async function selectCharacter(id, changed = false) {
  character = me.characters.find((c) => c.id === id) || me.characters[0];
  $('startName').textContent = character.name;
  $('bubbleName').textContent = character.name;
  $('voice').value = me.user.voice || character.voice;
  document.title = character.name;
  $('log').innerHTML = '';

  // personaj modeli: /models/<id>.vrm, bo'lmasa umumiy model
  const url = await modelUrl(character);

  if (started) {
    // suhbat davomida almashtirildi
    screen(null);
    if (url + character.id !== loadedModel) { await avatar.load(url, null, lookFor(character, url)); loadedModel = url + character.id; }
    greeted = false;
    ws?.close();
    return;
  }
  screen('start');
  $('startBtn').disabled = true;
  $('loadText').textContent = 'Yuklanmoqda...';
  try {
    if (url + character.id !== loadedModel) await avatar.load(url, (p) => { $('progressBar').style.width = `${p * 100}%`; }, lookFor(character, url));
    loadedModel = url + character.id;
    $('progressBar').style.width = '100%';
    $('loadText').textContent = `${character.name} sizni kutyapti~`;
    $('startBtn').disabled = false;
  } catch (e) { $('loadText').textContent = 'Model yuklanmadi: ' + e.message; }
}

$('recheck').onclick = () => refreshMe();
$('changeChar').onclick = () => { $('settings').classList.add('hidden'); interrupt(); showCharacters(); };
$('voice').onchange = async (e) => { await api('/api/voice', { voice: e.target.value }); ws?.close(); };
$('gear').onclick = async () => {
  $('settings').classList.toggle('hidden');
  if ($('settings').classList.contains('hidden')) return;
  try {
    const m = await api('/api/memory');
    const lines = [...m.facts.map((f) => '• ' + f), ...m.days.map((d) => `📅 ${d.day}: ${d.summary}`)];
    $('memoryView').textContent = lines.length ? lines.join('\n') : 'Hali hech narsa yo\'q.';
  } catch {}
};
$('forget').onclick = async () => {
  if (!confirm(`${character?.name || 'U'} siz bilan bo'lgan barcha suhbat va xotirani unutsinmi?`)) return;
  await api('/api/forget', {});
  $('log').innerHTML = ''; $('memoryView').textContent = '';
  greeted = false;
  ws?.close();
};
$('logout').onclick = async () => {
  try { await api('/api/logout', {}); } catch {}
  store.del('aiko_token'); location.reload();
};

// ---------- start ----------
$('startBtn').onclick = async () => {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  player = new Player(ctx);
  mic = new Mic(ctx);
  mic.onChunk = onMicChunk;
  try {
    await mic.start();
    $('mic').classList.add('live');
  } catch {
    mic = null;
    $('mic').classList.add('muted');
    status('Mikrofon yo\'q — yozib gaplashing');
  }
  screen(null);
  started = true;
  connect();
  requestAnimationFrame(frame);
};

// ---------- UI yordamchilari ----------
function addLog(role, text) {
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'user' : 'aiko');
  d.textContent = text;
  $('log').append(d);
  $('log').scrollTop = 1e9;
}
function showBubble(text) {
  $('bubbleText').textContent = text;
  $('bubble').classList.toggle('hidden', !text);
}
let heardTimer;
function showHeard(text) {
  $('heard').textContent = text;
  $('heard').classList.remove('hidden');
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => $('heard').classList.add('hidden'), 6000);
}
function status(t) { $('status').textContent = t; }

// ---------- server bilan ulanish ----------
let stopReconnect = false;
function connect() {
  ready = false;
  status('Ulanmoqda...');
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live?token=${encodeURIComponent(token)}`);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = (e) => {
    ready = false;
    player?.stop();
    busy = false;
    if (e.code === 4001) { started = false; return screen('login'); }
    if (e.code === 4002) { started = false; return refreshMe(); }
    if (started && !stopReconnect) { status('Qayta ulanmoqda...'); setTimeout(connect, 1200); }
  };
}
const send = (obj) => ws?.readyState === 1 && ready && ws.send(JSON.stringify(obj));

// ---------- navbat holati ----------
let busy = false; // u o'ylayapti yoki gapiryapti
let lastTurn = -1, ignoreUpTo = -1;
let subtitle = '', pendingGesture = null;

function ask(payload) {
  interrupt(false);
  busy = true;
  subtitle = '';
  avatar.setEmotion('thinking');
  $('bubbleText').textContent = '';
  $('bubble').classList.add('thinking');
  $('bubble').classList.remove('hidden');
  send(payload);
}

// darhol to'xtatish
function interrupt(notify = true) {
  if (busy || player?.playing) {
    player.stop();
    ignoreUpTo = lastTurn;
    if (notify) send({ type: 'interrupt' });
    if (subtitle) addLog('model', subtitle + ' —');
    subtitle = '';
    busy = false;
    $('bubble').classList.remove('thinking');
  }
}

function handle(m) {
  if (m.type === 'ready') {
    ready = true;
    status(mic ? 'Gapiravering — tinglayapman' : '');
    setTimeout(() => status(''), 4000);
    if (!greeted) { greeted = true; ask({ type: 'greet' }); }
    return;
  }
  if (m.type === 'paywall') { started = false; return refreshMe(); }
  if (m.type === 'auth') { started = false; return screen('login'); }
  if (m.type === 'remember') return;
  if (m.turn !== undefined) {
    if (m.turn <= ignoreUpTo) return; // to'xtatilgan eski javob
    lastTurn = Math.max(lastTurn, m.turn);
  }
  switch (m.type) {
    case 'mood':
      avatar.setEmotion(m.emotion);
      pendingGesture = m.gesture;
      break;
    case 'heard':
      showHeard(m.text);
      addLog('user', m.text);
      break;
    case 'say':
      subtitle = (subtitle + ' ' + m.text.replace(/<[^>]+>/g, '')).trim();
      $('bubble').classList.remove('thinking');
      showBubble(subtitle);
      break;
    case 'audio':
      player.push(m.data, 24000);
      if (pendingGesture && pendingGesture !== 'none') avatar.playGesture(pendingGesture);
      pendingGesture = null;
      break;
    case 'done':
      busy = false;
      if (m.reply) addLog('model', m.reply.replace(/<[^>]+>/g, ''));
      subtitle = '';
      lastActivity = performance.now();
      if (import.meta.env.DEV) console.log('javob vaqti', m.ms, 'ms');
      break;
    case 'error':
      busy = false;
      avatar.setEmotion('sad');
      $('bubble').classList.remove('thinking');
      showBubble(m.message);
      break;
  }
}

// ---------- mikrofon: gap boshlanishi/tugashini aniqlash ----------
const VAD = 0.025; // jim xonada gap boshlanishi chegarasi
const pre = [];    // gap boshi yo'qolmasligi uchun oldingi bo'laklar
let speech = null, loud = 0;

function onMicChunk(b64, level) {
  $('micRing').style.transform = `scale(${1 + Math.min(0.5, level * 5)})`;
  if (!ready) return;
  if (!speech) {
    pre.push(b64); if (pre.length > 4) pre.shift();
    // u gapirayotganda karnaydagi o'z ovozini sizniki deb o'ylamasligi uchun chegara balandroq
    const thr = player.playing ? settings.barge : VAD;
    loud = level > thr ? loud + 1 : 0;
    if (loud >= 2) {
      speech = { chunks: pre.splice(0), quiet: 0, ms: 0 };
      loud = 0;
      interrupt(); // siz gapirdingiz — u darhol jim bo'ladi
      avatar.listening = true;
      avatar.setEmotion('neutral');
      status('Tinglayapman...');
    }
    return;
  }
  speech.chunks.push(b64);
  speech.ms += 100;
  speech.quiet = level < VAD * 0.8 ? speech.quiet + 100 : 0;
  if (speech.quiet >= 800 || speech.ms > 30000) {
    const s = speech;
    speech = null;
    avatar.listening = false;
    status('');
    if (s.ms - s.quiet < 350) return; // shovqin
    ask({ type: 'audio', data: pcmChunksToWav(s.chunks) });
    lastActivity = performance.now();
    idleSent = false;
  }
}

function pcmChunksToWav(chunks) {
  const bins = chunks.map(atob);
  const len = bins.reduce((a, b) => a + b.length, 0);
  const buf = new Uint8Array(44 + len);
  const dv = new DataView(buf.buffer);
  const w = (o, s) => [...s].forEach((c, i) => { buf[o + i] = c.charCodeAt(0); });
  w(0, 'RIFF'); dv.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len, true);
  let o = 44;
  for (const b of bins) for (let i = 0; i < b.length; i++) buf[o++] = b.charCodeAt(i);
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

$('mic').onclick = () => {
  if (!mic) return;
  const muted = !mic.muted;
  mic.setMuted(muted);
  speech = null;
  $('mic').classList.toggle('muted', muted);
  $('mic').classList.toggle('live', !muted);
  status(muted ? 'Mikrofon o\'chirildi' : 'Tinglayapman');
  setTimeout(() => status(''), 2000);
};

// ---------- matn ----------
$('bar').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || !ready) return;
  $('text').value = '';
  interrupt();
  showHeard(text);
  addLog('user', text);
  ask({ type: 'text', text });
  lastActivity = performance.now();
  idleSent = false;
};

// ---------- boshini silash ----------
$('scene').addEventListener('click', (e) => {
  if (!ready || !avatar.isHeadAt(e.clientX, e.clientY)) return;
  avatar.setEmotion('shy');
  avatar.playGesture('shy');
  interrupt();
  ask({ type: 'pat' });
});

// ---------- har kadr: lab harakati, jimlik ----------
let wasPlaying = false, lastActivity = performance.now(), idleSent = false;
function frame() {
  const p = player.playing;
  if (p !== wasPlaying) { avatar.setSpeaking(p); wasPlaying = p; if (!p) lastActivity = performance.now(); }
  if (p) avatar.setMouth(player.lipSync());
  if (ready && !p && !busy && !speech && !idleSent && performance.now() - lastActivity > 150000) {
    idleSent = true;
    ask({ type: 'idle' });
  }
  requestAnimationFrame(frame);
}

boot();
