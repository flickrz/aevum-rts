// Aevum - the "Çevrimiçi Oyuncular" panel on the right of the multiplayer screen and the lobby: everyone signed in
// with the game open, each with "Davet Et" (no need to be friends), and "Herkesi Davet Et" for everyone in the menus.
// An invite needs a room: without one, a room is opened first and its lobby shown. All names go in via textContent.
import { avatarEl } from './cloud-ui.js';
import { levelOf } from '../rank.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const errText = (e) => (e && e.message) || String(e || 'Hata');
const STATE_TR = { menu: 'Menüde', sp: 'Tek oyunculu maçta', mp: 'Çok oyunculu maçta' };
const REFRESH_MS = 8000;

// invites already sent (kept across the panel being rebuilt): fb -> {code, t}; and the last "invite everyone"
const sent = new Map();
let allAt = 0, allCode = '';

// the lobby we are in (a normal room with a code), or a new room opened for the invite
async function roomFor(ui) {
  const s = ui.lobbySession;
  if (s && s.state && s.state.code) return s;
  const n = await ui._mpSession();
  await n.host();
  ui.showLobby(n);
  return n;
}
// uids of the humans already seated in the lobby
const seated = (ui) => new Set(((ui.lobbySession && ui.lobbySession.state && ui.lobbySession.state.slots) || []).filter((s) => s.kind === 'human' && s.uid).map((s) => s.uid));

// -> the panel element (it refreshes itself while it is on screen)
export function onlinePanel(ui) {
  const cloud = ui.app.cloud;
  const wrap = h('aside', 'online-panel panel');
  if (!cloud || !cloud.loggedIn) return wrap;
  const head = h('div', 'op-head');
  const count = h('span', 'op-count', '…');
  head.append(h('span', 'op-title', 'Çevrimiçi Oyuncular'), count);
  const all = h('button', 'mbtn small primary op-all', 'Herkesi Davet Et'); all.type = 'button';
  const msg = h('div', 'op-msg hidden'); msg.setAttribute('role', 'status');
  const list = h('div', 'op-list', 'Yükleniyor...');
  wrap.append(head, all, msg, list);
  const say = (t, good) => { msg.textContent = t || ''; msg.className = 'op-msg' + (t ? '' : ' hidden') + (good ? ' ok' : ''); };

  let players = [];
  const draw = () => {
    const inRoom = seated(ui);
    const code = ui.lobbySession && ui.lobbySession.state && ui.lobbySession.state.code;
    count.textContent = String(players.length);
    const free = players.filter((p) => p.s === 'menu' && !inRoom.has(p.uid)).length;
    const wait = allAt && Date.now() - allAt < 120000 && allCode === code;
    all.disabled = !free || !!wait;
    all.title = !free ? 'Menüde bekleyen davet edilebilecek oyuncu yok' : wait ? 'Herkese davet gitti; 2 dakikada bir gönderilebilir' : 'Menüde olan herkese oda davetini gönderir (' + free + ' kişi)';
    list.textContent = '';
    if (!players.length) { list.append(h('div', 'prof-dim op-empty', 'Şu an senden başka çevrimiçi oyuncu yok.')); return; }
    for (const p of players) {
      const r = h('div', 'op-row' + (p.s !== 'menu' ? ' busy' : ''));
      const av = h('span', 'fr-av'); av.append(avatarEl(p.av, p.uid, 'av-sm'), h('i', 'fr-dot on' + (p.s !== 'menu' ? ' busy' : ''), ''));
      const t = h('span', 'fr-txt');
      t.append(h('b', 'fr-name', p.name || 'Oyuncu'), h('small', 'fr-sub', (STATE_TR[p.s] || STATE_TR.menu) + ' · Sv ' + levelOf(p.tp | 0).level));
      r.append(av, t);
      if (inRoom.has(p.uid)) r.append(h('span', 'fr-tag', 'Odada'));
      else {
        const x = sent.get(p.fb);
        const done = x && x.code === code && Date.now() - x.t < 60000;
        const b = h('button', 'mbtn small op-inv', done ? 'Gitti ✔' : 'Davet Et'); b.type = 'button';
        b.disabled = !!done;
        b.title = 'Oda davetini ' + (p.name || 'oyuncuya') + ' gönderir' + (p.s !== 'menu' ? ' (şu an maçta)' : '');
        b.onclick = async () => {
          safe(() => ui._click());
          b.disabled = true; say('', false);
          try {
            const s = await roomFor(ui);
            const r2 = await cloud.invite(p.fb, s.state.code);
            sent.set(p.fb, { code: s.state.code, t: Date.now() });
            b.textContent = r2.online ? 'Gitti ✔' : 'Çevrimdışı';
            safe(() => ui._lobbyNote?.(r2.online ? (p.name || 'Oyuncu') + ' davet edildi; kabul edince lobiye girer.' : (p.name || 'Oyuncu') + ' az önce çıktı.'));
          } catch (e) { b.disabled = false; say('Davet edilemedi: ' + errText(e), false); }
        };
        r.append(b);
      }
      list.append(r);
    }
  };
  all.onclick = async () => {
    safe(() => ui._click());
    all.disabled = true; say('', false);
    try {
      const s = await roomFor(ui);
      const inRoom = seated(ui);
      const skip = players.filter((p) => inRoom.has(p.uid)).map((p) => p.fb);
      const r = await cloud.inviteAll(s.state.code, skip);
      allAt = Date.now(); allCode = s.state.code;
      for (const p of players) if (p.s === 'menu' && !skip.includes(p.fb)) sent.set(p.fb, { code: allCode, t: allAt });
      const t = r.sent ? r.sent + ' oyuncuya davet gitti; kabul edenler lobiye girer.' : 'Davet edilecek kimse kalmadı.';
      safe(() => ui.toast('✉ ' + t, r.sent ? 'good' : 'warn'));
      safe(() => ui._lobbyNote?.(t));
      if (wrap.isConnected) say(t, true);
    } catch (e) { if (wrap.isConnected) { say(errText(e), false); all.disabled = false; } else safe(() => ui.toast(errText(e), 'warn')); }
  };
  const load = async () => {
    try { players = (await cloud.onlinePlayers()).players; } catch (e) { if (!players.length) { list.textContent = errText(e); count.textContent = '-'; } return; }
    if (wrap.isConnected) draw();
  };
  load();
  const timer = setInterval(() => { if (!wrap.isConnected) { clearInterval(timer); return; } load(); }, REFRESH_MS);
  return wrap;
}

export default { onlinePanel };
