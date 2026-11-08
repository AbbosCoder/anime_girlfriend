// Telegram bot: ro'yxatdan o'tish, saytga kirish, kartaga to'lov (chek -> admin tasdiqlaydi), eslatmalar
import * as DB from './db.js';

const TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const ADMINS = new Set(String(process.env.ADMIN_IDS || '').split(',').map((s) => Number(s.trim())).filter(Boolean));
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
const PRICE = process.env.PRICE || '49 000 so\'m';
const CARD = process.env.CARD_NUMBER || '0000 0000 0000 0000';
const HOLDER = process.env.CARD_HOLDER || '';
const SUB_DAYS = Number(process.env.SUB_DAYS || 30);
const HTTPS = PUBLIC_URL.startsWith('https://');
const APP = process.env.APP_NAME || 'Aiko';

export let botUsername = process.env.BOT_USERNAME || '';
export const botEnabled = !!TOKEN;

const BTN = { open: '🌸 Ochish', link: '🔗 Brauzerda ochish', sub: '💳 Obuna olish', status: '📊 Obunam', help: '❓ Yordam' };

async function call(method, params = {}) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
}
const send = (chat_id, text, extra = {}) => call('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra }).catch((e) => console.warn('bot:', e.message));
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function menu() {
  const open = HTTPS ? { text: BTN.open, web_app: { url: PUBLIC_URL } } : { text: BTN.open };
  return { keyboard: [[open, { text: BTN.link }], [{ text: BTN.sub }, { text: BTN.status }], [{ text: BTN.help }]], resize_keyboard: true, is_persistent: true };
}

const fmtUntil = (ts) => new Date(ts).toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'long', year: 'numeric' });
function statusText(u) {
  if (DB.isActive(u)) {
    const days = Math.ceil((u.sub_until - Date.now()) / DB.DAY);
    return `✅ Obuna faol: <b>${fmtUntil(u.sub_until)}</b> gacha (${days} kun qoldi).`;
  }
  return u.sub_until ? '⛔️ Obunangiz tugagan.' : '⛔️ Obuna yo\'q.';
}

async function sendLoginLink(u) {
  const code = DB.createLoginCode(u.id);
  const url = `${PUBLIC_URL}/?login=${code}`;
  const extra = HTTPS || !/localhost|127\.0\.0\.1/.test(PUBLIC_URL)
    ? { reply_markup: { inline_keyboard: [[{ text: '🔗 Kirish', url }]] } } : {};
  await send(u.id, `Shaxsiy kirish havolangiz (15 daqiqa amal qiladi, hech kimga bermang):\n${esc(url)}`, { ...extra, disable_web_page_preview: true });
}

async function askPayment(u) {
  DB.setUserField(u.id, 'bot_state', 'await_receipt');
  await send(u.id,
    `💳 <b>Oylik obuna — ${esc(PRICE)}</b> (${SUB_DAYS} kun)\n\n` +
    `1) Shu kartaga pul o'tkazing:\n<code>${esc(CARD)}</code>${HOLDER ? `\n${esc(HOLDER)}` : ''}\n\n` +
    `2) To'lov chekining <b>skrinshotini shu yerga</b> yuboring.\n\n` +
    `Admin tekshirgach, obunangiz darhol yoqiladi va sizga xabar keladi.`);
}

async function onReceipt(u, msg) {
  const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
  const pid = DB.createPayment(u.id, fileId);
  DB.setUserField(u.id, 'bot_state', null);
  await send(u.id, '🧾 Chek qabul qilindi. Tez orada tekshiramiz va sizga xabar beramiz. Rahmat!');
  const caption =
    `🧾 <b>Yangi to'lov #${pid}</b>\n` +
    `👤 ${esc(u.first_name)} ${u.username ? '@' + esc(u.username) : ''}\n🆔 <code>${u.id}</code>\n` +
    `💰 ${esc(PRICE)}\n${statusText(u)}`;
  const reply_markup = { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `ok:${pid}` }, { text: '❌ Rad etish', callback_data: `no:${pid}` }]] };
  for (const admin of ADMINS) {
    const method = msg.photo ? 'sendPhoto' : 'sendDocument';
    await call(method, { chat_id: admin, [msg.photo ? 'photo' : 'document']: fileId, caption, parse_mode: 'HTML', reply_markup })
      .catch((e) => console.warn('admin xabari:', e.message));
  }
  if (!ADMINS.size) console.warn('⚠️ ADMIN_IDS sozlanmagan — cheklarni hech kim ko\'rmaydi!');
}

async function onCallback(q) {
  const [action, id] = String(q.data || '').split(':');
  if (!ADMINS.has(q.from.id) || !['ok', 'no'].includes(action)) return call('answerCallbackQuery', { callback_query_id: q.id, text: 'Ruxsat yo\'q' });
  const p = DB.getPayment(Number(id));
  if (!p || !DB.decidePayment(p.id, action === 'ok' ? 'approved' : 'rejected')) {
    return call('answerCallbackQuery', { callback_query_id: q.id, text: 'Bu to\'lov allaqachon ko\'rib chiqilgan' });
  }
  let note;
  if (action === 'ok') {
    const u = DB.extendSub(p.user_id, SUB_DAYS);
    note = `✅ Tasdiqlandi (${q.from.first_name}). ${fmtUntil(u.sub_until)} gacha.`;
    await send(p.user_id, `🎉 To'lovingiz tasdiqlandi!\n${statusText(u)}\n\n${APP} sizni kutyapti 🌸`, { reply_markup: menu() });
    await sendLoginLink(u);
  } else {
    note = `❌ Rad etildi (${q.from.first_name}).`;
    await send(p.user_id, '😔 To\'lovingiz tasdiqlanmadi. Chekni tekshirib, qaytadan yuboring yoki admin bilan bog\'laning.');
  }
  await call('editMessageCaption', {
    chat_id: q.message.chat.id, message_id: q.message.message_id,
    caption: (q.message.caption || '') + `\n\n${note}`,
  }).catch(() => {});
  await call('answerCallbackQuery', { callback_query_id: q.id, text: note });
}

async function onAdminCommand(u, text) {
  const [cmd, a, b] = text.trim().split(/\s+/);
  if (cmd === '/stats') {
    const s = DB.stats();
    return send(u.id, `👥 Foydalanuvchilar: ${s.users}\n✅ Faol obuna: ${s.active}\n🧾 Kutilayotgan cheklar: ${s.pending}\n💬 24 soatdagi xabarlar: ${s.messagesToday}`);
  }
  if (cmd === '/give') {
    const target = DB.getUser(Number(a));
    if (!target) return send(u.id, 'Foydalanuvchi topilmadi. Format: /give <id> <kun>');
    const t = DB.extendSub(target.id, Number(b || SUB_DAYS));
    await send(target.id, `🎁 Sizga obuna berildi!\n${statusText(t)}`, { reply_markup: menu() });
    return send(u.id, `Berildi: ${target.first_name} — ${fmtUntil(t.sub_until)} gacha`);
  }
  return false;
}

async function onMessage(msg) {
  if (msg.chat.type !== 'private' || !msg.from) return;
  const u = DB.upsertUser(msg.from);
  const text = msg.text || '';

  if (ADMINS.has(u.id) && text.startsWith('/') && !text.startsWith('/start')) {
    if (await onAdminCommand(u, text) !== false) return;
  }
  if (msg.photo || (msg.document && /^image\/|pdf/.test(msg.document.mime_type || ''))) return onReceipt(u, msg);

  if (text.startsWith('/start')) {
    await send(u.id,
      `Salom, ${esc(u.first_name)}! 🌸\n\n` +
      `Bu yerda sizni ishdan keyin kutib oladigan, gapingizni tinglaydigan va eslab qoladigan 3D anime qiz bor.\n` +
      `U bilan ovoz chiqarib gaplashasiz — u sizga javob beradi, kayfiyatingizni sezadi.\n\n` +
      `${statusText(u)}`,
      { reply_markup: menu() });
    if (!DB.isActive(u)) await askPayment(u);
    return;
  }
  if (text === BTN.sub || text === '/subscribe') return askPayment(u);
  if (text === BTN.status || text === '/status') return send(u.id, statusText(u), { reply_markup: menu() });
  if (text === BTN.link || text === BTN.open || text === '/login') {
    if (!DB.isActive(u)) { await send(u.id, 'Avval obuna oling 👇'); return askPayment(u); }
    return sendLoginLink(u);
  }
  if (text === BTN.help || text === '/help') {
    return send(u.id,
      `❓ <b>Qanday ishlaydi?</b>\n\n` +
      `• ${BTN.open} — Telegram ichida ochiladi.\n• ${BTN.link} — kompyuter yoki telefon brauzerida ochish uchun shaxsiy havola.\n` +
      `• Mikrofonga ruxsat bering va shunchaki gapiring. U gapirayotganda gap boshlasangiz — to'xtab, sizni tinglaydi.\n` +
      `• Quloqchin bilan yanada yaxshi ishlaydi.\n\n` +
      `To'lov bo'yicha savollar bo'lsa — adminga yozing.`, { reply_markup: menu() });
  }
  if (DB.getUser(u.id)?.bot_state === 'await_receipt') return send(u.id, 'Iltimos, to\'lov chekining rasmini (skrinshot) yuboring 🧾');
  return send(u.id, 'Menyudan tanlang 👇', { reply_markup: menu() });
}

async function remindLoop() {
  for (const u of DB.usersToRemind()) {
    const left = u.sub_until - Date.now();
    const text = left > 0
      ? `⏰ Obunangiz ${Math.ceil(left / DB.DAY)} kundan keyin tugaydi. Uzilib qolmasligi uchun oldindan uzaytirib qo'ying 🌸`
      : '⛔️ Obunangiz tugadi. U sizni sog\'indi... Davom ettirish uchun obunani yangilang 🌸';
    await send(u.id, text, { reply_markup: { inline_keyboard: [[{ text: BTN.sub, callback_data: 'sub' }]] } });
    DB.setUserField(u.id, 'reminded_for', u.sub_until);
  }
}

export async function startBot() {
  if (!TOKEN) { console.warn('ℹ️ BOT_TOKEN yo\'q — bot o\'chirilgan, sayt SINOV rejimida (kirish va to\'lovsiz).'); return; }
  const me = await call('getMe');
  botUsername = me.username;
  await call('deleteWebhook', {}).catch(() => {});
  await call('setMyCommands', { commands: [
    { command: 'start', description: 'Boshlash' }, { command: 'login', description: 'Kirish havolasi' },
    { command: 'subscribe', description: 'Obuna olish' }, { command: 'status', description: 'Obunam' },
  ] }).catch(() => {});
  if (HTTPS) await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Ochish', web_app: { url: PUBLIC_URL } } }).catch((e) => console.warn(e.message));
  console.log(`🤖 Bot ishga tushdi: @${botUsername}  (adminlar: ${[...ADMINS].join(', ') || 'YO\'Q!'})`);

  setInterval(() => remindLoop().catch((e) => console.warn('eslatma:', e.message)), 3600 * 1000);
  remindLoop().catch(() => {});

  let offset = 0;
  for (;;) {
    try {
      const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
      for (const up of updates) {
        offset = up.update_id + 1;
        try {
          if (up.message) await onMessage(up.message);
          else if (up.callback_query) {
            const q = up.callback_query;
            if (q.data === 'sub') { await call('answerCallbackQuery', { callback_query_id: q.id }); await askPayment(DB.upsertUser(q.from)); }
            else await onCallback(q);
          }
        } catch (e) { console.error('bot update:', e.message); }
      }
    } catch (e) {
      console.warn('bot polling:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
