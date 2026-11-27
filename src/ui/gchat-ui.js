// Aevum - "Genel Sohbet": one chat room for everyone signed in, shown on the right of the main menu and on the
// multiplayer screen (owner 2026-11-26). Lines come from the game server (server.js /mp/gchat): the history when a panel
// opens, then each new line through the inbox long-poll the game already keeps (main.js -> gchatIn), so it costs no
// extra connection. Community rules are shown once before the first line. A name opens a small profile card with
// "Arkadaş Ekle" and "Davet Et". Every name and line goes in via textContent.
import { avatarEl } from './cloud-ui.js';
import { levelOf } from '../rank.js';
import { logChat, clipChat, FB_MAX } from '../chatlog.js';
import { withMention, hasClaude } from './mention.js';
import { tr, pn } from '../i18n.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const errText = (e) => (e && e.message) || String(e || tr('Hata'));
const RULES_KEY = 'aevum.gchatRules';
const MAX = 80;

// the lines seen so far (kept while the page is open, shared by every panel) and the open panels' redraw functions
const lines = [];
let lastId = 0;
const views = new Set();

function add(arr) {
  let n = 0;
  for (const m of arr || []) {
    if (!m || typeof m.id !== 'number' || m.id <= lastId) continue;
    lines.push(m); lastId = m.id; n++;
  }
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  if (n) for (const v of views) safe(() => v());
}
// a line pushed by the server through the inbox (main.js)
export function gchatIn(m) { add([m]); }

const rulesOk = () => { try { return localStorage.getItem(RULES_KEY) === '1'; } catch (e) { return false; } };
const RULES = [
  'Herkese saygılı ol: hakaret, küfür, aşağılama ve kişisel saldırı yok.',
  'Irk, din, cinsiyet ya da kimlik üzerinden nefret söylemi yasak.',
  'Spam, flood ve reklam yapma; aynı şeyi tekrar tekrar yazma.',
  'Kendinin ya da başkasının kişisel bilgilerini (telefon, adres, şifre) paylaşma.',
  'Maç içi atışma oyunun tadı kadar; gerçek hayata ve kişiye taşıma.',
  'Kuralları çiğneyen hesaplar uyarısız olarak oyundan uzaklaştırılabilir.',
];

// a small overlay with a panel on the menu
function overlay(ui, cls) {
  ui.menuEl.querySelector('.gc-ov')?.remove();
  const ov = h('div', 'gc-ov');
  const p = h('div', 'gc-modal panel ' + (cls || ''));
  const x = h('button', 'news-x', '✕'); x.type = 'button'; x.title = tr('Kapat');
  const close = () => { ov.remove(); removeEventListener('keydown', key, true); };
  const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  x.onclick = close;
  ov.onclick = (ev) => { if (ev.target === ov) close(); };
  addEventListener('keydown', key, true);
  p.append(x); ov.append(p); ui.menuEl.append(ov);
  return { p, close };
}

// the community rules; onOk: shown with "Kabul ediyorum" before the first line
export function showRules(ui, onOk) {
  const { p, close } = overlay(ui, 'gc-rules');
  p.append(h('h2', '', tr('Topluluk Kuralları')));
  const ul = h('ul', 'gc-rlist'); for (const r of RULES) ul.append(h('li', '', tr(r))); p.append(ul);
  p.append(h('p', 'gc-rnote', tr('Sohbet herkese açıktır ve kayıt altındadır. Uygunsuz bir şey görürsen @claude ile bildirebilirsin.')));
  if (onOk) {
    const b = h('button', 'mbtn primary', tr('Kabul ediyorum')); b.type = 'button';
    b.onclick = () => { try { localStorage.setItem(RULES_KEY, '1'); } catch (e) { /* ignore */ } close(); onOk(); };
    p.append(b);
  }
}

// a player's card: avatar, name, level, games; "Arkadaş Ekle" and "Davet Et"
export async function showPlayer(ui, m) {
  safe(() => ui._click());
  const cloud = ui.app.cloud;
  const { p, close } = overlay(ui, 'gc-prof');
  const top = h('div', 'gc-ptop');
  top.append(avatarEl(m.av, m.uid, 'av-md'));
  const nm = h('div', 'gc-pname');
  nm.append(h('b', '', pn(m.name) || tr('Oyuncu')));
  if (m.own) nm.append(h('span', 'gc-own', tr('Geliştirici')));
  const lv = levelOf(m.tp | 0);
  nm.append(h('small', 'prof-dim', tr('Seviye {0}', lv.level) + ' · ' + lv.rank));
  top.append(nm); p.append(top);
  const stats = h('div', 'gc-pstats prof-dim', tr('Yükleniyor...')); p.append(stats);
  const msg = h('div', 'mperr hidden'); p.append(msg);
  const say = (t, good) => { msg.textContent = t; msg.className = 'mperr' + (good ? ' prof-ok' : ''); };
  const acts = h('div', 'gc-pacts'); p.append(acts);
  const me = cloud && cloud.user && cloud.user.uid;
  if (m.fb === me) { stats.textContent = tr('Bu sensin.'); return; }
  const card = { fb: m.fb, name: m.name, avatar: m.av || null };
  safe(() => cloud.playerCard(m.fb).then((c) => {
    if (!c) { stats.textContent = ''; return; }
    card.avatar = c.avatar; stats.textContent = tr('{0} maç · {1} zafer', c.games, c.wins);
  }).catch(() => { stats.textContent = ''; }));
  const add = h('button', 'mbtn small', tr('+ Arkadaş Ekle')); add.type = 'button';
  const inv = h('button', 'mbtn small primary', tr('Davet Et')); inv.type = 'button';
  acts.append(add, inv);
  safe(() => cloud.friends().then((l) => { if (l.some((f) => f.fb === m.fb)) { add.disabled = true; add.textContent = tr('✔ Arkadaşın'); } }).catch(() => {}));
  add.onclick = async () => {
    safe(() => ui._click()); add.disabled = true;
    const r = await cloud.addFriend(card);
    if (!r.ok) { add.disabled = false; say(r.error, false); return; }
    add.textContent = tr('✔ Arkadaşın'); say(tr('{0} arkadaş listene eklendi.', pn(m.name)), true);
  };
  inv.onclick = async () => {
    safe(() => ui._click()); inv.disabled = true; say(tr('Oda kuruluyor...'), true);
    try {
      let s = ui.lobbySession;
      if (!(s && s.state && s.state.code)) { s = await ui._mpSession(); await s.host(); }
      const r = await cloud.invite(m.fb, s.state.code);
      close();
      if (ui.lobbySession !== s) ui.showLobby(s);
      safe(() => ui.toast(r.online ? '✉ ' + tr('{0} davet edildi.', pn(m.name)) : tr('{0} şu an çevrimdışı.', pn(m.name)), r.online ? 'good' : 'warn'));
    } catch (e) { inv.disabled = false; say(tr('Davet edilemedi: {0}', errText(e)), false); }
  };
}

// -> the panel element (it keeps itself up to date while it is on screen)
export function gchatPanel(ui) {
  const cloud = ui.app.cloud;
  const wrap = h('aside', 'gchat panel');
  const head = h('div', 'gc-head');
  head.append(h('span', 'gc-title', tr('Genel Sohbet')));
  const rb = h('button', 'gc-rbtn', tr('Kurallar')); rb.type = 'button'; rb.onclick = () => { safe(() => ui._click()); showRules(ui); };
  head.append(rb);
  const list = h('div', 'gc-list');
  list.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
  const form = h('form', 'gc-form');
  const inp = h('input', 'mpinput gc-inp');
  inp.maxLength = FB_MAX;
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.placeholder = tr('Herkese yaz… (@claude: hata / öneri)');
  inp.setAttribute('aria-label', tr('Genel sohbete yaz'));
  inp.onkeydown = (ev) => ev.stopPropagation();
  inp.onkeyup = (ev) => ev.stopPropagation();
  const go = h('button', 'mbtn small primary gc-go', tr('Gönder')); go.type = 'submit';
  const msg = h('div', 'gc-msg hidden');
  form.append(withMention(inp), go);
  wrap.append(head, list, msg, form);
  if (!cloud || !cloud.loggedIn) {
    list.append(h('div', 'prof-dim gc-empty', tr('Sohbet için giriş yap.')));
    form.classList.add('hidden');
    return wrap;
  }
  let msgT = 0;
  const say = (t, ok = false) => {
    clearTimeout(msgT);
    msg.textContent = t || '';
    msg.className = 'gc-msg' + (ok ? ' prof-ok' : '') + (t ? '' : ' hidden');
    if (t && ok) msgT = setTimeout(() => { msg.textContent = ''; msg.className = 'gc-msg hidden'; }, 4000);
  };
  const fmt = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const renderText = (s) => {
    const sp = h('span', 'gc-text');
    const parts = String(s || '').split(/(@claude)/gi);
    for (const pt of parts) {
      if (!pt) continue;
      if (/^@claude$/i.test(pt)) sp.append(h('span', 'cmention', pt));
      else sp.append(document.createTextNode(pt));
    }
    return sp;
  };
  const draw = () => {
    if (!wrap.isConnected) { if (wrap._shown) views.delete(draw); return; }   // (not on the page yet: drawn once it is)
    wrap._shown = true;
    const end = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.textContent = '';
    if (!lines.length) list.append(h('div', 'prof-dim gc-empty', tr('Henüz mesaj yok. İlk merhabayı sen de.')));
    for (const m of lines) {
      const r = h('div', 'gc-line' + (m.own ? ' own' : ''));
      r.append(h('span', 'gc-time', fmt(m.t)));
      const n = h('button', 'gc-name', pn(m.name) || tr('Oyuncu')); n.type = 'button';
      n.title = tr('Profili gör');
      n.onclick = () => showPlayer(ui, m);
      r.append(n);
      if (m.own) r.append(h('span', 'gc-own', tr('Geliştirici')));
      r.append(renderText(m.text));
      list.append(r);
    }
    if (end) list.scrollTop = list.scrollHeight;
  };
  views.add(draw);
  const load = () => cloud.gchatLines(lastId).then((a) => { add(a); if (!lines.length) draw(); }).catch((e) => { if (!lines.length) { list.textContent = ''; list.append(h('div', 'prof-dim gc-empty', errText(e))); } });
  requestAnimationFrame(() => { draw(); list.scrollTop = list.scrollHeight; });
  load();
  // (a line the inbox missed, e.g. during a reconnect) a light check every 20 s while the panel is shown
  const timer = setInterval(() => { if (wrap._shown && !wrap.isConnected) { clearInterval(timer); views.delete(draw); return; } if (!document.hidden) load(); }, 20000);
  const send = async () => {
    const text = clipChat(inp.value.replace(/\s+/g, ' ').trim());
    if (!text) return;
    const fb = hasClaude(text);
    go.disabled = true; say('');
    try {
      const m = await cloud.gchatSend(text);
      inp.value = '';
      if (m) add([m]);
      const name = (m && m.name) || safe(() => ui.app.getProfile()?.name, '') || '?';
      safe(() => logChat({ room: 'GENEL', name, text, mine: true }));
      if (fb) say(tr('✔ Geri bildirimin geliştiriciye iletildi, teşekkürler!'), true);
      list.scrollTop = list.scrollHeight;
    } catch (e) { say(errText(e)); }
    go.disabled = false; inp.focus();
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    if (!inp.value.trim()) return;
    if (!rulesOk()) { showRules(ui, send); return; }
    send();
  };
  return wrap;
}

export default { gchatPanel, gchatIn, showRules, showPlayer };
