// Aevum - a plain log of every multiplayer chat line this browser sees (lobby and in-game, sent and received).
// Owner 2026-11-15: revisions are agreed over chat with friends; the log is downloaded as a .txt and handed over so
// the revisions can be picked out of the talk. Kept in localStorage (the free server's disk does not survive a
// redeploy or its sleep), capped at MAX lines. Never part of the game state.
const KEY = 'aevum.chatlog.v1', MAX = 20000;
let mem = null, sink = null;
// (player request 2026-11-25) a feedback line to @claude may be up to FB_MAX characters; any other line CHAT_MAX
export const CHAT_MAX = 200, FB_MAX = 1000;
export const chatMax = (text) => (/@claude/i.test(String(text || '')) ? FB_MAX : CHAT_MAX);
export const clipChat = (text) => { const s = String(text || ''); return s.slice(0, chatMax(s)); };
// the cloud copy: main.js sets a function that writes a line the player SENT to Firestore (CloudSync.logChat)
export function setChatSink(fn) { sink = typeof fn === 'function' ? fn : null; }
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { mem = []; }
  if (!Array.isArray(mem)) mem = [];
  return mem;
}
const pad = (n) => String(n).padStart(2, '0');
function stamp(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

export function logChat(m) {
  if (!m || typeof m.text !== 'string' || !m.text.trim()) return;
  const L = load();
  const e = { t: stamp(new Date()), room: String(m.room || ''), name: String(m.name || '?').slice(0, 40), text: clipChat(m.text) };
  L.push(e);
  // (m.shot: a screenshot data URL attached to a @claude line; only the cloud copy gets it, never localStorage)
  if (m.mine && sink) { try { sink(m.shot ? Object.assign({}, e, { shot: m.shot }) : e); } catch { /* the cloud copy is best effort */ } }
  if (L.length > MAX) L.splice(0, L.length - MAX);
  try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* no storage (tests, private mode): the log stays in memory */ }
}
export function chatLogCount() { return load().length; }
export function chatLogText() { return load().map((e) => `${e.t}  [${e.room || '-'}]  ${e.name}: ${e.text}`).join('\n'); }
export function downloadChatLog() {
  const n = load().length, txt = n ? chatLogText() + '\n' : '(henüz sohbet kaydı yok)\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
  a.download = 'aevum-sohbet-' + stamp(new Date()).slice(0, 10) + '.txt';
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return n;
}
// from the browser console too: aevumChatLog.download() / .text() / .count()
if (typeof window !== 'undefined') window.aevumChatLog = { download: downloadChatLog, text: chatLogText, count: chatLogCount };
