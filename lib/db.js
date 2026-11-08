// Ma'lumotlar bazasi (SQLite, Node'ning o'zida). Fayl: data/aiko.db
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';

fs.mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DB_PATH || 'data/aiko.db');
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,            -- Telegram user id
  first_name TEXT, username TEXT,
  character TEXT,
  voice TEXT,
  sub_until INTEGER DEFAULT 0,       -- ms
  reminded_for INTEGER DEFAULT 0,
  bot_state TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS login_codes (code TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, character TEXT, role TEXT, text TEXT, ts INTEGER
);
CREATE INDEX IF NOT EXISTS messages_uc ON messages(user_id, character, ts);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, character TEXT, fact TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS day_summaries (
  user_id INTEGER, character TEXT, day TEXT, summary TEXT,
  PRIMARY KEY (user_id, character, day)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, file_id TEXT, status TEXT, created_at INTEGER, decided_at INTEGER
);
`);

const now = () => Date.now();
export const DAY = 24 * 3600 * 1000;
const rnd = (n = 24) => crypto.randomBytes(n).toString('base64url');

// Toshkent vaqti bo'yicha sana (YYYY-MM-DD)
export const dayOf = (ts) => new Date(ts + 5 * 3600 * 1000).toISOString().slice(0, 10);

// ---------- foydalanuvchilar ----------
export function upsertUser({ id, first_name, username }) {
  db.prepare(`INSERT INTO users (id, first_name, username, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`)
    .run(id, first_name || '', username || '', now());
  return getUser(id);
}
export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const setUserField = (id, field, value) => {
  if (!['character', 'voice', 'bot_state', 'reminded_for'].includes(field)) throw new Error('bad field');
  db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, id);
};
export const isActive = (u) => !!u && u.sub_until > now();
export function extendSub(id, days) {
  const u = getUser(id);
  const base = Math.max(now(), u?.sub_until || 0);
  db.prepare('UPDATE users SET sub_until = ? WHERE id = ?').run(base + days * DAY, id);
  return getUser(id);
}
export const usersToRemind = () =>
  db.prepare('SELECT * FROM users WHERE sub_until > 0 AND sub_until - ? < ? AND reminded_for != sub_until').all(now(), 2 * DAY);
export const stats = () => ({
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  active: db.prepare('SELECT COUNT(*) c FROM users WHERE sub_until > ?').get(now()).c,
  pending: db.prepare("SELECT COUNT(*) c FROM payments WHERE status = 'pending'").get().c,
  messagesToday: db.prepare('SELECT COUNT(*) c FROM messages WHERE ts > ?').get(now() - DAY).c,
});

// ---------- kirish ----------
export function createLoginCode(userId) {
  const code = rnd(18);
  db.prepare('INSERT INTO login_codes VALUES (?, ?, ?)').run(code, userId, now() + 15 * 60 * 1000);
  return code;
}
export function useLoginCode(code) {
  const row = db.prepare('SELECT * FROM login_codes WHERE code = ?').get(String(code));
  if (!row) return null;
  db.prepare('DELETE FROM login_codes WHERE code = ?').run(row.code);
  return row.expires > now() ? row.user_id : null;
}
export function createSession(userId) {
  const token = rnd(32);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, userId, now());
  return token;
}
export function userBySession(token) {
  if (!token) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(String(token));
  return s ? getUser(s.user_id) : null;
}
export const deleteSession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));

// ---------- suhbat va xotira ----------
export const addMessage = (userId, character, role, text) =>
  db.prepare('INSERT INTO messages (user_id, character, role, text, ts) VALUES (?, ?, ?, ?, ?)').run(userId, character, role, text, now());
export const recentMessages = (userId, character, limit = 30) =>
  db.prepare('SELECT role, text, ts FROM messages WHERE user_id = ? AND character = ? ORDER BY id DESC LIMIT ?')
    .all(userId, character, limit).reverse();
export const lastMessageTs = (userId, character) =>
  db.prepare('SELECT MAX(ts) t FROM messages WHERE user_id = ? AND character = ?').get(userId, character)?.t || 0;

export function addMemory(userId, character, fact) {
  const exists = db.prepare('SELECT 1 FROM memories WHERE user_id = ? AND character = ? AND fact = ?').get(userId, character, fact);
  if (!exists) db.prepare('INSERT INTO memories (user_id, character, fact, ts) VALUES (?, ?, ?, ?)').run(userId, character, fact, now());
}
export const getMemories = (userId, character, limit = 60) =>
  db.prepare('SELECT fact, ts FROM memories WHERE user_id = ? AND character = ? ORDER BY id DESC LIMIT ?')
    .all(userId, character, limit).reverse();
export function forget(userId, character) {
  for (const t of ['messages', 'memories', 'day_summaries']) db.prepare(`DELETE FROM ${t} WHERE user_id = ? AND character = ?`).run(userId, character);
}

// Bugundan oldingi, hali xulosa qilinmagan kunlar
export function daysNeedingSummary(userId, character) {
  const today = dayOf(now());
  const rows = db.prepare('SELECT role, text, ts FROM messages WHERE user_id = ? AND character = ? AND ts > ? ORDER BY ts')
    .all(userId, character, now() - 14 * DAY);
  const done = new Set(db.prepare('SELECT day FROM day_summaries WHERE user_id = ? AND character = ?').all(userId, character).map((r) => r.day));
  const byDay = new Map();
  for (const r of rows) {
    const d = dayOf(r.ts);
    if (d === today || done.has(d)) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  return byDay;
}
export const saveSummary = (userId, character, day, summary) =>
  db.prepare('INSERT OR REPLACE INTO day_summaries VALUES (?, ?, ?, ?)').run(userId, character, day, summary);
export const getSummaries = (userId, character, limit = 7) =>
  db.prepare('SELECT day, summary FROM day_summaries WHERE user_id = ? AND character = ? ORDER BY day DESC LIMIT ?')
    .all(userId, character, limit).reverse();

// ---------- to'lovlar ----------
export const createPayment = (userId, fileId) =>
  Number(db.prepare("INSERT INTO payments (user_id, file_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(userId, fileId, now()).lastInsertRowid);
export const getPayment = (id) => db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
export const decidePayment = (id, status) =>
  db.prepare("UPDATE payments SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(status, now(), id).changes > 0;
