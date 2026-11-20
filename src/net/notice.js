// Aevum - the update notice poller. The server (server.js, see BUILD_VER) answers GET /mp/notice with
// {ver, notice: {id, kind 'update'|'restart', at, in (ms left), msg} | null} - about 100 bytes, asked every 20 s.
//   - The first ver this tab sees is its baseline (the build it loaded). A different ver later: the new version is live.
//   - An active notice: a countdown; ~15 s before its time onSaveDue fires once per notice (main.js saves the match).
//   - The server gone after a notice (the restart): "loading", never an error.
// Also the "interrupted match" note in localStorage (which multiplayer save, when) for the main menu's
// "Kesilen maça devam et". No DOM here (src/ui/notice-ui.js draws it); every dependency can be passed in for tests.

export const POLL_MS = 20000;            // never faster (bandwidth: every open tab asks)
export const SAVE_BEFORE_MS = 15000;     // the match is saved this long before the update
export const INT_KEY = 'aevum.interrupted';
export const INT_TTL = 30 * 60 * 1000;   // the resume entry stays 30 minutes
const LOADING_KEEP = 10 * 60 * 1000;     // after a notice, an unreachable server reads "loading" this long

export function createNotice(opts = {}) {
  const fetchFn = opts.fetch || ((...a) => fetch(...a));
  const now = opts.now || (() => Date.now());
  const setT = opts.setTimeout || ((f, ms) => setTimeout(f, ms));
  const clearT = opts.clearTimeout || ((h) => clearTimeout(h));
  const url = opts.url || '/mp/notice';
  const pollMs = Math.max(POLL_MS, opts.pollMs || POLL_MS);
  const st = {
    base: null,        // the build this tab runs
    ver: null,         // the build the server runs now
    notice: null,      // {id, kind, at (local clock), msg}
    seenAt: 0,         // last time a notice was active (local clock)
    down: false,       // the last poll failed
    lastPoll: -1e15,
  };
  const subs = new Set(), dueSubs = new Set(), fired = new Set();
  let timer = null, started = false, inflight = null, readyRes = null;
  const ready = new Promise((r) => { readyRes = r; });
  const emit = () => { for (const f of subs) { try { f(api); } catch (e) { console.warn('[notice]', e); } } };

  function apply(j) {
    if (!j || typeof j.ver !== 'string') return;
    if (st.base == null) st.base = j.ver;
    st.ver = j.ver;
    const n = j.notice;
    if (n && typeof n.id === 'string' && (n.kind === 'update' || n.kind === 'restart') && Number.isFinite(n.in)) {
      st.notice = { id: n.id, kind: n.kind, at: now() + Math.max(0, n.in), msg: typeof n.msg === 'string' ? n.msg.slice(0, 200) : '' };
      st.seenAt = now();
    } else st.notice = null;
  }
  async function poll() {
    if (inflight) return inflight;
    st.lastPoll = now();
    inflight = (async () => {
      let ok = false;
      try {
        const r = await fetchFn(url, { cache: 'no-store' });
        if (r && r.ok) { apply(await r.json()); ok = true; }
      } catch (e) { ok = false; }
      st.down = !ok;
      if (ok && readyRes) { readyRes(st.base); readyRes = null; }
      check(); emit();
      return ok;
    })().finally(() => { inflight = null; });
    return inflight;
  }
  function loop() {
    timer = null;
    poll().finally(() => { if (started) timer = setT(loop, pollMs); });
  }
  // cheap; called from the countdown and the game's background ticker so the save is not late in a hidden tab
  function check() {
    const n = st.notice;
    if (!n || fired.has(n.id) || stale()) return;
    if (n.at - now() <= SAVE_BEFORE_MS) {
      fired.add(n.id);
      for (const f of dueSubs) { try { f(n); } catch (e) { console.warn('[notice] save', e); } }
    }
  }
  const stale = () => st.base != null && st.ver != null && st.ver !== st.base;
  // 'none' | 'soon' (countdown) | 'loading' (the update is under way) | 'ready' (a new version is live)
  function status() {
    if (stale()) return 'ready';
    if (st.notice) return st.notice.at > now() ? 'soon' : 'loading';
    if (st.down && st.seenAt && now() - st.seenAt < LOADING_KEEP) return 'loading';
    return 'none';
  }
  const api = {
    get base() { return st.base; },
    get ver() { return st.ver; },
    get notice() { return st.notice; },
    get down() { return st.down; },
    status, stale, check, poll,
    remaining() { return st.notice ? Math.max(0, st.notice.at - now()) : 0; },
    // the baseline build id; waits for the first answer (at most `ms`), null when the server never answered
    async baseVer(ms = 3000) {
      if (st.base != null) return st.base;
      poll();   // (also when the loop runs: its next poll may be 20 s away)
      let h = null;
      const r = await Promise.race([ready, new Promise((res) => { h = setT(() => res(null), ms); })]);
      if (h != null) clearT(h);
      return r;
    },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    onSaveDue(fn) { dueSubs.add(fn); return () => dueSubs.delete(fn); },
    start() { if (started) return api; started = true; loop(); return api; },
    stop() { started = false; if (timer != null) clearT(timer); timer = null; },
    // the tab came back: ask now if the last answer is older than the poll interval
    wake() { if (started && now() - st.lastPoll >= pollMs) { if (timer != null) clearT(timer); loop(); } },
    _apply: apply,
  };
  return api;
}

// ---------- the interrupted multiplayer match (localStorage) ----------
const lsOf = (ls) => { if (ls) return ls; try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
// o: {code (match code), key (the save record), t, host (we were the host), hostName, tick}
export function markInterrupted(o, ls, t = Date.now()) {
  const s = lsOf(ls); if (!s || !o || !o.code) return false;
  try { s.setItem(INT_KEY, JSON.stringify(Object.assign({}, o, { t }))); return true; } catch (e) { return false; }
}
export function getInterrupted(ls, t = Date.now()) {
  const s = lsOf(ls); if (!s) return null;
  let o = null;
  try { o = JSON.parse(s.getItem(INT_KEY) || 'null'); } catch (e) { o = null; }
  if (!o || typeof o.code !== 'string' || typeof o.key !== 'string' || !(t - (o.t || 0) < INT_TTL)) return null;
  return o;
}
// code: only that match (null: whatever is noted)
export function clearInterrupted(code, ls) {
  const s = lsOf(ls); if (!s) return;
  try {
    if (code != null) { const o = JSON.parse(s.getItem(INT_KEY) || 'null'); if (o && o.code !== code) return; }
    s.removeItem(INT_KEY);
  } catch (e) { /* ignore */ }
}
