// Aevum - desync diagnostics (owner 2026-11-20: "senkronları kaydedelim, neden olduğunu görelim").
// A small per-section summary of the simulation state, taken at the same tick as the lockstep state hash. When the
// hashes of the players differ, every client writes its own summary to the cloud (CloudSync.logDesync) and
// tools/read-desync.mjs lines them up, so the section that split (one player's units, positions, hit points, orders,
// resources, the random seed...) shows. Read-only: it never changes the game and is never part of the hash.
const strHash = (s) => { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const acc = () => ({ h: 2166136261 });
const mix = (o, v) => { o.h = Math.imul(o.h ^ (v | 0), 16777619); };

export function hashParts(game) {
  try {
    const per = new Map(), res = acc();
    let deer = 0;
    for (const e of game.entities.values()) {
      if (e.kind === 'resource') { mix(res, e.id); mix(res, Math.round((e.amount || 0) * 10)); if (e.dead) mix(res, 7); if (e.type === 'deer') deer++; continue; }
      const o = e.owner == null ? -1 : e.owner;
      let s = per.get(o);
      if (!s) { s = { u: 0, b: 0, pos: acc(), hp: acc(), ord: acc() }; per.set(o, s); }
      if (e.kind === 'unit') s.u++; else s.b++;
      mix(s.pos, e.id); mix(s.pos, Math.round(e.x * 100)); mix(s.pos, Math.round(e.z * 100));
      mix(s.hp, e.id); mix(s.hp, Math.round((e.hp || 0) * 10)); if (e.dead) mix(s.hp, 7);
      const q = e.order; mix(s.ord, e.id); mix(s.ord, q ? strHash(q.type) : 0); mix(s.ord, q && q.targetId ? q.targetId : 0);
      if (e.kind === 'building') { mix(s.ord, (e.queue || []).length); mix(s.ord, Math.round((e.progress || 0) * 1000)); }
    }
    return {
      tick: game.tick | 0, ents: game.entities.size, units: game.units.length, blds: game.buildings.length, proj: (game.projectiles || []).length, deer,
      rs: game.rs >>> 0, nextId: game.nextId | 0, res: res.h >>> 0,
      ai: (game.ais || []).map((a) => (a.rs >>> 0)),
      owners: [...per].sort((a, b) => a[0] - b[0]).map(([o, s]) => ({ o, u: s.u, b: s.b, pos: s.pos.h >>> 0, hp: s.hp.h >>> 0, ord: s.ord.h >>> 0 })),
      players: (game.players || []).map((p) => ({ id: p.id, age: p.age | 0, pop: p.pop | 0, left: !!p.left, def: !!p.defeated, techs: p.techs ? p.techs.size : 0,
        res: ['food', 'wood', 'stone', 'gold'].map((k) => Math.round((p.res && p.res[k]) || 0)) })),
    };
  } catch (err) { return { error: String(err && err.message || err) }; }
}

// the browser engine family only (no version, nothing personal): lockstep needs every engine to do the same maths
export function engineFamily() {
  try {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const fam = /Firefox\//.test(ua) && !ios ? 'gecko' : ios || (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) ? 'webkit' : 'chromium';
    return fam + (ios ? '-ios' : /Android/.test(ua) ? '-android' : /Mac OS X/.test(ua) ? '-mac' : /Windows/.test(ua) ? '-win' : /Linux/.test(ua) ? '-linux' : '');
  } catch { return 'unknown'; }
}
