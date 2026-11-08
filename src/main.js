import { Avatar } from './avatar.js';
import { Voice, Recorder } from './audio.js';

const $ = (id) => document.getElementById(id);
const avatar = new Avatar($('scene'));
let voice, recorder;
if (import.meta.env.DEV) window.avatar = avatar;

// ---------- saqlangan holat ----------
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let history = store.get('aiko_history', []);
let memory = store.get('aiko_memory', []);
const settings = store.get('aiko_settings', { voice: 'Leda', voiceOn: true });
$('voice').value = settings.voice;
$('voiceOn').checked = settings.voiceOn;
const saveSettings = () => store.set('aiko_settings', settings);
$('voice').onchange = (e) => { settings.voice = e.target.value; saveSettings(); };
$('voiceOn').onchange = (e) => { settings.voiceOn = e.target.checked; saveSettings(); };

function renderMemory() {
  $('memoryView').textContent = memory.length ? 'Aiko eslab qolganlari:\n• ' + memory.join('\n• ') : 'Aiko hali siz haqingizda hech narsa bilmaydi.';
}
renderMemory();
$('forget').onclick = () => {
  if (!confirm('Aiko barcha suhbat va xotirani unutsinmi?')) return;
  history = []; memory = [];
  store.set('aiko_history', history); store.set('aiko_memory', memory);
  $('log').innerHTML = ''; renderMemory();
};
$('gear').onclick = () => $('settings').classList.toggle('hidden');

// ---------- model yuklash ----------
avatar.load('/models/girl.vrm', (p) => { $('progressBar').style.width = `${p * 100}%`; })
  .then(() => {
    $('progressBar').style.width = '100%';
    $('loadText').textContent = 'Aiko sizni kutyapti~';
    $('startBtn').disabled = false;
  })
  .catch((e) => { $('loadText').textContent = 'Model yuklanmadi: ' + e.message; });

async function loadUserVrm(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  try { await avatar.load(url); } catch (e) { alert('Model yuklanmadi: ' + e.message); }
}
$('vrmFile').onchange = (e) => loadUserVrm(e.target.files[0]);
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.vrm')) loadUserVrm(f); });

$('startBtn').onclick = async () => {
  voice = new Voice();
  await voice.resume();
  recorder = new Recorder(voice.ctx);
  $('start').classList.add('gone');
  for (const m of history.slice(-12)) addLog(m.role, m.text);
  send({ event: 'greet' });
};

// ---------- UI yordamchilari ----------
function addLog(role, text) {
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'user' : 'aiko');
  d.textContent = text;
  $('log').append(d);
  $('log').scrollTop = 1e9;
}
function showBubble(text, thinking = false) {
  $('bubbleText').textContent = text;
  $('bubble').classList.toggle('thinking', thinking);
  $('bubble').classList.remove('hidden');
}
let heardTimer;
function showHeard(text) {
  $('heard').textContent = text;
  $('heard').classList.remove('hidden');
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => $('heard').classList.add('hidden'), 5000);
}

// ---------- suhbat ----------
let busy = false;
let idleTimer;
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!busy && !voice?.playing) send({ event: 'idle' }); }, 150000);
}

async function send({ text, audio, event, hidden = false }) {
  if (busy) return;
  busy = true;
  $('bar').classList.add('busy');
  resetIdle();
  voice?.stop();
  avatar.setSpeaking(false);

  if (text && !hidden) { addLog('user', text); showHeard(text); }
  avatar.setEmotion('thinking');
  showBubble('', true);

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, text, audio, memory, event }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    const userText = audio ? (data.heard || '🎤 (ovozli xabar)') : text;
    if (audio) { addLog('user', userText); showHeard(userText); }
    if (userText && !hidden) history.push({ role: 'user', text: userText });
    else if (hidden && text) history.push({ role: 'user', text });
    else if (event) history.push({ role: 'user', text: event === 'greet' ? '[foydalanuvchi keldi]' : '[foydalanuvchi jim edi]' });
    history.push({ role: 'model', text: data.reply });
    history = history.slice(-60);
    store.set('aiko_history', history);
    if (data.remember?.trim()) {
      memory.push(data.remember.trim());
      memory = [...new Set(memory)].slice(-40);
      store.set('aiko_memory', memory);
      renderMemory();
    }

    await speak(data);
  } catch (e) {
    console.error(e);
    avatar.setEmotion('sad');
    showBubble('Uh... nimadir xato ketdi: ' + e.message);
  } finally {
    busy = false;
    $('bar').classList.remove('busy');
    resetIdle();
  }
}

async function speak({ reply, emotion, gesture, voice_style }) {
  let wav = null;
  if (settings.voiceOn) {
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply, style: voice_style, voice: settings.voice }),
      });
      if (r.ok) wav = await r.arrayBuffer();
      else console.warn('TTS:', (await r.json()).error);
    } catch (e) { console.warn('TTS:', e); }
  }

  avatar.setEmotion(emotion);
  showBubble(reply);
  addLog('model', reply);
  if (gesture && gesture !== 'none') avatar.playGesture(gesture);

  avatar.setSpeaking(true);
  if (wav) {
    const loop = () => { if (voice.playing) { avatar.setMouth(voice.lipSync()); requestAnimationFrame(loop); } };
    await voice.play(wav, () => requestAnimationFrame(loop));
  } else {
    await fakeTalk(reply);
  }
  avatar.setSpeaking(false);
}

// ovoz bo'lmasa — matn bo'yicha lab harakati
function fakeTalk(text) {
  const dur = Math.min(12, 0.5 + text.length * 0.06);
  const t0 = performance.now();
  return new Promise((res) => {
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      if (t > dur) return res();
      const i = Math.floor(t * 9) % text.length;
      const ch = text[i].toLowerCase();
      const open = /[aа]/.test(ch) ? 0.8 : /[oоu]/.test(ch) ? 0.5 : /[eiи]/.test(ch) ? 0.4 : /\s|[.,!?]/.test(ch) ? 0 : 0.25;
      avatar.setMouth({ aa: open, oh: /[oоu]/.test(ch) ? 0.5 : 0, ee: /[eiи]/.test(ch) ? 0.5 : 0, ih: 0, ou: 0 });
      requestAnimationFrame(loop);
    };
    loop();
  });
}

// ---------- matn yuborish ----------
$('bar').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || busy) return;
  $('text').value = '';
  send({ text });
};

// ---------- mikrofon ----------
let recording = false;
async function toggleMic() {
  if (busy && !recording) return;
  if (!recording) {
    try {
      voice.stop(); avatar.setSpeaking(false);
      await recorder.start();
      recording = true;
      avatar.listening = true;
      $('mic').classList.add('rec');
      const pulse = () => {
        if (!recording) return;
        $('micRing').style.transform = `scale(${1 + Math.min(0.5, recorder.level * 6)})`;
        requestAnimationFrame(pulse);
      };
      pulse();
    } catch (e) { alert('Mikrofonga ruxsat berilmadi. (Saytda HTTPS bo\'lishi kerak.)'); }
  } else {
    recording = false;
    avatar.listening = false;
    $('mic').classList.remove('rec');
    const { base64, duration } = recorder.stop();
    if (duration < 0.4) return;
    send({ audio: { data: base64, mimeType: 'audio/wav' } });
  }
}
$('mic').onclick = toggleMic;
// Bo'sh joy tugmasini bosib turib ham gapirish mumkin (yozish maydoni tashqarisida)
addEventListener('keydown', (e) => { if (e.code === 'Space' && document.activeElement !== $('text') && !e.repeat && !recording) { e.preventDefault(); toggleMic(); } });
addEventListener('keyup', (e) => { if (e.code === 'Space' && document.activeElement !== $('text') && recording) { e.preventDefault(); toggleMic(); } });

// ---------- boshini silash ----------
$('scene').addEventListener('click', (e) => {
  if (!voice || busy) return;
  if (avatar.isHeadAt(e.clientX, e.clientY)) {
    avatar.setEmotion('shy');
    avatar.playGesture('shy');
    send({ text: '[Tizim: foydalanuvchi sening boshingni siladi (headpat).]', hidden: true });
  }
});
