// Aevum - "Kayıtlı Maça Devam Et": pick a multiplayer save, open its lobby, continue the match.
// Kept out of ui.js on purpose; it reuses the lobby's CSS classes (lb-*) and the UI's menu helpers.
import { PLAYER_COLORS } from '../data.js';
import { withMention } from './mention.js';
import { saveBadge, saveBadgeTitle, confirmDeleteSave } from './cloud-ui.js';
import { ask } from './ask.js';
import { tr } from '../i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const DIFF = [['easy', tr('Kolay')], ['normal', tr('Normal')], ['hard', tr('Zor')]];
const mins = (tick) => Math.floor((tick | 0) / 1800);

function myName(ui) { return safe(() => ui._mpName(), '') || 'Komutan'; }

// ---------- save picker (host) ----------
export function menuResume(ui, errText) {
  const app = ui.app;
  const box = ui._menuBox(tr('<h2>Kayıtlı Maça Devam Et</h2><div class="mpnote">Kaydettiğin bir çok oyunculu maçı seç. Bir oda açılır; davet ettiğin oyuncular gelince hesabından tanınıp kendi yerine oturur.</div>'));
  const err = el('div', 'mperr hidden'); box.append(err);
  const list = el('div', 'savelist', tr('Yükleniyor...')); box.append(list);
  const fail = (e) => { err.textContent = (e && e.message) || String(e || tr('Hata')); err.classList.remove('hidden'); };
  if (errText) fail(errText);
  let busy = false;
  Promise.resolve(safe(() => app.listMpSaves({ fresh: true }), [])).then((l) => {
    list.innerHTML = '';
    if (!l || !l.length) { list.innerHTML = tr('<div style="color:var(--dim);text-align:center;padding:20px">Çok oyunculu kayıt yok. Maç sırasında 💾 Kaydet\'e bas (kurucu 2 dakikada bir otomatik kaydeder).</div>'); return; }
    for (const s of l) {
      const ppl = (s.players || []).map((p) => (p.kind === 'ai' ? '🤖 ' : '') + esc(p.name) + ' <small>T' + (p.team | 0) + '</small>').join(' · ');
      // (☁: the save is in the account's cloud only / newer there; downloaded when it is opened, e.g. on another PC)
      const d = el('div', 'saveitem', `<span>${esc(saveBadge(s) + (s.name || s.key))}<br><small>${ppl}</small></span><small>${s.time ? new Date(s.time).toLocaleString('tr-TR') : ''}</small>`);
      if (s.cloud) d.title = saveBadgeTitle(s);
      const del = el('button', 'lb-x', '✕'); del.title = tr('Kaydı sil');
      del.onclick = async (ev) => {
        ev.stopPropagation();
        const c = await confirmDeleteSave(s); if (!c) return;
        Promise.resolve(safe(() => app.deleteSave(s.key, c))).then((r) => menuResume(ui, r && r.ok === false ? r.error : ''));
      };
      d.append(del);
      d.onclick = async () => {
        if (busy) return; busy = true; safe(() => ui._click());
        err.classList.add('hidden');
        d.style.opacity = '0.6';
        if (s.cloud === 'only' || s.cloud === 'newer') d.lastChild.previousSibling.textContent = tr('☁ İndiriliyor...');
        try {
          const rec = await app.getSave(s.key);
          if (!rec || !rec.data) throw new Error(tr('Kayıt okunamadı.'));
          const sess = await ui._mpSession();
          await sess.hostResume(rec);
          showResumeLobby(ui, sess);
        } catch (e) { fail(e); d.style.opacity = ''; busy = false; }
      };
      list.append(d);
    }
  }).catch(() => { list.textContent = tr('Kayıtlar okunamadı.'); });
  ui._mbtn(box, tr('Geri'), () => ui._menuMulti());
}

// ---------- the continue lobby (host and joiners) ----------
export function showResumeLobby(ui, session) {
  const app = ui.app;
  ui.mode = 'menu';
  ui.menuEl.classList.remove('hidden'); ui.hudEl.classList.add('hidden');
  ui.lobbySession = session;
  const box = ui._menuBox('');
  box.classList.add('lobby');
  const me = () => session.t && session.t.id;
  let state = session.state, left = false, loading = '';
  const chatLog = [];
  const head = el('div', 'lb-head'), body = el('div', 'lb-body');
  const chat = el('div', 'lb-chat', '<div class="lb-log"></div>');
  const ci = el('input', 'mpinput'); ci.placeholder = tr('Mesaj yaz, Enter · @claude: hata / öneri bildir'); ci.maxLength = 160; chat.append(withMention(ci));
  const foot = el('div', 'lb-foot');
  // online friends with "Davet Et": the invited player joins this room and takes his own seat
  const inv = el('div', 'lb-invite-slot');
  import('./friends-ui.js').then((m) => { if (ui.lobbySession === session) inv.append(m.lobbyInvites(ui, session)); }).catch(() => {});
  box.append(head, body, inv, chat, foot);
  safe(() => ui._onlinePanel(box));
  const active = () => !left && ui.lobbySession === session && ui.mode === 'menu';
  const drawLog = () => { const l = chat.querySelector('.lb-log'); l.innerHTML = chatLog.slice(-40).map((m) => `<div><b>${esc(m.name || '?')}:</b> ${esc(m.text).replace(/@claude/gi, '<span class="cmention">@claude</span>')}</div>`).join(''); l.scrollTop = l.scrollHeight; };
  ci.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { const t = ci.value.trim(); if (t) safe(() => session.chat(t)); if (/@claude/i.test(t)) safe(() => ui._lobbyNote(tr('✔ Geri bildirimin geliştiriciye iletildi, teşekkürler!'))); ci.value = ''; } };
  const call = (fn, ...a) => { safe(() => ui._click()); safe(() => { const r = session[fn]?.(...a); if (r && r.catch) r.catch((e) => { loading = ''; showErr(e); render(true); }); }); };
  let errText = '';
  const showErr = (e) => { errText = (e && e.message) || String(e || ''); };
  const sel = (opts, val, onch) => {
    const s = el('select', 'mpsel');
    for (const [v, t] of opts) { const o = el('option', '', esc(t)); o.value = String(v); if (String(v) === String(val)) o.selected = true; s.append(o); }
    s.onchange = () => onch(s.value); s.onkeydown = (ev) => ev.stopPropagation(); return s;
  };
  let lastKey = null;
  const render = (force) => {
    if (!active()) return;
    const st = state || {}, slots = st.slots || [], waiting = st.waiting || [], my = me(), host = !!session.isHost;
    const key = safe(() => JSON.stringify([st, loading, errText]), null);
    if (!force && key != null && key === lastKey) return;
    lastKey = key;
    const rs = st.resume || {};
    head.innerHTML = tr('<h2>Kayıtlı Maça Devam</h2>') +
      `<div class="lb-hint">${esc(rs.name || '')}${rs.tick ? ' · ' + mins(rs.tick) + '. dakika' : ''}</div>` +
      `<div class="lb-hint">Oyuncuları sağdaki listeden ya da aşağıdan davet et. Gelince hesabından tanınır ve kendi yerine oturur.</div>`;
    body.innerHTML = '';
    const amWaiting = waiting.some((w) => w.peer === my);
    const list = el('div', 'lb-slots');
    slots.forEach((s, i) => {
      const mine = s.kind === 'human' && s.peer && s.peer === my;
      const row = el('div', 'lb-slot team' + (s.team || 1) + (mine ? ' mine' : ''));
      row.append(el('span', 'lb-sw', '')); row.lastChild.style.background = hex(PLAYER_COLORS[i] ?? 0xffffff);
      row.append(el('span', 'lb-name', esc(s.name) + (s.peer && s.peer === st.hostPeer ? ' <small>👑</small>' : '') + (mine ? ' <small>' + tr('(sen)') + '</small>' : '')));
      row.append(el('span', 'lb-teamtag', tr('Takım {0}', esc(s.team || 1))));
      if (s.kind === 'ai') {
        row.append(el('span', 'lb-kind ai', tr('Yapay Zekâ')));
        if (host) row.append(sel(DIFF, s.difficulty || 'normal', (v) => call('setSlot', i, { difficulty: v })));
        else row.append(el('span', 'lb-teamtag', (DIFF.find((d) => d[0] === s.difficulty) || DIFF[1])[1]));
      } else if (s.peer) {
        row.append(el('span', 'lb-kind human', tr('İnsan')));
        row.append(el('span', 'lb-ready' + (s.ready ? ' on' : ''), s.ready ? tr('✔ Hazır') : tr('Bekliyor')));
        if (host && s.peer !== my) { const x = el('button', 'lb-x', '✕'); x.title = tr('Bu yeri boşalt'); x.onclick = () => call('freeSlot', i); row.append(x); }
      } else {
        // a human of the save who is not here (yet)
        row.append(el('span', 'lb-kind wait', tr('Bekleniyor')));
        if (host) {
          row.append(sel([['idle', tr('Gelmezse: yeri boş kalsın')], ['ai', tr('Gelmezse: yapay zekâ oynasın')]], s.mode === 'ai' ? 'ai' : 'idle', (v) => call('setSlotMode', i, v)));
          if (s.mode === 'ai') row.append(sel(DIFF, s.difficulty || 'normal', (v) => call('setSlot', i, { difficulty: v })));
        } else {
          row.append(el('span', 'lb-teamtag', s.mode === 'ai' ? tr('Yapay Zekâ devralacak') : tr('Boş')));
          if (amWaiting) { const b = el('button', 'mbtn small', tr('Bu yer benim')); b.onclick = () => call('claimSlot', i); row.append(b); }
        }
      }
      list.append(row);
    });
    body.append(list);
    if (waiting.length) body.append(el('div', 'lb-hint', tr('Yer bekleyenler: {0}', waiting.map((w) => esc(w.name) + (w.peer === my ? tr(' (sen)') : '')).join(', ')) + (host ? tr(' — boş bir yeri kendileri seçebilir.') : '')));
    if (amWaiting) body.append(el('div', 'lb-hint', tr('Profilin kayıttaki oyunculardan biriyle eşleşmedi: oynayacağın boş yeri seç.')));
    if (loading) body.append(el('div', 'lb-hint', '⏳ ' + esc(loading)));
    if (errText) body.append(el('div', 'mperr', esc(errText)));
    foot.innerHTML = '';
    const mySlot = slots.find((s) => s.kind === 'human' && s.peer === my);
    if (mySlot && !host) {
      const rd = el('button', 'mbtn small' + (mySlot.ready ? ' on' : ''), mySlot.ready ? tr('✔ Hazırım') : tr('Hazırım'));
      rd.onclick = () => call('setReady', !mySlot.ready); foot.append(rd);
    }
    if (host) {
      const c = safe(() => session.canStart(), { ok: false, reason: '' });
      const sb = el('button', 'mbtn small primary', tr('Devam Et')); sb.disabled = !c.ok || !!loading;
      sb.title = c.ok ? tr('Kayıt diğer oyunculara gönderilir ve maç kaldığı yerden sürer') : (c.reason || '');
      sb.onclick = async () => {
        // starting while a player of the save is still missing is usually a mistake: ask first
        const missing = slots.filter((s) => s.kind === 'human' && !s.peer && s.mode !== 'ai').map((s) => s.name);
        if (missing.length && !(await ask({ title: tr('Eksik Oyuncu'), text: tr('{0} henüz gelmedi. Onsuz devam edilsin mi?\nYeri boş kalır; sonra katılamaz.', missing.join(', ')), ok: tr('Devam Et') }))) return;
        errText = ''; call('start');
      };
      foot.append(sb);
    }
    const lv = el('button', 'mbtn small', tr('Ayrıl'));
    lv.onclick = () => { safe(() => ui._click()); left = true; ui.lobbySession = null; safe(() => session.close()); ui._menuMulti(); };
    foot.append(lv);
  };
  const on = (n, fn) => safe(() => session.on(n, (p) => { if (!left) safe(() => fn(p || {})); }));
  on('lobby', (s) => { state = s; render(); });
  on('loading', (p) => { loading = p.text || ''; render(); });
  on('notice', (p) => { errText = p.text || ''; });
  on('chat', (m) => { chatLog.push(m); if (active()) drawLog(); else if (app.net === session) safe(() => (ui._chatPush ? ui._chatPush(m) : ui.toast(m.name + ': ' + m.text, 'info'))); });
  on('start', (p) => { if (ui.lobbySession !== session) return; ui.lobbySession = null; safe(() => app.startMultiplayer(session, p.cfg)); });
  on('closed', (p) => {
    if (ui.lobbySession === session) {
      ui.lobbySession = null;
      const why = errText || (p.reason === 'hostLeft' ? tr('Kurucu ayrıldı.') : p.reason === 'kicked' ? tr('Odadan çıkarıldın.') : tr('Bağlantı kapandı.'));
      ui._menuMulti(why);
    } else if (app.net === session) safe(() => ui.toast(tr('⚠ Ağ bağlantısı kapandı'), 'warn'));
  });
  render(true); drawLog();
}
