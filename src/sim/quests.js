// Dynamic quest chain for player 0. Pure JS, uses only the public Game API.
import { UNITS } from '../data.js';
import { dhypot } from './dmath.js';
import { tr } from '../i18n.js';

const MAX_ACTIVE = 3;

function cntB(g, type) {
  let n = 0;
  for (const b of g.buildingsOf(0)) if (b.type === type && b.done && !b.dead) n++;
  return n;
}
function cntU(g, pred) {
  let n = 0;
  for (const u of g.unitsOf(0)) if (!u.dead && pred(u)) n++;
  return n;
}
const isMil = (u) => { const d = UNITS[u.type]; return !!d && d.cls !== 'civil' && d.cls !== 'support'; };   // (the healer is no soldier)
const frac = (a, b) => Math.min(a, b) + '/' + b;
const age = (g) => g.players[0].age || 0;

// needsEnemy: skipped when the match has no AI opponents
const DEFS = [
  // (farms come with the Bronze Age since 2026-11-14: the first food building is a pasture)
  { id: 'pasture1', title: tr('İlk Ağıl'), desc: tr('Bir koyun ağılı kur.'), reward: { food: 100 },
    check: (g) => cntB(g, 'pasture') >= 1, prog: (g) => frac(cntB(g, 'pasture'), 1) },
  { id: 'vill10', title: tr('Büyüyen Köy'), desc: tr('10 köylüye ulaş.'), reward: { wood: 150 },
    check: (g) => cntU(g, u => u.type === 'villager') >= 10, prog: (g) => frac(cntU(g, u => u.type === 'villager'), 10) },
  { id: 'house1', title: tr('Ambar'), desc: tr('Kaynakların yakınına bir depo inşa et.'), reward: { wood: 75 },
    check: (g) => cntB(g, 'storage') >= 1, prog: (g) => frac(cntB(g, 'storage'), 1) },
  { id: 'barracks1', title: tr('Silah Başına'), desc: tr('İlk kışlanı inşa et.'), reward: { food: 150 },
    check: (g) => cntB(g, 'barracks') >= 1, prog: (g) => frac(cntB(g, 'barracks'), 1) },
  { id: 'soldiers5', title: tr('İlk Birlik'), desc: tr('5 asker üret.'), reward: { gold: 100 },
    check: (g, s) => s.soldiers >= 5, prog: (g, s) => frac(s.soldiers, 5) },
  { id: 'storage1', title: tr('Düzenli Ambar'), desc: tr('Kaynakların yakınına bir depo kur.'), reward: { stone: 75 },
    check: (g) => cntB(g, 'storage') >= 1, prog: (g) => frac(cntB(g, 'storage'), 1) },
  { id: 'scout', title: tr('Ufkun Ötesi'), desc: tr('Düşman yerleşimini keşfet.'), reward: { gold: 150 }, needsEnemy: true,
    check: (g, s) => s.foundEnemy, prog: (g, s) => (s.foundEnemy ? tr('Bulundu') : tr('Aranıyor')) },
  { id: 'age1', title: tr('Tunç Devri'), desc: tr("Tunç Devri'ne geç."), reward: { food: 200, gold: 100 },
    check: (g) => age(g) >= 1, prog: (g) => frac(age(g), 1) },
  { id: 'farm1', title: tr('İlk Çiftlik'), desc: tr('İlk çiftliğini kur.'), reward: { food: 100 },
    check: (g) => cntB(g, 'farm') >= 1, prog: (g) => frac(cntB(g, 'farm'), 1) },
  { id: 'tech1', title: tr('Bilginin Gücü'), desc: tr('Bir teknoloji araştır.'), reward: { gold: 150 },
    check: (g, s) => s.techs >= 1 || (g.players[0].techs && g.players[0].techs.size >= 1), prog: (g, s) => frac(s.techs, 1) },
  { id: 'farms4', title: tr('Bereketli Topraklar'), desc: tr('4 çiftlik işlet.'), reward: { wood: 200 },
    check: (g) => cntB(g, 'farm') >= 4, prog: (g) => frac(cntB(g, 'farm'), 4) },
  // (the mill is gone, 2026-11-14: its techs are researched at a farm's granary now)
  { id: 'plow1', title: tr('Saban Demiri'), desc: tr('Bir tarlanın ambarında Saban araştır.'), reward: { food: 150, wood: 100 },
    check: (g) => !!(g.players[0].techs && g.players[0].techs.has('plow')), prog: (g) => frac(g.players[0].techs && g.players[0].techs.has('plow') ? 1 : 0, 1) },
  { id: 'camps1', title: tr('İş Kampları'), desc: tr('Bir oduncu kampı ve bir maden ocağı kur.'), reward: { wood: 150, stone: 100 },
    check: (g) => cntB(g, 'lumbercamp') >= 1 && cntB(g, 'minecamp') >= 1, prog: (g) => frac(Math.min(1, cntB(g, 'lumbercamp')) + Math.min(1, cntB(g, 'minecamp')), 2) },
  { id: 'market1', title: tr('Ticaret Yolu'), desc: tr('Bir pazar kur.'), reward: { gold: 200 },
    check: (g) => cntB(g, 'market') >= 1, prog: (g) => frac(cntB(g, 'market'), 1) },
  { id: 'dock1', title: tr('Limana Açılış'), desc: tr('Kıyıya bir iskele kur.'), reward: { wood: 150, food: 100 }, needsShore: true,
    check: (g) => cntB(g, 'dock') >= 1, prog: (g) => frac(cntB(g, 'dock'), 1) },
  { id: 'fish3', title: tr('Balık Bereketi'), desc: tr('3 balıkçı teknesiyle balık tut.'), reward: { food: 200 }, needsShore: true,
    check: (g) => cntU(g, u => u.type === 'fishboat') >= 3, prog: (g) => frac(cntU(g, u => u.type === 'fishboat'), 3) },
  { id: 'repel', title: tr('Surları Koru'), desc: tr('İlk düşman saldırısını püskürt.'), reward: { food: 200, wood: 200, gold: 100 }, needsEnemy: true,
    check: (g, s) => s.attacked && g.time - s.lastAttack > 35 && cntB(g, 'towncenter') >= 1,
    prog: (g, s) => (s.attacked ? tr('Saldırı sürüyor') : tr('Saldırı bekleniyor')) },
  { id: 'smith1', title: tr('Örs ve Çekiç'), desc: tr('Bir demirci inşa et.'), reward: { gold: 100, stone: 50 },
    check: (g) => cntB(g, 'blacksmith') >= 1, prog: (g) => frac(cntB(g, 'blacksmith'), 1) },
  { id: 'temple1', title: tr('Kutsal Ocak'), desc: tr('Bir tapınak inşa et; yaralı birliklerini iyileştirir.'), reward: { gold: 150, food: 150 },
    check: (g) => cntB(g, 'temple') >= 1, prog: (g) => frac(cntB(g, 'temple'), 1) },
  { id: 'tower1', title: tr('Gözcü'), desc: tr('Bir gözetleme kulesi inşa et.'), reward: { stone: 150 },
    check: (g) => cntB(g, 'tower') >= 1, prog: (g) => frac(cntB(g, 'tower'), 1) },
  { id: 'pop30', title: tr('Kalabalık Meydan'), desc: tr('30 nüfusa ulaş.'), reward: { food: 250 },
    check: (g) => (g.players[0].pop || 0) >= 30, prog: (g) => frac(g.players[0].pop || 0, 30) },
  { id: 'fleet3', title: tr('Deniz Hâkimiyeti'), desc: tr('Aynı anda 3 savaş gemisinden oluşan bir filo kur.'), reward: { wood: 200, gold: 200 }, needsShore: true,
    check: (g) => cntU(g, u => !!UNITS[u.type] && !!UNITS[u.type].naval && UNITS[u.type].atk > 0) >= 3, prog: (g) => frac(cntU(g, u => !!UNITS[u.type] && !!UNITS[u.type].naval && UNITS[u.type].atk > 0), 3) },
  { id: 'age2', title: tr('Orta Çağ'), desc: tr("Orta Çağ'a geç."), reward: { food: 300, gold: 200 },
    check: (g) => age(g) >= 2, prog: (g) => frac(age(g), 2) },
  { id: 'army15', title: tr('Sancak Altında'), desc: tr('Aynı anda 15 askerlik bir ordu kur.'), reward: { gold: 250 },
    check: (g) => cntU(g, isMil) >= 15, prog: (g) => frac(cntU(g, isMil), 15) },
  { id: 'castle1', title: tr('Taştan Yürek'), desc: tr('Bir kale inşa et.'), reward: { stone: 300, gold: 200 },
    check: (g) => cntB(g, 'castle') >= 1, prog: (g) => frac(cntB(g, 'castle'), 1) },
  { id: 'univ1', title: tr('İlim Yuvası'), desc: tr('Bir üniversite kur.'), reward: { gold: 250 },
    check: (g) => cntB(g, 'university') >= 1, prog: (g) => frac(cntB(g, 'university'), 1) },
  { id: 'raze3', title: tr('Kuşatma'), desc: tr('3 düşman binası yık.'), reward: { wood: 300, stone: 200 }, needsEnemy: true,
    check: (g, s) => s.razed >= 3, prog: (g, s) => frac(s.razed, 3) },
  { id: 'age3', title: tr('Barut Çağı'), desc: tr("Barut Çağı'na geç."), reward: { food: 400, gold: 300 },
    check: (g) => age(g) >= 3, prog: (g) => frac(age(g), 3) },
  { id: 'tech5', title: tr('Aydınlanma'), desc: tr('5 teknoloji araştır.'), reward: { gold: 300 },
    check: (g) => (g.players[0].techs ? g.players[0].techs.size : 0) >= 5,
    prog: (g) => frac(g.players[0].techs ? g.players[0].techs.size : 0, 5) },
  { id: 'bank1', title: tr('Kasa Dairesi'), desc: tr('Bir banka kur ve altın gelirini başlat.'), reward: { gold: 300 },
    check: (g) => cntB(g, 'bank') >= 1, prog: (g) => frac(cntB(g, 'bank'), 1) },
  { id: 'academy1', title: tr('Harp Okulu'), desc: tr('Bir harp akademisi kur.'), reward: { gold: 300, stone: 200 },
    check: (g) => cntB(g, 'academy') >= 1, prog: (g) => frac(cntB(g, 'academy'), 1) },
  { id: 'tech15', title: tr('Bilim Çağı'), desc: tr('15 teknoloji araştır.'), reward: { gold: 500, stone: 300 },
    check: (g) => (g.players[0].techs ? g.players[0].techs.size : 0) >= 15, prog: (g) => frac((g.players[0].techs ? g.players[0].techs.size : 0), 15) },
  { id: 'killtc', title: tr('Son Darbe'), desc: tr('Bir düşman köy merkezini yok et.'), reward: { food: 500, wood: 500, gold: 500 }, needsEnemy: true,
    check: (g, s) => s.tcKilled >= 1, prog: (g, s) => frac(s.tcKilled, 1) },
  { id: 'age4', title: tr('Sanayi Çağı'), desc: tr("Sanayi Çağı'na geç."), reward: { food: 500, gold: 500 },
    check: (g) => age(g) >= 4, prog: (g) => frac(age(g), 4) },
  { id: 'factory1', title: tr('Buhar ve Çelik'), desc: tr('Bir fabrika kur.'), reward: { gold: 500 },
    check: (g) => cntB(g, 'factory') >= 1, prog: (g) => frac(cntB(g, 'factory'), 1) },
  { id: 'rail1', title: tr('Demir Yolu'), desc: tr('İki istasyonu ray hattıyla birbirine bağla.'), reward: { gold: 400 },
    check: (g) => typeof g.railPairs === 'function' && g.railPairs().some(p => p.owner === 0),
    prog: (g) => frac(typeof g.railPairs === 'function' && g.railPairs().some(p => p.owner === 0) ? 1 : 0, 1) },
  { id: 'tech30', title: tr('Her Şeyi Bilen'), desc: tr('30 teknoloji araştır.'), reward: { food: 500, wood: 500, gold: 800 },
    check: (g) => (g.players[0].techs ? g.players[0].techs.size : 0) >= 30, prog: (g) => frac((g.players[0].techs ? g.players[0].techs.size : 0), 30) },
  { id: 'conquer', title: tr('Çağların Hâkimi'), desc: tr('Tüm düşmanları yenilgiye uğrat.'), reward: { gold: 1000 }, needsEnemy: true,
    check: (g) => g.players.length > 1 && g.players.every(p => p.id === 0 || p.defeated),
    prog: (g) => frac(g.players.filter(p => p.id !== 0 && p.defeated).length, Math.max(1, g.players.length - 1)) },
];

export class QuestSystem {
  constructor(game) {
    this.game = game;
    this.t = 0.5;
    this.s = { soldiers: 0, techs: 0, foundEnemy: false, attacked: false, lastAttack: 0, razed: 0, tcKilled: 0 };
    const hasEnemy = ((game.cfg && game.cfg.enemies) || 0) > 0;
    let hasShore = false;
    try { const p0 = game.players[0]; hasShore = typeof game._navShoals === 'function' && game._navShoals().some(f => dhypot(f.x - p0.startX, f.z - p0.startZ) < 32); } catch (e) { hasShore = false; }
    this.defs = {};
    this.list = [];
    for (const d of DEFS) {
      if (d.needsEnemy && !hasEnemy) continue;
      if (d.needsShore && !hasShore) continue;
      this.defs[d.id] = d;
      this.list.push({ id: d.id, title: d.title, desc: d.desc, done: false, active: false, reward: { ...d.reward }, progress: '' });
    }
    this._bound = false;
    this._refreshActive();
  }

  _bind() {
    if (this._bound) return;
    const ev = this.game.events;
    if (!ev || !ev.on) return;
    this._bound = true;
    const s = this.s;
    ev.on('trained', (p) => {
      try { if (p && p.e && p.e.owner === 0 && isMil(p.e)) s.soldiers++; } catch (e) { /* ignore */ }
    });
    ev.on('researched', (p) => { try { if (p && p.owner === 0) s.techs++; } catch (e) { /* ignore */ } });
    ev.on('underAttack', () => { s.attacked = true; s.lastAttack = this.game.time; });
    ev.on('death', (p) => {
      try {
        const e = p && p.e;
        if (!e || e.kind !== 'building' || e.owner <= 0) return;
        const k = p.killer;
        if (k && k.owner !== 0) return;
        s.razed++;
        if (e.type === 'towncenter') s.tcKilled++;
      } catch (err) { /* ignore */ }
    });
  }

  _refreshActive() {
    let n = 0;
    for (const q of this.list) {
      if (q.done) { q.active = false; continue; }
      q.active = n < MAX_ACTIVE;
      if (q.active) n++;
    }
  }

  _scanEnemy() {
    const g = this.game, s = this.s;
    if (s.foundEnemy || !g.fog || !g.map) return;
    const N = g.map.size;
    for (const e of g.entities.values()) {
      if (e.kind !== 'building' || e.owner <= 0 || e.dead) continue;
      const tx = Math.max(0, Math.min(N - 1, Math.floor(e.x))), tz = Math.max(0, Math.min(N - 1, Math.floor(e.z)));
      if (g.fog[tz * N + tx] === 2) { s.foundEnemy = true; return; }
    }
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    try {
      this._bind();
      const g = this.game, s = this.s;
      if (!g.players || !g.players[0]) return;
      this._scanEnemy();
      let changed = false;
      for (const q of this.list) {
        if (q.done || !q.active) continue;
        const d = this.defs[q.id];
        if (!d) continue;
        let ok = false;
        try { ok = !!d.check(g, s); q.progress = String(d.prog ? d.prog(g, s) : ''); } catch (e) { ok = false; }
        if (!ok) continue;
        q.done = true; q.active = false; q.progress = tr('Tamamlandı');
        changed = true;
        const res = g.players[0].res;
        for (const k in q.reward) res[k] = (res[k] || 0) + q.reward[k];
        if (g.events && g.events.emit) {
          g.events.emit('questDone', { quest: q });
          g.events.emit('notify', { text: tr('Görev tamamlandı: {0}', q.title), type: 'good' });
        }
      }
      if (changed) {
        this._refreshActive();
        // fill progress text of newly activated quests right away
        for (const q of this.list) {
          if (!q.active) continue;
          const d = this.defs[q.id];
          try { q.progress = String(d.prog ? d.prog(g, s) : ''); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* never throw */ }
  }

  serialize() {
    return { done: this.list.filter(q => q.done).map(q => q.id), s: { ...this.s } };
  }

  load(o) {
    if (!o) return;
    try {
      const done = new Set(o.done || []);
      for (const q of this.list) { q.done = done.has(q.id); if (q.done) q.progress = tr('Tamamlandı'); }
      if (o.s) Object.assign(this.s, o.s);
      this._refreshActive();
    } catch (e) { /* ignore */ }
  }
}
