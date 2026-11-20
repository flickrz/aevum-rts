// Aevum - what the update notice (src/net/notice.js) looks like: the banner with the countdown / "Yeni sürüm hazır",
// the main menu's "Kesilen maça devam et". All text goes in via textContent.
import { ask } from './ask.js';
import { ico } from '../icons.js';
import { getInterrupted, markInterrupted, clearInterrupted } from '../net/notice.js';
import { MP_PREFIX } from '../storage.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const SAVE_TEXT = 'Maçın kaydedilecek; 2-3 dakika sonra kaldığın yerden devam edebilirsin.';

// ---------- the banner (menus, single player and multiplayer) ----------
export function mountNoticeBanner(ui, notice) {
  const app = ui.app;
  let el = null, tick = null, sig = '';
  const inGame = () => !!(app.game && !app.demo && !app.game.over && ui.mode === 'hud');
  const draw = () => {
    const s = notice.status();
    if (s === 'soon') notice.check();
    if (s === 'none') { if (el) { el.remove(); el = null; } sig = ''; stopTick(); return; }
    if (!el) { el = h('div', 'updbanner panel'); el.setAttribute('role', 'status'); }
    if (!el.isConnected) ui.root.append(el);
    const n = notice.notice;
    let title, sub, btn = null;
    if (s === 'soon') {
      title = (n.kind === 'restart' ? '⏳ Sunucu yeniden başlıyor: ' : '⏳ Güncelleme geliyor: ') + mmss(notice.remaining());
      sub = n.msg || SAVE_TEXT;
      startTick();
    } else if (s === 'loading') {
      title = '⏳ Güncelleme yükleniyor…';
      sub = 'Birkaç dakika sürebilir; hazır olunca burada haber vereceğiz.';
      startTick();
    } else {   // ready
      title = '✨ Yeni sürüm hazır';
      sub = app.net && inGame() ? 'Maç kayıtlı; yenileyince menüden kaldığın yerden devam edersin.'
        : inGame() ? 'Yenileyince oyun kaydedilir; Devam Et ile kaldığın yerden sürer.'
          : 'Yenileyince yeni sürümle oynarsın.';
      btn = 'Yenile';
      stopTick();
    }
    const k = s + '|' + title + '|' + sub;
    if (k === sig) return;
    sig = k;
    el.className = 'updbanner panel ' + s;
    el.textContent = '';
    const txt = h('div', 'ub-txt');
    txt.append(h('b', 'ub-t', title), h('span', 'ub-s', sub));
    el.append(txt);
    if (btn) { const b = h('button', 'mbtn small primary ub-btn', btn); b.type = 'button'; b.onclick = () => reloadNow(ui); el.append(b); }
  };
  function startTick() { if (tick == null) tick = setInterval(draw, 1000); }
  function stopTick() { if (tick != null) { clearInterval(tick); tick = null; } }
  notice.on(draw);
  draw();
  return { redraw: draw };
}

// "Yenile": a running match is saved first (single player) / the player is asked first (multiplayer)
async function reloadNow(ui) {
  const app = ui.app;
  safe(() => ui._click());
  const game = app.game;
  if (game && !app.demo && !game.over) {
    if (app.net && game.mp) {
      if (!(await ask({ title: 'Sayfayı Yenile', text: 'Maçtan çıkıp sayfayı yenilemek istiyor musun?\nMaç kayıtlı; menüdeki “Kesilen maça devam et” ile kaldığınız yerden sürer.', ok: 'Yenile' }))) return;
      safe(() => {
        const s = app.net, match = s.match || s.code || 'MP';
        const prev = getInterrupted();
        if (!prev || prev.code !== match) markInterrupted({ code: match, key: MP_PREFIX + match + '-auto', host: !!s.isHost, hostName: hostNameOf(s), tick: game.tick | 0 });
      });
    } else if (!game.mp) { try { await app.saveGame('auto'); } catch (e) { /* reload anyway */ } }
  }
  location.reload();
}

export function hostNameOf(s) {
  return safe(() => {
    const st = s.start0 || s.state, hp = s.state && s.state.hostPeer;
    const slot = st && st.slots.find((x) => x && x.kind === 'human' && x.peer === hp);
    return slot ? String(slot.name || '') : '';
  }, '');
}

// ---------- "Kesilen maça devam et" (main menu, 30 minutes after an update cut a multiplayer match) ----------
export function interruptedEntry(ui, box, after) {
  const app = ui.app;
  const it = getInterrupted();
  if (!it) return;
  Promise.resolve(safe(() => app.listMpSaves(), [])).then((list) => {
    if (!box.isConnected || !Array.isArray(list)) return;
    const save = list.find((s) => s.key === it.key) || list.find((s) => s.code === it.code);
    if (!save) return;
    const b = h('button', 'mbtn mitem primary int-resume');
    b.innerHTML = `<span class="mi">${ico('x-ally')}</span><span class="mt"></span><span class="mm"></span>`;
    b.querySelector('.mt').textContent = 'Kesilen maça devam et';
    b.querySelector('.mm').textContent = (save.tick ? Math.floor(save.tick / 1800) + '. dk · ' : '') + (it.host ? 'sen kurarsın, diğerlerini davet et' : 'kurucu yeniden açacak');
    b.title = 'Güncelleme yüzünden yarıda kalan çok oyunculu maç';
    b.onclick = () => { safe(() => ui._click()); resumeInterrupted(ui, it, save); };
    after.after(b);
  }).catch(() => {});
}

async function resumeInterrupted(ui, it, save) {
  const app = ui.app;
  if (!it.host) {
    const who = it.hostName ? ' (' + it.hostName + ')' : '';
    const mine = await ask({
      title: 'Kesilen Maç',
      text: 'Maçı kurucu' + who + ' kayıttan yeniden açacak; davet gelince Katıl\'a bas, kendi yerine oturursun.\nKurucu gelmezse maçı sen de açıp diğerlerini davet edebilirsin.',
      ok: 'Ben açayım', cancel: 'Bekleyeceğim',
    });
    if (!mine) return;
  }
  const m = await import('./mp-resume.js');
  try {
    const rec = await app.getSave(save.key);
    if (!rec || !rec.data) throw new Error('Kayıt okunamadı.');
    const sess = await ui._mpSession();
    await sess.hostResume(rec);
    m.showResumeLobby(ui, sess);
  } catch (e) { m.menuResume(ui, (e && e.message) || String(e)); }
}

export { clearInterrupted };
