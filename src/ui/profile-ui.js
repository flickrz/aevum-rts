// Aevum - the "Profil" screen: the account (avatar, user name, TP, sync, sign out, delete), stats, head-to-head,
// match history, export / import. Signing in with Google is required to play (cloud-ui.js loginScreen), so the
// profile always belongs to an account; the local copy (localStorage + IndexedDB) is its cache.
// Every user-controlled string (own / other players' names, imported files) goes in via textContent only.
import { AGES } from '../data.js';
import * as P from '../profile.js';
import { loginScreen, statusPill, avatarEl, avatarPicker, tpText, TP_RULE_TEXT } from './cloud-ui.js';
import { avatarOf } from '../avatars.js';
import { levelOf } from '../rank.js';
import { ask } from './ask.js';
import { RES_ICONS, keepIcons } from '../icons.js';
import { tr, loc, pn } from '../i18n.js';

const MAP_TR = { random: tr('Rastgele'), river: tr('Nehir Vadisi'), continent: tr('Kıta'), highlands: tr('Yaylalar'), plains: tr('Ovalar'), inlandsea: tr('İç Deniz'), islands: tr('Adalar') };
const SIZE_TR = { 96: tr('Eski Küçük'), 128: tr('Eski Orta'), 160: tr('Eski Büyük'), 192: tr('Minik'), 256: tr('Küçük'), 320: tr('Orta'), 384: tr('Büyük'), 448: tr('Çok Büyük'), 512: tr('Dev') };
const DIFF_TR = { easy: tr('Kolay'), normal: tr('Normal'), hard: tr('Zor') };
const RES_TR = { won: tr('Zafer'), lost: tr('Yenilgi'), abandoned: tr('Yarıda') };
const RES_ICON = RES_ICONS;
const RES_NAME = { food: tr('Yiyecek'), wood: tr('Odun'), stone: tr('Taş'), gold: tr('Altın') };
const STAT_TR = [['unitsTrained', tr('Eğitilen Birim')], ['unitsLost', tr('Kaybedilen Birim')], ['kills', tr('Öldürülen Düşman')], ['buildingsBuilt', tr('İnşa Edilen Bina')],
  ['buildingsLost', tr('Kaybedilen Bina')], ['razed', tr('Yıkılan Düşman Binası')], ['techs', tr('Araştırma')]];
const PAGE = 20;
const MAX_FILE = 8 * 1024 * 1024;

// text-only element (never innerHTML)
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const mapName = (m) => (Object.hasOwn(MAP_TR, m) ? MAP_TR[m] : String(m || '-'));
const fmtClock = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + String(s % 60).padStart(2, '0'); };
const fmtDur = (s) => { s = Math.max(0, Math.floor(s || 0)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60); return hh ? tr('{0} sa {1} dk', hh, mm) : tr('{0} dk {1} sn', mm, s % 60); };
const fmtDate = (t) => safe(() => new Date(t).toLocaleString(loc(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), '');
const fmtNum = (n) => safe(() => Math.floor(n || 0).toLocaleString(loc()), String(Math.floor(n || 0)));
const pct = (x) => Math.round((x || 0) * 100) + '%';
const ageName = (a) => (AGES[a] && tr(AGES[a].name)) || String(a);

// (kept for old call sites: the first window is the sign-in window now)
export function firstLaunch(ui) { loginScreen(ui); }

// ---------- profile screen ----------
// note: a message shown on top (green; red when bad)
export function menuProfile(ui, note, bad) {
  const app = ui.app;
  const prof = app.getProfile();
  const cloud = safe(() => app.cloud, null);
  if (!prof || !cloud || !cloud.loggedIn) { loginScreen(ui); return; }
  const online = true;   // (an account is required: the profile is always the signed-in account's)
  const box = ui._menuBox('');
  box.classList.add('profile');
  box.append(h('h2', '', tr('Profil')));

  // ---- account header: avatar | name, e-mail + status, TP ----
  const head = h('div', 'prof-head');
  const avCol = h('div', 'prof-avcol');
  const av = avatarEl(prof.avatar, prof.uid, 'av-lg');
  const avBtn = h('button', 'mbtn small', tr('Avatarı Değiştir')); avBtn.type = 'button';
  avCol.append(av, avBtn);
  const idCol = h('div', 'prof-idcol');
  const form = h('form', 'prof-nameform');
  form.append(h('label', '', tr('Kullanıcı Adı')));
  const nrow = h('div', 'prof-namerow');
  const inp = h('input', 'mpinput prof-name'); inp.maxLength = P.NAME_MAX; inp.value = prof.name; inp.autocomplete = 'nickname';
  inp.setAttribute('aria-label', tr('Kullanıcı adı'));
  const sv = h('button', 'mbtn small', tr('Kaydet')); sv.type = 'submit';
  nrow.append(inp, sv); form.append(nrow);
  const acc = h('div', 'prof-acc');
  acc.append(h('span', 'acc-who', cloud.user.email), statusPill(cloud));
  const t = cloud.tp;
  const tpBox = h('div', 'prof-tp');
  const L = levelOf(t.tp);
  tpBox.append(h('span', 'prof-lv', tr('Seviye {0} · {1} — sonraki seviye {2} TP', L.level, L.rank, L.next)), h('b', '', tpText(t.tp)), h('span', '', t.n ? tr('{0} zafer · {1} yenilgi sayıldı', t.w, t.l) : tr('Henüz puanlı maç yok')));
  idCol.append(form, acc, tpBox);
  head.append(avCol, idCol);
  box.append(head);
  box.append(h('div', 'prof-tprule', TP_RULE_TEXT));
  const msg = h('div', 'mperr' + (note ? (bad ? '' : ' prof-ok') : ' hidden'), note || ''); msg.setAttribute('role', 'status'); box.append(msg);
  const say = (tx, good) => { msg.textContent = tx; msg.className = 'mperr' + (good ? ' prof-ok' : ''); };

  // avatar picker (opens under the header)
  const pickWrap = h('div', 'prof-avpick hidden');
  box.append(pickWrap);
  avBtn.onclick = () => {
    safe(() => ui._click());
    if (!pickWrap.classList.contains('hidden')) { pickWrap.classList.add('hidden'); pickWrap.textContent = ''; return; }
    pickWrap.classList.remove('hidden');
    const cur = avatarOf(app.getProfile().avatar, prof.uid);
    pickWrap.append(avatarPicker(cur, async (id, btn) => {
      safe(() => ui._click());
      for (const x of pickWrap.querySelectorAll('.av-pick')) x.classList.remove('on');
      btn.classList.add('on');
      say(tr('Avatar kaydediliyor...'), true);
      const r = await cloud.setAvatar(id);
      if (!r.ok) { say(r.error, false); safe(() => ui._error()); return; }
      menuProfile(ui, tr('Avatar değiştirildi.'));
    }));
  };

  let renaming = false;
  const rename = async () => {
    if (renaming) return;
    if (P.checkName(inp.value).name === app.getProfile().name) { say(tr('Ad değişmedi.'), true); return; }
    renaming = true; sv.disabled = true; say(tr('Ad kontrol ediliyor...'), true);
    const r = await cloud.rename(inp.value);
    renaming = false; sv.disabled = false;
    if (!r.ok) { say(r.error, false); safe(() => ui._error()); return; }
    inp.value = r.profile.name; say(tr('Ad kaydedildi: {0}', r.profile.name), true);
  };
  form.onsubmit = (ev) => { ev.preventDefault(); safe(() => ui._click()); rename(); };
  inp.onkeydown = (ev) => ev.stopPropagation();   // the game's hotkeys must not see the typing (Enter submits the form)

  // ---- account actions ----
  const acts = h('div', 'prof-actions');
  if (cloud.status === 'expired') {
    acts.append(h('div', 'prof-dim', tr('Oturumun sona erdi: aynı Google hesabıyla tekrar giriş yap.')));
    import('./cloud-ui.js').then((m) => acts.prepend(m.googleBlock(ui, { small: true, done: (n) => menuProfile(ui, n) })));
  }
  // (sync runs by itself: after every match / save, on start, every few minutes and when the connection comes back)
  const out = h('button', 'mbtn small', tr('Çıkış Yap'));
  out.onclick = async () => {
    safe(() => ui._click());
    const pend = cloud.status === 'pending' || cloud.status === 'offline';
    if (!(await ask({ title: tr('Çıkış'), text: tr('Çıkış yapılsın mı?\nProfilin, maç geçmişin ve kayıtların hesabında kalır; tekrar giriş yapınca geri gelir.') +
      (pend ? tr('\n\nUyarı: henüz gönderilemeyen veriler var; tekrar giriş yaptığında gönderilir.') : ''), ok: tr('Çıkış Yap') }))) return;
    if (app.game && !app.demo) safe(() => app.toMenu());
    cloud.logout();
    ui._menuMain(tr('Çıkış yapıldı.'));
  };
  acts.append(out);
  box.append(acts);
  box.append(h('div', 'prof-meta', tr('Oyuncu kimliği: {0}… · Oluşturuldu: {1}', prof.uid.slice(0, 8), fmtDate(prof.created))));

  const body = h('div', 'prof-body', tr('Yükleniyor...')); box.append(body);

  // export / import
  const tools = h('div', 'prof-tools');
  const file = h('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.style.display = 'none';
  const bExp = h('button', 'mbtn small', tr('Dışa Aktar')), bImp = h('button', 'mbtn small', tr('İçe Aktar'));
  bExp.title = tr('Profilini ve maç geçmişini bir JSON dosyası olarak indir');
  bImp.title = tr('Daha önce dışa aktarılmış bir profil dosyasını yükle');
  tools.append(bExp, bImp, file); box.append(tools);
  ui._mbtn(box, tr('Geri'), () => ui._menuMain());

  let history = [];
  bExp.onclick = () => {
    safe(() => ui._click());
    const p = app.getProfile(); if (!p) return;
    try {
      const blob = new Blob([JSON.stringify(P.exportData(p, history), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      const fname = (p.name.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'oyuncu');
      a.href = URL.createObjectURL(blob);
      a.download = 'aevum-profil-' + fname + '-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      say(tr('Profil dosyası indirildi ({0} maç).', history.length), true);
    } catch (e) { say(tr('Dışa aktarılamadı: {0}', (e && e.message) || e), false); }
  };
  bImp.onclick = () => { safe(() => ui._click()); file.value = ''; file.click(); };
  file.onchange = async () => {
    const f = file.files && file.files[0]; if (!f) return;
    if (f.size > MAX_FILE) { say(tr('Dosya çok büyük.'), false); return; }
    let text;
    try { text = await f.text(); } catch (e) { say(tr('Dosya okunamadı.'), false); return; }
    const v = P.validateImport(text);
    if (!v.ok) { say(tr('İçe aktarılamadı: {0}', v.error), false); return; }
    const mine = app.getProfile();
    let replaced = false;
    // the identity belongs to the account; an import only adds history
    if (mine && v.profile.uid !== mine.uid && !online) {
      // (cancel / Esc = the old confirm's Cancel: keep my profile, merge only the history)
      replaced = await ask({ title: tr('Farklı Profil'), text: tr('Dosyadaki profil ("{0}") senin profilinden farklı.\nDeğiştirirsen dosyadaki kimlik ve ad kullanılır; değiştirmezsen yalnızca maç geçmişi birleştirilir.', v.profile.name), ok: tr('Profilimi değiştir'), cancel: tr('Profilim kalsın') });
      if (replaced) app.replaceProfile(v.profile);
    }
    // only the records of the profile I keep: another player's view of the same match would count it twice
    const owner = replaced || !mine ? v.profile.uid : mine.uid;
    const { keep, skipped } = P.ownRecords(v.history, owner);
    const before = await app.listHistory();
    const ids = new Set(before.map((r) => r.id));
    const merged = P.mergeHistory(before, keep);
    const fresh = keep.filter((r) => !ids.has(r.id)).length;
    const ok = await app.putHistory(merged);
    if (!ok) { say(tr('Maç geçmişi kaydedilemedi.'), false); return; }
    menuProfile(ui, (replaced ? tr('Profil değiştirildi. ') : '') + tr('{0} maç okundu, {1} yeni maç eklendi.', v.history.length, fresh) +
      (skipped ? tr(' Başka bir oyuncuya ait {0} maç atlandı (aynı maç iki kez sayılmasın diye).', skipped) : ''));
  };


  const load = () => Promise.resolve(safe(() => app.listHistory(), [])).then((l) => {
    if (!body.isConnected && history.length) return;
    history = Array.isArray(l) ? l : [];
    renderBody(body, history, prof);
  }).catch(() => { body.textContent = tr('Maç geçmişi okunamadı.'); });
  load();
  // logged in: fetch the matches played on other PCs (incremental; the local cache shows first; 'lazy': not again
  // when this browser pulled in the last 20 minutes)
  if (online) cloud.flush({ pull: 'lazy' }).then((r) => { if (r && r.added && body.isConnected) load(); }).catch(() => {});
}

function card(label, value, sub) {
  const c = h('div', 'prof-card'); c.append(h('b', '', value), h('span', '', label));
  if (sub) c.append(h('small', '', sub));
  return c;
}
function section(parent, title) { parent.append(h('h3', 'prof-h', title)); }

function renderBody(body, history, prof) {
  body.textContent = '';
  const t = P.summarize(history);
  const cards = h('div', 'prof-cards');
  cards.append(card(tr('Maç'), fmtNum(t.games), tr('{0} tek · {1} çok oyunculu', t.sp, t.mp) + (t.abandoned ? ' · ' + tr('{0} yarıda bırakıldı', t.abandoned) : '')), card(tr('Galibiyet'), fmtNum(t.wins)), card(tr('Mağlubiyet'), fmtNum(t.losses)),
    card(tr('Kazanma Oranı'), t.wins + t.losses ? pct(t.winRate) : '-'), card(tr('Toplam Süre'), fmtDur(t.totalTime)), card(tr('En Çok Oynanan'), t.topMap ? mapName(t.topMap) : '-', t.topMap ? tr('{0} maç', t.mapCounts[t.topMap]) : ''));
  body.append(cards);
  if (!history.length) { body.append(h('div', 'prof-empty', tr('Henüz kayıtlı maç yok. Bir maç bitirdiğinde (ya da 30 saniyeden uzun bir maçtan çıktığında) burada görünür.'))); return; }

  // head-to-head (humans with a profile)
  const hh = P.headToHead(history, prof.uid);
  section(body, tr('Arkadaşlarınla'));
  if (!hh.length) body.append(h('div', 'prof-empty', tr('Henüz başka bir oyuncuyla çok oyunculu maç yok.')));
  else {
    const tb = h('table', 'st prof-h2h');
    const hr = h('tr'); for (const x of [tr('Oyuncu'), tr('Karşı karşıya'), tr('Aynı takımda'), tr('Son maç')]) hr.append(h('th', '', x)); tb.append(hr);
    for (const o of hh) {
      const tr = h('tr');
      const wl = (b) => (b.games ? tr('{0} G - {1} M', b.wins, b.losses) + (b.abandoned ? ' · ' + tr('{0} yarıda', b.abandoned) : '') : '-');
      tr.append(h('td', 'prof-pn', pn(o.name)), h('td', o.vs.wins > o.vs.losses ? 'prof-w' : o.vs.losses > o.vs.wins ? 'prof-l' : '', wl(o.vs)), h('td', '', wl(o.with)), h('td', 'prof-dim', fmtDate(o.lastAt)));
      tb.append(tr);
    }
    const wrap = h('div', 'prof-scroll'); wrap.append(tb); body.append(wrap);
  }

  // summed stats
  section(body, tr('Toplam İstatistikler'));
  const sg = h('div', 'prof-stats');
  for (const r of P.RES_KEYS) sg.append(statRow(RES_ICON[r] + ' ' + tr('Toplanan {0}', RES_NAME[r]), fmtNum(t.stats.gathered[r])));
  for (const [k, n] of STAT_TR) sg.append(statRow(n, fmtNum(t.stats[k])));
  sg.append(statRow(tr('En yüksek çağ'), ageName(t.maxAge)));
  body.append(sg);

  // recent matches
  section(body, tr('Son Maçlar'));
  const list = h('div', 'prof-list'); body.append(list);
  let shown = 0;
  const more = h('button', 'mbtn small', tr('Daha fazla göster'));
  const page = () => {
    for (const r of history.slice(shown, shown + PAGE)) list.append(matchItem(r));
    shown = Math.min(history.length, shown + PAGE);
    more.style.display = shown < history.length ? '' : 'none';
    more.textContent = tr('Daha fazla göster ({0})', history.length - shown);
  };
  more.onclick = page;
  body.append(more);
  page();
}
// (the label may hold sprite icons: text is escaped, only our icon markup stays markup)
function statRow(label, value) { const d = h('div', 'prof-stat'), l = h('span', ''); l.innerHTML = keepIcons(String(label).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))); d.append(l, h('b', '', value)); return d; }

function matchItem(r) {
  const ps = Array.isArray(r.players) ? r.players : [];
  const mine = ps[r.me | 0] || {};
  const opp = ps.filter((p, i) => i !== (r.me | 0) && p.team !== mine.team);
  const ally = ps.filter((p, i) => i !== (r.me | 0) && p.team === mine.team);
  const who = (p) => (p.ai ? '🤖 ' + (pn(p.name) || tr('Yapay Zekâ')) + (p.difficulty ? ' (' + (DIFF_TR[p.difficulty] || p.difficulty) + ')' : '') : '👤 ' + (pn(p.name) || tr('Oyuncu')));
  const d = h('div', 'saveitem prof-item res-' + r.result);
  const top = h('div', 'prof-row');
  const left = h('span', 'prof-main');
  left.append(h('b', 'prof-res', RES_TR[r.result] || r.result), h('span', '', ' · ' + mapName(r.mapType) + ' (' + (SIZE_TR[r.mapSize] || r.mapSize) + ') · ' + (r.mode === 'mp' ? tr('Çok oyunculu') : tr('Tek oyunculu') + (r.difficulty ? ', ' + (DIFF_TR[r.difficulty] || r.difficulty) : ''))));
  left.append(h('br'), h('small', '', tr('Rakipler: ') + (opp.length ? opp.map(who).join(', ') : '-') + (ally.length ? tr(' · Takım arkadaşı: ') + ally.map(who).join(', ') : '')));
  const right = h('small', 'prof-when'); right.append(h('span', '', fmtDate(r.endedAt)), h('br'), h('span', '', tr('Süre {0}', fmtClock(r.gameTime))));
  top.append(left, right); d.append(top);
  let det = null;
  d.onclick = () => {
    if (det) { det.remove(); det = null; d.classList.remove('open'); return; }
    d.classList.add('open');
    det = h('div', 'prof-det');
    const s = r.stats || {}, g = s.gathered || {};
    const grid = h('div', 'prof-stats');
    grid.append(statRow(tr('Ulaşılan çağ'), ageName(r.myAge)));
    for (const k of P.RES_KEYS) grid.append(statRow(RES_ICON[k] + ' ' + RES_NAME[k], fmtNum(g[k])));
    for (const [k, n] of STAT_TR) grid.append(statRow(n, fmtNum(s[k])));
    det.append(grid);
    const pl = h('div', 'prof-players');
    ps.forEach((p, i) => {
      const line = h('div', '');
      line.append(h('span', 'prof-team', 'T' + p.team), h('span', p.won ? 'prof-w' : p.won === false ? 'prof-l' : '', ' ' + who(p) + (i === (r.me | 0) ? tr(' (sen)') : '') + (p.won ? tr(' — kazandı') : '')));
      pl.append(line);
    });
    det.append(pl);
    d.append(det);
  };
  return d;
}

export default { firstLaunch, menuProfile };
