import { tr } from '../i18n.js';
// Aevum - the "İstatistikler" screen: who is playing right now and the last 30 days (visitors, signed-in players,
// matches). Only the game's owner gets the button (the server checks it again: AEVUM_OWNERS in server.js).
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const DAYS_TR = [tr('Paz'), tr('Pzt'), tr('Sal'), tr('Çar'), tr('Per'), tr('Cum'), tr('Cmt')];
const dayLabel = (d) => { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd)); return dd + '.' + String(m).padStart(2, '0') + ' ' + DAYS_TR[t.getUTCDay()]; };

function tile(label, value, sub) {
  const t = h('div', 'st-tile');
  t.append(h('b', 'st-num', value), h('span', 'st-lab', label));
  if (sub) t.append(h('small', 'st-sub', sub));
  return t;
}

export function menuStats(ui) {
  const cloud = ui.app.cloud;
  if (!cloud || !cloud.loggedIn) { ui._menuMain(); return; }
  const box = ui._menuBox('');
  box.classList.add('stats');
  box.append(h('h2', '', tr('İstatistikler')));
  const body = h('div', 'st-body', tr('Yükleniyor...'));
  box.append(body);
  let timer = null;
  const load = () => cloud.stats().then((r) => {
    if (!box.isConnected) { clearInterval(timer); return; }
    body.textContent = '';
    const o = r.online || {};
    body.append(h('h3', 'prof-h', tr('Şu an')));
    const now = h('div', 'st-tiles');
    now.append(tile(tr('çevrimiçi'), o.total | 0, tr('{0} giriş yapmış', o.signedIn | 0)), tile(tr('menüde'), o.menu | 0), tile(tr('tek oyunculu'), o.sp | 0), tile(tr('çok oyunculu'), o.mp | 0));
    body.append(now);
    const td = r.today || {};
    body.append(h('h3', 'prof-h', tr('Bugün')));
    const today = h('div', 'st-tiles');
    today.append(tile(tr('ziyaretçi'), td.visitors | 0), tile(tr('oyuncu'), td.players | 0), tile(tr('maç'), (td.sp | 0) + (td.mp | 0), tr('{0} tek · {1} çok', td.sp | 0, td.mp | 0)), tile(tr('en yoğun an'), td.peak | 0, tr('aynı anda')));
    body.append(today);
    body.append(h('h3', 'prof-h', tr('Son 30 gün')));
    const days = Array.isArray(r.days) ? r.days : [];
    const max = Math.max(1, ...days.map((d) => d.visitors | 0));
    const tbl = h('div', 'st-table');
    const head = h('div', 'st-row st-headrow');
    for (const c of [tr('Gün'), tr('Ziyaretçi'), tr('Oyuncu'), tr('Maç'), tr('Zirve')]) head.append(h('span', '', c));
    tbl.append(head);
    for (const d of days) {
      const row = h('div', 'st-row');
      const vis = h('span', 'st-vis');
      const bar = h('i', 'st-bar'); bar.style.width = Math.round(((d.visitors | 0) / max) * 100) + '%';
      vis.append(bar, h('em', '', d.visitors | 0));
      row.append(h('span', 'st-day', dayLabel(d.day)), vis, h('span', '', d.players | 0), h('span', '', (d.sp | 0) + (d.mp | 0)), h('span', '', d.peak | 0));
      tbl.append(row);
    }
    body.append(tbl);
    body.append(h('div', 'lb-hint', r.persisted
      ? tr('Ziyaretçi: oyunu açan tarayıcı. Oyuncu: Google ile giriş yapan hesap. Günler Türkiye saatine göre. Ekran dakikada bir yenilenir.')
      : tr('⚠ Kalıcı kayıt kapalı (sunucuda AEVUM_SA yok): sayılar sunucu yeniden başlayınca sıfırlanır.')));
  }).catch((e) => { if (box.isConnected) body.textContent = (e && e.message) || tr('İstatistikler alınamadı.'); });
  load();
  // (the server keeps the past days in memory: a refresh costs no Firestore read; a hidden tab does not ask)
  timer = setInterval(() => { if (!box.isConnected) { clearInterval(timer); return; } if (!document.hidden) load(); }, 60 * 1000);
  ui._mbtn(box, tr('Geri'), () => { clearInterval(timer); ui._menuMain(); });
}
