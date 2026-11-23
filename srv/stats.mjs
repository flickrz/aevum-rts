// Aevum - player statistics for the game's owner: who is online now, and per day the visitors, signed-in players
// and matches. Pure node (crypto + an injected store), no npm deps; loaded by server.js, tested by test/stats-test.mjs.
//
// Nothing personal is kept. A visitor is a random id that each browser makes for itself, and an account is kept only
// as a short salted hash, just enough to count unique players per day. Days follow Turkey time (UTC+3).
// The counts live in memory and are written to the store (Firestore through a service account, see
// srv/firestore-sa.mjs) every few minutes, so a restart or the free plan's sleep loses at most those minutes.
import crypto from 'node:crypto';

export const ONLINE_MS = 150 * 1000;        // a browser that sent a beat in the last 2.5 minutes is online
export const MAX_LIVE = 20000;              // live browsers tracked at once (beats beyond that are ignored)
export const MAX_IDS = 60000;               // unique ids kept per day and kind (keeps one day's document < 1 MB)
export const STATES = ['menu', 'sp', 'mp'];
export const PAST_TTL = 6 * 3600 * 1000;    // the stored past days are read again at most this often (and on a new day)
const VID_RE = /^[A-Za-z0-9]{8,32}$/;
export const okVid = (v) => typeof v === 'string' && VID_RE.test(v);
export const dayOf = (t) => new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10);
const h10 = (s) => crypto.createHash('sha256').update('aevum-stats|' + s).digest('hex').slice(0, 10);
const setOf = (s) => new Set(typeof s === 'string' && s ? s.split(',') : []);

function emptyDay(d) { return { d, v: new Set(), p: new Set(), r: new Set(), sp: 0, mp: 0, peak: 0 }; }
// the public numbers of one day
export function summary(day) {
  return { day: day.d, visitors: day.v.size, players: day.p.size, sp: day.sp, mp: day.mp, peak: day.peak };
}
// a day as stored: the counts plus the hashed id lists (to keep counting unique ids after a restart)
export function encodeDay(day) {
  return { nv: day.v.size, np: day.p.size, sp: day.sp, mp: day.mp, peak: day.peak, v: [...day.v].join(','), p: [...day.p].join(','), r: [...day.r].join(',') };
}
export function decodeDay(d, o) {
  const day = emptyDay(d);
  if (!o) return day;
  day.v = setOf(o.v); day.p = setOf(o.p); day.r = setOf(o.r);
  day.sp = o.sp | 0; day.mp = o.mp | 0; day.peak = o.peak | 0;
  return day;
}

// store: {get(day) -> fields|null, put(day, fields), list(n) -> [{day, nv, np, sp, mp, peak}] newest first} or null
export function createStats({ now = () => Date.now(), store = null, log = () => {} } = {}) {
  const live = new Map();      // visitor id -> {t, s, fb}
  let day = emptyDay(dayOf(now()));
  let dirty = false, loaded = !store, loadP = null;
  let past = null;   // {d: today, n, t, rows}: the stored days as last read (report)

  const add = (set, id) => { if (!set.has(id) && set.size < MAX_IDS) { set.add(id); dirty = true; } };
  // today's document is read once, before the first write, so a restart keeps counting from where it was
  function load() {
    if (loaded || loadP) return loadP;
    const d = day.d;
    loadP = Promise.resolve(store.get(d)).then((o) => {
      if (day.d !== d) return;
      const old = decodeDay(d, o);
      for (const k of ['v', 'p', 'r']) for (const id of day[k]) if (old[k].size < MAX_IDS) old[k].add(id);
      old.sp += day.sp; old.mp += day.mp; old.peak = Math.max(old.peak, day.peak);
      day = old; dirty = true;
    }).catch((e) => log('stats load', e)).finally(() => { loaded = true; loadP = null; });
    return loadP;
  }
  // a new day began: the old one is written one last time
  function roll() {
    const d = dayOf(now());
    if (d === day.d) return;
    const old = day;
    day = emptyDay(d);
    if (store && dirty) Promise.resolve(store.put(old.d, encodeDay(old))).catch((e) => log('stats put', e));
    dirty = false; loaded = true;   // (the new day has no document yet)
  }
  function prune() {
    const t = now();
    for (const [v, o] of live) if (t - o.t > ONLINE_MS) live.delete(v);
  }
  function online() {
    prune();
    const o = { total: 0, menu: 0, sp: 0, mp: 0, signedIn: 0 };
    for (const x of live.values()) { o.total++; o[x.s]++; if (x.fb) o.signedIn++; }
    return o;
  }

  return {
    // a browser says it is here: vid its random id, state 'menu'|'sp'|'mp', fb the account (verified ticket) or null
    beat(vid, state, fb) {
      if (!okVid(vid)) return false;
      roll(); load();
      if (!live.has(vid) && live.size >= MAX_LIVE) { prune(); if (live.size >= MAX_LIVE) return false; }
      live.set(vid, { t: now(), s: STATES.includes(state) ? state : 'menu', fb: fb || null });
      add(day.v, h10('v|' + vid));
      if (fb) add(day.p, h10('p|' + fb));
      if (live.size > day.peak) {
        const n = online().total;
        if (n > day.peak) { day.peak = n; dirty = true; }
      }
      return true;
    },
    // a match started (the TP match ticket): every player of a multiplayer room asks, the room counts once a day
    match(mode, room, fb) {
      roll(); load();
      if (fb) add(day.p, h10('p|' + fb));
      if (mode === 'mp') {
        const k = h10('r|' + (room || fb || ''));
        if (!day.r.has(k)) { add(day.r, k); day.mp++; dirty = true; }
      } else { day.sp++; dirty = true; }
    },
    online,
    // account -> what its most recent tab is doing ('menu'|'sp'|'mp'), for the online players list
    fbStates() {
      prune();
      const best = new Map(), out = new Map();
      for (const x of live.values()) if (x.fb && !(best.get(x.fb) > x.t)) { best.set(x.fb, x.t); out.set(x.fb, x.s); }
      return out;
    },
    today() { roll(); return summary(day); },
    // writes today's numbers when they changed
    async flush() {
      roll();
      if (!store || !dirty) return false;
      if (!loaded) await load();
      dirty = false;
      try { await store.put(day.d, encodeDay(day)); return true; } catch (e) { dirty = true; log('stats put', e); return false; }
    },
    // the owner's view: online now, today, and the last n days (today first)
    // (2026-11-23: the owner's screen asks every minute, and each list() is a batchGet of n+1 day documents) the
    // past days never change: they are read once per day (and n), at most every PAST_TTL, and served from memory
    async report(n = 30) {
      roll();
      const today = summary(day);
      let days = [today], persisted = !!store;
      if (store) {
        try {
          if (!past || past.d !== today.day || past.n < n || now() - past.t >= PAST_TTL || now() < past.t) {
            const rows = await store.list(n + 1);
            past = { d: today.day, n, t: now(), rows: Array.isArray(rows) ? rows : [] };
          }
          for (const o of past.rows) if (o.day !== today.day && days.length < n) days.push({ day: o.day, visitors: o.nv | 0, players: o.np | 0, sp: o.sp | 0, mp: o.mp | 0, peak: o.peak | 0 });
        } catch (e) { log('stats list', e); persisted = false; }
      }
      return { online: online(), today, days, persisted };
    },
    _live: live,
  };
}
