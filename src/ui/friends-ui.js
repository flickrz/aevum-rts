// Aevum - friends: the "Arkadaşlar" screen (my friends with online status, registered players, search by name),
// the invite panel of the lobby and the incoming invite card. Room codes keep working as before; an invite only
// sends the code to a friend, who joins with one click. All names go in via textContent.
import { avatarEl, tpText } from './cloud-ui.js';
import { levelOf } from '../rank.js';
import { ask } from './ask.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const btn = (cls, text, fn) => { const b = h('button', cls, text); b.type = 'button'; b.onclick = fn; return b; };
const errText = (e) => (e && e.message) || String(e || 'Hata');

// one player row: avatar, name (+ stats), online dot, actions
function row(card, { online, actions = [], sub }) {
  const r = h('div', 'fr-row');
  const av = h('span', 'fr-av'); av.append(avatarEl(card.avatar, card.fb, 'av-md'));
  if (online != null) av.append(h('i', 'fr-dot' + (online ? ' on' : ''), ''));
  const t = h('span', 'fr-txt');
  t.append(h('b', 'fr-name', card.name));
  t.append(h('small', 'fr-sub', sub != null ? sub : (online == null ? '' : online ? 'Çevrimiçi' : 'Çevrimdışı') + (card.games ? (online == null ? '' : ' · ') + card.games + ' maç · ' + card.wins + ' zafer' : '')));
  r.append(av, t);
  const a = h('span', 'fr-acts'); for (const x of actions) a.append(x); r.append(a);
  return r;
}

// ---------- the Arkadaşlar screen ----------
export function menuFriends(ui, note) {
  const cloud = ui.app.cloud;
  if (!cloud || !cloud.loggedIn) { ui._menuMain(); return; }
  const box = ui._menuBox('');
  box.classList.add('friends');
  box.append(h('h2', '', 'Arkadaşlar'),
    h('div', 'mpnote', 'Arkadaşlarını ekle; çevrimiçi olanları tek tıkla oyununa davet et.'));
  const msg = h('div', 'mperr' + (note ? ' prof-ok' : ' hidden'), note || ''); msg.setAttribute('role', 'status'); box.append(msg);
  const say = (t, good) => { msg.textContent = t; msg.className = 'mperr' + (good ? ' prof-ok' : ''); };

  // my friends
  box.append(h('h3', 'prof-h', 'Arkadaşlarım'));
  const mine = h('div', 'fr-list', 'Yükleniyor...'); box.append(mine);
  // find players
  box.append(h('h3', 'prof-h', 'Oyuncu Bul'));
  const form = h('form', 'fr-search');
  const inp = h('input', 'mpinput'); inp.placeholder = 'Kullanıcı adı'; inp.maxLength = 20; inp.setAttribute('aria-label', 'Kullanıcı adı ara');
  inp.onkeydown = (ev) => ev.stopPropagation();
  const go = h('button', 'mbtn small', 'Ara'); go.type = 'submit';
  form.append(inp, go); box.append(form);
  const found = h('div', 'fr-list'); box.append(found);
  box.append(h('h3', 'prof-h', 'Kayıtlı Oyuncular'));
  const all = h('div', 'fr-list fr-scroll', 'Yükleniyor...'); box.append(all);
  ui._mbtn(box, 'Geri', () => ui._menuMain());

  let friends = [], onl = new Set(), friendSet = new Set();
  const drawMine = () => {
    mine.textContent = '';
    if (!friends.length) { mine.append(h('div', 'prof-empty', 'Henüz arkadaşın yok. Aşağıdan oyuncu ekleyebilirsin.')); return; }
    const sorted = friends.slice().sort((a, b) => (onl.has(b.fb) - onl.has(a.fb)) || a.name.localeCompare(b.name, 'tr'));
    for (const f of sorted) {
      const inv = btn('mbtn small primary', 'Davet Et', () => inviteFromMenu(ui, f, say, inv));
      inv.disabled = !onl.has(f.fb);
      inv.title = onl.has(f.fb) ? 'Bir oda kurar ve ' + f.name + ' oyuncusunu davet eder' : 'Şu an çevrimdışı';
      const rm = btn('lb-x', '✕', async () => {
        if (!(await ask({ title: 'Arkadaşı Çıkar', text: f.name + ' arkadaş listenden çıkarılsın mı?', ok: 'Çıkar', danger: true }))) return;
        const r = await cloud.removeFriend(f.fb);
        if (!r.ok) { say(r.error, false); return; }
        friends = friends.filter((x) => x.fb !== f.fb); friendSet.delete(f.fb); drawMine(); drawAll();
      });
      rm.title = 'Listeden çıkar';
      mine.append(row(f, { online: onl.has(f.fb), actions: [inv, rm] }));
    }
  };
  const addBtn = (c) => {
    if (friendSet.has(c.fb)) return h('span', 'fr-tag', '✔ Arkadaşın');
    const b = btn('mbtn small', '+ Ekle', async () => {
      b.disabled = true;
      const r = await cloud.addFriend(c);
      if (!r.ok) { b.disabled = false; say(r.error, false); return; }
      friends.push(c); friendSet.add(c.fb);
      say(c.name + ' arkadaş listene eklendi.', true);
      refreshOnline(); drawMine(); drawAll(); drawFound();
    });
    return b;
  };
  let players = [], foundCard = null;
  const drawAll = () => {
    all.textContent = '';
    if (!players.length) { all.append(h('div', 'prof-empty', 'Başka kayıtlı oyuncu yok.')); return; }
    for (const c of players) all.append(row(c, { online: onl.has(c.fb), actions: [addBtn(c)] }));
  };
  const drawFound = () => { found.textContent = ''; if (foundCard) found.append(row(foundCard, { online: onl.has(foundCard.fb), actions: [addBtn(foundCard)] })); };
  form.onsubmit = async (ev) => {
    ev.preventDefault(); safe(() => ui._click());
    const q = inp.value.trim(); if (!q) return;
    go.disabled = true;
    try {
      foundCard = await cloud.findPlayer(q);
      if (!foundCard) say('"' + q + '" adında bir oyuncu yok.', false);
      else if (foundCard.fb === cloud.user.uid) { foundCard = null; say('Bu sensin.', true); }
      else { say('', true); msg.className = 'mperr hidden'; }
      drawFound();
    } catch (e) { say('Aranamadı: ' + errText(e), false); }
    go.disabled = false;
  };
  const refreshOnline = async () => {
    try { onl = await cloud.online([...new Set([...friends, ...players].map((c) => c.fb))]); } catch (e) { onl = new Set(); }
    if (!box.isConnected) return;
    drawMine(); drawAll(); drawFound();
  };
  (async () => {
    try { friends = await cloud.friends(); } catch (e) { friends = []; say('Arkadaş listesi alınamadı: ' + errText(e), false); }
    friendSet = new Set(friends.map((f) => f.fb));
    drawMine();
    try { players = await cloud.players(); } catch (e) { players = []; all.textContent = 'Oyuncu listesi alınamadı (' + errText(e) + '). Adıyla arayabilirsin.'; }
    if (players.length || all.textContent === 'Yükleniyor...') drawAll();
    await refreshOnline();
    // online status stays fresh while the screen is open
    const t = setInterval(() => { if (!box.isConnected) { clearInterval(t); return; } refreshOnline(); }, 10000);
  })();
}

// "Davet Et" on the friends screen: open a room, invite the friend, show the lobby
async function inviteFromMenu(ui, f, say, b) {
  safe(() => ui._click());
  b.disabled = true; say('Oda kuruluyor...', true);
  try {
    const s = await ui._mpSession();
    await s.host();
    ui.showLobby(s);
    const r = await ui.app.cloud.invite(f.fb, s.state.code);
    safe(() => ui.toast(r.online ? '✉ ' + f.name + ' davet edildi.' : f.name + ' şu an çevrimdışı.', r.online ? 'good' : 'warn'));
    safe(() => ui._lobbyNote?.(r.online ? f.name + ' davet edildi; kabul edince lobiye girer.' : f.name + ' şu an çevrimdışı.'));
  } catch (e) { say('Davet edilemedi: ' + errText(e), false); b.disabled = false; }
}

// ---------- the lobby's invite panel ----------
// online friends with a "Davet Et" button; refreshes every 10 s while the lobby is open
export function lobbyInvites(ui, session) {
  const cloud = ui.app.cloud;
  const wrap = h('div', 'lb-invite');
  if (!cloud || !cloud.loggedIn) return wrap;
  const head = h('div', 'lb-invite-h'); head.append(h('span', '', 'Arkadaşını davet et'));
  const list = h('div', 'lb-invite-list', 'Yükleniyor...');
  wrap.append(head, list);
  const sent = new Map();   // fb -> time
  let friends = null;
  const draw = async () => {
    if (!wrap.isConnected && friends) return false;
    try { if (!friends) friends = await cloud.friends(); } catch (e) { list.textContent = 'Arkadaş listesi alınamadı.'; return true; }
    if (!friends.length) {
      list.textContent = '';
      list.append(h('span', 'prof-dim', 'Henüz arkadaşın yok. '));
      list.append(btn('acc-link', 'Arkadaş ekle', () => { safe(() => session.close()); ui.lobbySession = null; menuFriends(ui); }));
      return true;
    }
    let onl = new Set();
    try { onl = await cloud.online(friends.map((f) => f.fb)); } catch (e) { /* shown as offline */ }
    // (friends already in the room are not offered; slot names are the relay-verified account names)
    const inRoom = new Set(((session.state && session.state.slots) || []).filter((s) => s.kind === 'human' && s.peer).map((s) => String(s.name).toLocaleLowerCase('tr')));
    list.textContent = '';
    const on = friends.filter((f) => onl.has(f.fb) && !inRoom.has(String(f.name).toLocaleLowerCase('tr')));
    if (!on.length) { list.append(h('span', 'prof-dim', 'Davet edilebilecek çevrimiçi arkadaşın yok. Sağdaki listeden herkesi davet edebilirsin.')); return true; }
    for (const f of on) {
      const chip = h('span', 'lb-friend');
      chip.append(avatarEl(f.avatar, f.fb, 'av-sm'), h('span', '', f.name));
      const b = btn('mbtn small', sent.has(f.fb) ? 'Davet gitti ✔' : 'Davet Et', async () => {
        safe(() => ui._click());
        const code = session.state && session.state.code;
        if (!code) return;
        b.disabled = true;
        try { const r = await cloud.invite(f.fb, code); sent.set(f.fb, Date.now()); b.textContent = r.online ? 'Davet gitti ✔' : 'Çevrimdışı'; } catch (e) { b.textContent = 'Gönderilemedi'; b.disabled = false; }
      });
      if (sent.has(f.fb) && Date.now() - sent.get(f.fb) < 15000) b.disabled = true;
      chip.append(b);
      list.append(chip);
    }
    return true;
  };
  draw();
  const t = setInterval(async () => { if (!wrap.isConnected || ui.lobbySession !== session) { clearInterval(t); return; } await draw(); }, 10000);
  return wrap;
}

// ---------- an incoming invite ----------
// m: {type:'invite', code, from: {fb, name, av, tp}}
export function showInvite(ui, m) {
  if (!m || m.type !== 'invite' || !/^[A-Z0-9]{5}$/.test(m.code || '') || !m.from) return;
  const host = ui.root || document.body;
  let stack = host.querySelector('.invites');
  if (!stack) { stack = h('div', 'invites'); host.append(stack); }
  for (const c of stack.querySelectorAll('.invite-card')) if (c.dataset.code === m.code) c.remove();
  const card = h('div', 'invite-card panel');
  card.dataset.code = m.code;
  card.setAttribute('role', 'alertdialog');
  const top = h('div', 'invite-top');
  top.append(avatarEl(m.from.av, m.from.uid, 'av-md'));
  const t = h('div', 'invite-txt');
  t.append(h('b', '', m.from.name || 'Bir oyuncu'), h('span', '', ' seni oyununa davet ediyor'));
  const L = levelOf(m.from.tp | 0);
  t.append(h('small', '', 'Seviye ' + L.level + ' · ' + tpText(m.from.tp | 0)));
  top.append(t);
  const acts = h('div', 'invite-acts');
  const close = () => { card.remove(); clearTimeout(timer); };
  const yes = btn('mbtn small primary', 'Katıl', async () => {
    safe(() => ui._click());
    const app = ui.app;
    if (app.net) { if (!(await ask({ title: 'Davete Katıl', text: 'Şu an çok oyunculu bir maçtasın. Ondan çıkıp davete katılmak istiyor musun?', ok: 'Katıl' }))) return; safe(() => app.leaveMultiplayer()); }
    else if (app.game && !app.demo && !app.game.over && ui.mode === 'hud') { if (!(await ask({ title: 'Davete Katıl', text: app.game.cfg?.tutorial ? 'Öğretici kapanacak (öğretici kaydedilmez). Davete katılınsın mı?' : 'Oyunun kapanacak (otomatik kayıt alınır). Davete katılınsın mı?', ok: 'Katıl' }))) return; await Promise.resolve(safe(() => app.saveGame('auto'))).catch(() => {}); safe(() => app.toMenu()); }
    if (ui.lobbySession) { safe(() => ui.lobbySession.close()); ui.lobbySession = null; }
    yes.disabled = true; yes.textContent = 'Katılınıyor...';
    try {
      const s = await ui._mpSession();
      await s.join(m.code);
      close();
      ui.showLobby(s);
    } catch (e) { yes.disabled = false; yes.textContent = 'Katıl'; t.append(h('small', 'mperr', 'Katılınamadı: ' + errText(e))); }
  });
  const no = btn('mbtn small', 'Reddet', () => { safe(() => ui._click()); close(); });
  acts.append(yes, no);
  card.append(top, acts);
  stack.append(card);
  safe(() => ui.app.audio?.ui('select'));
  const timer = setTimeout(close, 90000);
}

export default { menuFriends, lobbyInvites, showInvite };
