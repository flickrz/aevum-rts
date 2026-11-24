// Tutorial mode "Kartal Obası'nın İlk Kışı" (cfg.tutorial, single player only).
// Sits in the Game's quests slot (same interface as QuestSystem: list, update, serialize, load) plus ack() for the
// few things only the UI can see. Every rule here runs inside the simulation tick and uses only the game PRNG through
// the Game helpers (_addUnit, _freeNear, cmdAttack, cmdStance, direct res grants): never Math.random, Date or
// performance.now. The Game constructor forces cfg.tutorial off in multiplayer, so none of this can run in lockstep.
// All player-facing Turkish text of the tutorial lives in this file (CHAPTERS and the few lines next to it).
import { UNITS, BUILDINGS } from '../data.js';
import { dhypot } from './dmath.js';
import { tr } from '../i18n.js';

export const TUT_SEED = 41017;
// the cfg the menu button starts (ui.js _menuHowto -> app.newGame)
export const TUT_CFG = { tutorial: true, mapSize: 128, enemies: 1, difficulty: 'easy', startRes: 'normal', startAge: 0, sandbox: false, seed: TUT_SEED, mapType: 'plains', fog: 'explored' };

const CHECK_EVERY = 0.5;   // s between two trigger checks
const HINT_EVERY = 40;     // s of play without success before (and between) stuck hints
const GAP = 2;             // s between a finished chapter and the next one
const RAID_TIMEOUT = 90;   // chapter 8: the raid starts at the latest this long after "Devam"
const END_WAIT = 8;        // s the closing lines stay before the victory screen (or "Devam")
const ENEMY_TC_HP = 0.6;   // the Karakurt Town Center starts at this share of its hp
export const SPEAKER = 'Bilge Ayaz';

const isMil = (u) => { const d = UNITS[u.type]; return !!d && d.cls !== 'civil' && d.atk > 0 && !d.naval; };
const soldiers = (g) => g.unitsOf(0).filter(isMil);
const cntB = (g, types) => g.buildingsOf(0).filter(b => types.includes(b.type) && b.done).length;
const myTc = (g) => g.buildingsOf(0).find(b => b.type === 'towncenter') || null;
const frac = (a, b) => Math.min(a, b) + '/' + b;
const mark = (ok) => (ok ? '✔' : '✘');
const topUp = (g, res) => { const r = g.players[0].res; let n = 0; for (const k in res) if ((r[k] || 0) < res[k]) { r[k] = res[k]; n++; } return n > 0; };
const alive = (g, id) => { const e = id != null ? g.getEntity(id) : null; return !!e && !e.dead; };

// spawns n units of type for owner around (x, z) (fixed offsets + _freeNear); returns their ids
function spawn(g, type, owner, n, x, z) {
  const ids = [];
  for (let k = 0; k < n; k++) {
    const f = g._freeNear(x + (k % 3 - 1) * 1.2, z + ((k / 3) | 0) * 1.2, owner);
    ids.push(g._addUnit(type, owner, f.x, f.z).id);
  }
  return ids;
}
const nearTc = (g) => { const tc = myTc(g), p = g.players[0]; return tc ? { x: tc.x, z: tc.z + 5 } : { x: p.startX, z: p.startZ + 5 }; };

// Chapters. enter(g, s): sim effects when the chapter opens; start(g, s): when "Devam" is pressed; check(g, s): done?
// prog(g, s): the quest panel's progress line; stuck(g, s): {text, x?, z?} for a stuck hint (may spawn help);
// hl: UI highlight keys (cat:<BUILD_CATS key>, b:<building>, u:<unit>, age, form, st:<stance>, idle, grp).
const CHAPTERS = [
  {
    id: 'cam', title: tr('Vadiye Bakış'), objective: tr('Kamerayı oynat, ardından en az 5 köylü seç'), desc: tr('Kamerayı kaydır ve en az 5 köylü seç'),
    lines: [tr('Uyan evlat! Bahar geldi, Kartal Obası seni bekliyor.'),
      tr('Önce etrafına bir bak. W A S D ya da ok tuşlarıyla kamerayı kaydır, fare tekerleğiyle yaklaş.'),
      tr('Sonra köylülerimizi seç: sol tuşu basılı tutup en az beş köylünün etrafına bir kutu çiz.')],
    hl: [],
    check: (g, s) => !!(s.acks.cam && s.acks.sel),
    prog: (g, s) => tr('Kamera {0} · Seçim {1}', mark(s.acks.cam), mark(s.acks.sel)),
    stuck: (g) => { const tc = myTc(g); return { text: tr('Fareyi basılı tutup köylülerin etrafında bir kutu çiz, evlat. Hepsi seçilir.'), x: tc && tc.x, z: tc && tc.z }; },
  },
  {
    id: 'walk', title: tr('İlk Adımlar'), objective: tr('Mızrakçıyı işaretli noktaya yürüt'), desc: tr('Mızrakçıyı sağ tık ile işarete gönder'),
    lines: [tr('Güzel. Şimdi mızrakçımız Doğan\'ı seç.'),
      tr('Sağ tıkladığın yere yürür. Onu yerde parlayan işarete gönder.')],
    hl: [],
    enter: (g, s) => {
      const tc = myTc(g), b = tc || { x: g.players[0].startX, z: g.players[0].startZ };
      const m = g._freeNear(b.x + 10, b.z + 10, 0); s.ids.marker = { x: m.x, z: m.z };
      const sp = g.unitsOf(0).find(u => u.type === 'spearman'); s.ids.spear = sp ? sp.id : null;
      if (!sp) s.ids.spear = spawn(g, 'spearman', 0, 1, b.x + 4, b.z)[0];
      g.events.emit('notify', { text: tr('Doğan\'ı buraya gönder'), type: 'info', x: m.x, z: m.z });
    },
    pings: (g, s) => [s.ids.marker],
    check: (g, s) => { const u = g.getEntity(s.ids.spear), m = s.ids.marker; return !!u && !u.dead && !!m && dhypot(u.x - m.x, u.z - m.z) <= 3; },
    prog: (g, s) => { const u = g.getEntity(s.ids.spear), m = s.ids.marker; return u && !u.dead && m ? tr('İşarete uzaklık: {0}', Math.max(0, Math.round(dhypot(u.x - m.x, u.z - m.z)))) : tr('Mızrakçı bekleniyor'); },
    stuck: (g, s) => {
      if (!alive(g, s.ids.spear)) { const c = nearTc(g); s.ids.spear = spawn(g, 'spearman', 0, 1, c.x, c.z)[0]; }
      const m = s.ids.marker || {};
      return { text: tr('Önce mızrakçıya sol tıkla, sonra işarete sağ tıkla. Kamerayı işarete götürmek için bildirime tıklayabilirsin.'), x: m.x, z: m.z };
    },
  },
  {
    id: 'gather', title: tr('Kışa Hazırlık'), objective: tr('Odun, yiyecek, taş ve altın topla'),
    desc: tr('Köylülerini ağaca, çalılığa ve kayalara gönder'),
    lines: [tr('Kış uzun olur. Köylülerini seç ve sağ tıkla: ağaca tıklarsan odun, çalılığa tıklarsan yiyecek toplarlar.'),
      tr('Taşla altın da lazım. Kayalıklar şurada.'),
      tr('Boşta köylü kalmasın. Nokta ya da Tab tuşu boşta olanı bulur.'),
      tr('Şehir Merkezini seçip Köylü düğmesine basarsan yeni köylü yetişir. Daha çok köylü, daha çok kaynak demek.')],
    hl: ['idle'],
    pings: (g) => { const c = nearTc(g); return [g.resourceNear(c.x, c.z - 5, 30, 'berries'), g.resourceNear(c.x, c.z - 5, 30, 'tree'), g.resourceNear(c.x, c.z - 5, 30, 'stone') || g.resourceNear(c.x, c.z - 5, 30, 'gold')].filter(Boolean).map(r => ({ x: r.x, z: r.z })); },
    check: (g, s) => s.cnt.wood >= 60 && s.cnt.food >= 60 && s.cnt.sg >= 30,
    prog: (g, s) => tr('odun {0} · yiyecek {1} · taş/altın {2}', frac(s.cnt.wood, 60), frac(s.cnt.food, 60), frac(s.cnt.sg, 30)),
    stuck: (g, s) => {
      const c = nearTc(g), q = [[s.cnt.wood / 60, 'tree', tr('Ağaçlar şurada, evlat. Köylüleri seç ve bir ağaca sağ tıkla.')],
        [s.cnt.food / 60, 'berries', tr('Yemiş çalılıkları yiyecek verir; köylülerini oraya gönder.')],
        [s.cnt.sg / 30, 'stone', tr('Kayalara iki köylü yeter. Taş da altın da hiç tükenmez.')]];
      let w = q[0]; for (const e of q) if (e[0] < w[0]) w = e;
      const r = g.resourceNear(c.x, c.z - 5, 30, w[1]) || (w[1] === 'stone' ? g.resourceNear(c.x, c.z - 5, 30, 'gold') : null);
      return { text: w[2], x: r && r.x, z: r && r.z };
    },
  },
  {
    id: 'build', title: tr('Obayı Büyüt'), objective: tr('Oduncu Kampı ve Ağıl kur'), desc: tr('Ormanın yanına Oduncu Kampı, bir de Ağıl kur'),
    lines: [tr('Köylüler odunu ta merkeze taşıyor, yoruluyorlar. Ormanın yanına bir Oduncu Kampı kur.'),
      tr('Bir köylü seç, aşağıdaki kartta İnşa: Ekonomi düğmesine bas, binayı seç ve yere koy. Sağ tıkla vazgeçebilirsin.'),
      tr('Bir de Ağıl kur: koyunlar kendiliğinden çoğalır, yiyecek verir.')],
    hl: ['cat:eco', 'b:lumbercamp', 'b:pasture'],
    enter: (g) => { if (topUp(g, { wood: 250 })) g.events.emit('notify', { text: tr('Komşu obadan hediye odun geldi'), type: 'good' }); },
    check: (g) => cntB(g, ['lumbercamp', 'storage']) >= 1 && cntB(g, ['pasture']) >= 1,
    prog: (g) => tr('Oduncu Kampı {0} · Ağıl {1}', frac(cntB(g, ['lumbercamp', 'storage']), 1), frac(cntB(g, ['pasture']), 1)),
    stuck: (g) => {
      const f = g.buildingsOf(0).find(b => !b.done && ['lumbercamp', 'storage', 'pasture'].includes(b.type));
      if (f) return { text: tr('Temel hazır ama kimse çalışmıyor. Köylüleri seç ve temele sağ tıkla.'), x: f.x, z: f.z };
      topUp(g, { wood: 200 });
      return { text: tr('Köylü seç, kartta İnşa: Ekonomi düğmesine bas, sonra Oduncu Kampını seç.') };
    },
  },
  {
    id: 'barracks', title: tr('Karakurt\'un Dumanı'), objective: tr('Kışla kur ve 3 Mızrakçı yetiştir'), desc: tr('Kışla kur, Kışladan 3 Mızrakçı yetiştir'),
    lines: [tr('Vadinin öte yanında duman var. Karakurt Kabilesi! Başlarındaki Börü yine gözünü obamıza dikmiş.'),
      tr('Askerlerimiz olmalı. Bir Kışla kur, sonra Kışlayı seç ve 3 Mızrakçı yetiştir.'),
      tr('Kışla seçiliyken yere sağ tıklarsan bir bayrak dikilir; yeni askerler oraya toplanır.')],
    hl: ['cat:mil', 'b:barracks', 'u:spearman'],
    pan: true,   // UI: a short camera look towards the enemy
    pings: (g, s) => { const e = g.getEntity(s.ids.enemyTc); return e ? [{ x: e.x, z: e.z }] : []; },
    enter: (g) => topUp(g, { wood: 200, food: 100 }),
    check: (g, s) => cntB(g, ['barracks']) >= 1 && s.cnt.spear >= 3,
    prog: (g, s) => tr('Kışla {0} · Mızrakçı {1}', frac(cntB(g, ['barracks']), 1), frac(s.cnt.spear, 3)),
    stuck: (g) => {
      const b = g.buildingsOf(0).find(x => x.type === 'barracks');
      if (!b) { topUp(g, { wood: 150 }); return { text: tr('Köylü seç, kartta İnşa: Askeri düğmesine bas ve Kışlayı yere koy.') }; }
      topUp(g, { food: 90, wood: 60 });
      return { text: tr('Kışla bitince onu seç; kartta Mızrakçı düğmesi var. Shift ile basarsan 5 tane sıraya koyar.'), x: b.x, z: b.z };
    },
  },
  {
    id: 'war', title: tr('Savaş Töresi'), objective: tr('Askerleri 1. gruba ata, Kare dizilişe ve Savunma duruşuna geçir'), desc: tr('Grup, diziliş ve duruşu öğren'),
    lines: [tr('Askerlerini bir arada tut. Hepsini seç ve Ctrl+1\'e bas; sonra 1\'e basınca hepsi seçilir.'),
      tr('Kartta Diziliş düğmesi var: her basışta Hat, Kare ve V arasında geçer. Kare dizilişe geç, sonra bir yere sağ tıkla ve nasıl dizildiklerini gör.'),
      tr('Duruşları da öğren: Savunma duruşundaki asker köyden fazla uzaklaşmaz.')],
    hl: ['form', 'st:defensive', 'grp'],
    enter: (g) => { if (soldiers(g).length < 3) { const c = nearTc(g); spawn(g, 'spearman', 0, 3 - soldiers(g).length, c.x + 3, c.z); } },
    check: (g) => { const w = chWar(g); return w.grp && w.box && w.def; },
    prog: (g) => { const w = chWar(g); return tr('Grup {0} · Diziliş {1} · Duruş {2}', mark(w.grp), mark(w.box), mark(w.def)); },
    stuck: (g) => { if (soldiers(g).length < 3) { const c = nearTc(g); spawn(g, 'spearman', 0, 3, c.x + 3, c.z); } return { text: tr('Askerleri seç, Ctrl ile 1\'e birlikte bas. Diziliş düğmesine Kare yazana kadar bas. Savunma duruşu G tuşunda.') }; },
  },
  {
    id: 'age', title: tr('Tunç Ustaları'), objective: tr('Şehir Merkezinden Tunç Devrine geç'), desc: tr('Şehir Merkezinden çağ atla'),
    lines: [tr('Güneyden tüccarlar geldi; tunç işlemeyi biliyorlar. Çağ atlama zamanı!'),
      tr('Şehir Merkezini seç ve kartta parlayan Çağ Atla düğmesine bas. Tunç Devri için üç farklı bina türü ve bir Kışla gerekir; ikisi de sende var.'),
      tr('Beklerken köylülerin çalışmaya devam etsin.')],
    hl: ['age'],
    enter: (g) => { if (topUp(g, { food: 1000, wood: 500 })) g.events.emit('notify', { text: tr('Tüccarlar erzak bıraktı'), type: 'good' }); },
    check: (g) => (g.players[0].age | 0) >= 1,
    prog: (g) => tr('Çağ: %{0}', Math.round((g.players[0].ageProgress || 0) * 100)),
    stuck: (g) => {
      const tc = myTc(g), aging = g.buildingsOf(0).some(b => b.queue.some(q => q.kind === 'age'));
      if (aging) return { text: tr('Çağ atlanıyor, evlat. Biraz sabır; köylüler çalışsın.') };
      const r = g.canAgeUp(0);
      if (!r.ok && r.reason === 'Yetersiz kaynak') topUp(g, { food: 1000, wood: 500 });
      if (!r.ok && r.reason !== 'Yetersiz kaynak') return { text: tr('Bir eksik var evlat: {0}.', tr(r.reason)), x: tc && tc.x, z: tc && tc.z };
      return { text: tr('Şehir Merkezine sol tıkla. Kartta parlayan Çağ Atla düğmesine bas.'), x: tc && tc.x, z: tc && tc.z };
    },
  },
  {
    id: 'raid', title: tr('Karakurt Baskını'),
    objective: (g, s) => (s.ids.raid ? tr('Karakurt baskınını püskürt') : tr('Okçuluk Alanı kur ve 3 Okçu yetiştir')),
    desc: (g, s) => (s.ids.raid ? tr('Şehir Merkezine saldıran 6 düşmanı yok et') : tr('Okçuluk Alanı kur, 3 Okçu yetiştir')),
    // (the Tunç line opens this chapter instead of closing chapter 7: a 'done' info only stays up for GAP seconds)
    lines: [tr('Tunç elimizde! Artık Okçuluk Alanı kurup okçu yetiştirebilirsin.'),
      tr('Gözcüler haber getirdi: Karakurt obamıza baskın hazırlıyor.'),
      tr('Okçular piyadeye karşı iyidir. Bir Okçuluk Alanı kur ve 3 Okçu yetiştir.')],
    hl: ['cat:mil', 'b:archery', 'u:archer'],
    enter: (g) => topUp(g, { wood: 270, gold: 75 }),
    tick: (g, s) => {
      if (!s.ids.raid && ((cntB(g, ['archery']) >= 1 && s.cnt.arch >= 3) || g.time - s.playAt >= RAID_TIMEOUT)) startRaid(g, s);
      // safety net: never fewer than 2 soldiers at home while the raid is on (at most every 30 s)
      if (s.ids.raid && soldiers(g).length < 2 && g.time >= (s.helpAt || 0)) {
        s.helpAt = g.time + 30; const c = nearTc(g); spawn(g, 'spearman', 0, 3, c.x, c.z);
        g.events.emit('notify', { text: tr('Komşu obadan yardım geldi'), type: 'good', x: c.x, z: c.z });
      }
    },
    check: (g, s) => !!s.ids.raid && s.ids.raid.every(id => !alive(g, id)),
    prog: (g, s) => (s.ids.raid ? tr('Düşman {0}', frac(s.ids.raid.filter(id => !alive(g, id)).length, s.ids.raid.length)) : tr('Okçu {0}', frac(s.cnt.arch, 3))),
    stuck: (g, s) => {
      if (!s.ids.raid) { if (!cntB(g, ['archery'])) topUp(g, { wood: 150 }); else topUp(g, { wood: 120, gold: 75 }); return { text: tr('İnşa: Askeri sayfasında Okçuluk Alanı var. Okçular uzaktan vurur, onları mızrakçıların arkasında tut.') }; }
      const tc = myTc(g); let best = null, bd = 1e9;
      for (const id of s.ids.raid) { const e = g.getEntity(id); if (!e || e.dead) continue; const d = tc ? dhypot(e.x - tc.x, e.z - tc.z) : 0; if (d < bd) { bd = d; best = e; } }
      return { text: tr('Bütün askerlerini seç ve düşmana sağ tıkla. Köylüler de savaşabilir ama zayıftır.'), x: best && best.x, z: best && best.z };
    },
  },
  {
    id: 'final', title: tr('Karakurt\'un Ocağı'), objective: tr('Karakurt Şehir Merkezini yık'), desc: tr('Ordunu topla ve düşman Şehir Merkezine saldır'),
    lines: [tr('Börü kaçtı ama yine gelir. Bu işi bitirelim, evlat.'),
      tr('Ordunu topla ve Karakurt\'un Şehir Merkezine sağ tıkla. Mızrakçılar binaya zor vurur, sabırlı ol.'),
      tr('Yeni gelenleri de seç ve Ctrl+1 ile gruba kat. Saldırırken Saldırgan duruşa geç: askerler gördükleri düşmanı kovalar.')],
    hl: ['grp'],
    enter: (g, s) => {
      const c = nearTc(g); spawn(g, 'archer', 0, 4, c.x - 2, c.z + 1); spawn(g, 'spearman', 0, 2, c.x + 2, c.z + 1);
      g.events.emit('notify', { text: tr('Obanın gençleri sana katıldı'), type: 'good', x: c.x, z: c.z });
      const e = g.getEntity(s.ids.enemyTc); if (e) g.events.emit('notify', { text: tr('Karakurt\'un Şehir Merkezi'), type: 'warn', x: e.x, z: e.z });
    },
    pings: (g, s) => { const e = g.getEntity(s.ids.enemyTc); return e ? [{ x: e.x, z: e.z }] : []; },
    tick: (g, s) => {
      if (s.arrived) return;
      const e = g.getEntity(s.ids.enemyTc); if (!e || e.dead) return;
      if (soldiers(g).some(u => dhypot(u.x - e.x, u.z - e.z) < 16)) { s.arrived = true; say(s, 'info', [tr('Kuleleri yok, sadece birkaç muhafız var. Önce muhafızları, sonra ocağı!')]); }
    },
    check: (g, s) => !alive(g, s.ids.enemyTc),
    prog: (g, s) => { const e = g.getEntity(s.ids.enemyTc); return tr('Şehir Merkezi canı: %{0}', e && !e.dead ? Math.max(1, Math.round(e.hp / e.maxHp * 100)) : 0); },
    stuck: (g, s) => {
      if (!soldiers(g).length) { const c = nearTc(g); spawn(g, 'spearman', 0, 4, c.x, c.z); }
      const e = g.getEntity(s.ids.enemyTc);
      return { text: tr('Askerlerini seç (1 tuşu), mini haritada düşman köşesine sağ tıkla, sonra Şehir Merkezine saldır.'), x: e && e.x, z: e && e.z };
    },
  },
];
const END_LINES = [tr('Karakurt\'un ocağı söndü! Obamız bu kışı rahat geçirecek.'), tr('Bu hikâyeyi torunlarına sen anlatacaksın. Artık gerçek savaşlara hazırsın.'),
  tr('Unutma: gerçek bir maçta rakibin asker ve köylü çıkaran bütün binalarını yıkman gerekir: Şehir Merkezi, Kışla, Okçuluk Alanı, Ahır ve ötekiler.')];
const LOSE_LINES = [tr('Bu sefer olmadı evlat. Yeniden dene.')];
const DONE_LINES = [tr('Aferin evlat!')];
export const TUT_CHAPTERS = CHAPTERS.length;

function chWar(g) {
  const sol = soldiers(g), set = new Set(sol.map(u => u.id)), cg = (g.players[0].cg || {})[1] || [];
  return { grp: cg.filter(id => set.has(id)).length >= 3, box: sol.filter(u => u.form === 'box').length >= 3, def: sol.filter(u => u.stance === 'defensive').length >= 3 };
}
function say(s, kind, lines, x, z) { s.msg = { seq: (s.msg ? s.msg.seq : 0) + 1, kind, lines: lines.slice(), x: x == null ? null : x, z: z == null ? null : z }; }
function startRaid(g, s) {
  const tc = myTc(g), e = g.getEntity(s.ids.enemyTc), p = g.players[0];
  const ax = tc ? tc.x : p.startX, az = tc ? tc.z : p.startZ, bx = e ? e.x : g.players[1].startX, bz = e ? e.z : g.players[1].startZ;
  const L = dhypot(bx - ax, bz - az) || 1, px = ax + (bx - ax) / L * 30, pz = az + (bz - az) / L * 30;
  const ids = spawn(g, 'spearman', 1, 4, px, pz).concat(spawn(g, 'archer', 1, 2, px, pz + 2.6));
  s.ids.raid = ids; s.raidAt = g.time;
  if (tc) g.cmdAttack(ids, tc.id);
  g.events.emit('notify', { text: tr('Karakurt baskını! Şehir Merkezine saldırıyorlar.'), type: 'warn', x: px, z: pz });
  say(s, 'info', [tr('Karakurt geliyor! Şehir Merkezi de ok atar. Askerlerini 1\'e basıp seç ve düşmana sağ tıkla!')], px, pz);
}

export class TutorialSystem {
  constructor(game) {
    this.game = game;
    this.tutorial = true;
    this.t = 0;
    this.s = { step: 0, phase: 'story', go: false, enteredAt: 0, playAt: 0, hintAt: 0, nextAt: 0, endAt: 0, acks: {}, cnt: {}, ids: {}, raidAt: null, helpAt: 0, arrived: false, setup: false, msg: null, hint: null, hintN: 0, won: null };
    this.list = [];
    this._bound = false;
  }
  get chapters() { return CHAPTERS; }
  get chapter() { return CHAPTERS[this.s.step] || null; }

  // once, on a new game (not on load): the rival tribe's camp. Its villagers and spearman go, a finished barracks and
  // three guards come; with no villagers left, losing its Town Center ends the tribe.
  setup() {
    const g = this.game, s = this.s;
    if (s.setup || !g.players[1]) return;
    s.setup = true;
    for (const u of g.unitsOf(1)) g._tutRemove(u);
    const tc = g.buildingsOf(1).find(b => b.type === 'towncenter'), p0 = g.players[0];
    if (tc) {
      s.ids.enemyTc = tc.id;
      tc.hp = Math.round(tc.maxHp * ENEMY_TC_HP);
      // barracks on the far side of the camp (fixed scan order), guards between the camp and the player
      const dx = Math.sign(tc.x - p0.startX) || 1, dz = Math.sign(tc.z - p0.startZ) || 1, sz = BUILDINGS.barracks.size;
      let put = null;
      for (let r = 5; r < 14 && !put; r++) for (const [ox, oz] of [[r, 0], [0, r], [r, r], [r, -r], [-r, r]]) {
        const tx = Math.round(tc.x + dx * ox - sz / 2), tz = Math.round(tc.z + dz * oz - sz / 2);
        if (g.canPlace('barracks', tx, tz, 1)) { put = [tx, tz]; break; }
      }
      if (put) { g._addBuilding('barracks', 1, put[0], put[1], true); g._popCap(g.players[1]); }
      const guards = spawn(g, 'spearman', 1, 3, tc.x - dx * 5, tc.z - dz * 5);
      g.cmdStance(guards, 'defensive');
      s.ids.guards = guards;
    }
    this._enter(0);
  }

  _bind() {
    if (this._bound) return;
    const ev = this.game.events; if (!ev || !ev.on) return;
    this._bound = true;
    const s = this.s;
    ev.on('deposit', (p) => {
      if (!p || p.owner !== 0 || s.step !== 2 || s.phase !== 'play') return;
      const a = p.amount || 0;
      if (p.res === 'wood') s.cnt.wood += a; else if (p.res === 'food') s.cnt.food += a; else if (p.res === 'stone' || p.res === 'gold') s.cnt.sg += a;
    });
    ev.on('trained', (p) => {
      const e = p && p.e; if (!e || e.owner !== 0 || (s.phase !== 'story' && s.phase !== 'play')) return;
      if (e.type === 'spearman') s.cnt.spear++; else if (e.type === 'archer') s.cnt.arch++;
    });
  }

  _txt(v) { return typeof v === 'function' ? v(this.game, this.s) : v; }
  _item() {
    const ch = this.chapter; if (!ch) return;
    const q = this.list[0] && this.list[0].id === 'tut-' + ch.id ? this.list[0] : null;
    let prog = ''; try { prog = String(ch.prog(this.game, this.s)); } catch (e) { prog = ''; }
    const item = q || { id: 'tut-' + ch.id, title: ch.title, desc: '', done: false, active: true, progress: '' };
    item.desc = this._txt(ch.desc); if (!item.done) item.progress = prog;
    this.list = [item];
  }
  // the objective line for the HUD (ui _refreshSlow)
  objective() {
    const ch = this.chapter, s = this.s;
    if (!ch || s.phase === 'end' || s.phase === 'over') return null;
    return { n: s.step + 1, of: CHAPTERS.length, title: ch.title, text: this._txt(ch.objective), progress: this.list[0] ? this.list[0].progress : '', done: s.phase === 'gap' };
  }

  _enter(step) {
    const g = this.game, s = this.s;
    s.step = step; s.phase = 'story'; s.go = false; s.enteredAt = g.time; s.acks = {}; s.cnt = { wood: 0, food: 0, sg: 0, spear: 0, arch: 0 }; s.hint = null; s.arrived = false;
    const ch = CHAPTERS[step];
    try { if (ch.enter) ch.enter(g, s); } catch (err) { console.error('tutorial enter', err); }
    let pings = []; try { pings = ch.pings ? ch.pings(g, s).filter(Boolean) : []; } catch (err) { pings = []; }
    say(s, 'intro', ch.lines); s.msg.pings = pings;
    this.list = []; this._item();
  }

  // UI-only facts reported to the sim: 'go' (the story panel's "Devam"), 'cam' (the camera moved), 'sel' (villagers
  // selected). Acceptable only because the tutorial is single player: cfg.tutorial is forced off in multiplayer
  // (Game constructor), so this wall-clock input can never reach a lockstep simulation.
  ack(key) {
    const s = this.s;
    if (key === 'go') { if (s.phase === 'story' || s.phase === 'end') s.go = true; return true; }
    if (key === 'cam' || key === 'sel') { if (s.phase === 'play' && s.step === 0) s.acks[key] = true; return true; }
    return false;
  }

  update(dt) {
    const g = this.game, s = this.s;
    if (!g.players[0] || g.over) return;
    this._bind();
    // chapter 8 safety net, every tick: the player's Town Center never drops below 30 % during the raid
    if (s.step === 7) { const tc = myTc(g); if (tc && tc.done && tc.hp < tc.maxHp * 0.3) tc.hp = Math.ceil(tc.maxHp * 0.3); }
    this.t -= dt; if (this.t > 0) return; this.t = CHECK_EVERY;
    const ch = CHAPTERS[s.step];
    if (s.phase === 'gap') { if (g.time >= s.nextAt) this._enter(s.step + 1); return; }
    if (s.phase === 'end') { if (s.go || g.time >= s.endAt) this._finish(true); return; }
    if (s.phase === 'over') return;
    // (practically impossible: the Town Center is clamped in the raid and the rival never attacks otherwise)
    if (!myTc(g)) { s.phase = 'over'; say(s, 'lose', LOSE_LINES); this._finish(false); return; }
    if (s.phase === 'story') {
      if (!s.go) { this._item(); return; }
      s.go = false; s.phase = 'play'; s.playAt = g.time; s.hintAt = g.time + HINT_EVERY;
      if (s.step === 2) s.cnt.wood = s.cnt.food = s.cnt.sg = 0;
    }
    // play
    try { if (ch.tick) ch.tick(g, s); } catch (err) { console.error('tutorial tick', err); }
    let ok = false; try { ok = !!ch.check(g, s); } catch (err) { ok = false; }
    this._item();
    if (ok) {
      const q = this.list[0]; q.done = true; q.active = false; q.progress = tr('Tamamlandı');
      g.events.emit('questDone', { quest: q });
      if (s.step === CHAPTERS.length - 1) { s.phase = 'end'; s.endAt = g.time + END_WAIT; s.go = false; say(s, 'end', END_LINES); return; }
      const dl = ch.done || DONE_LINES; s.phase = 'gap'; s.nextAt = g.time + GAP + 4 * (dl.length - 1); say(s, 'info', dl);
      return;
    }
    if (g.time >= s.hintAt) {
      s.hintAt = g.time + HINT_EVERY;
      let h = null; try { h = ch.stuck ? ch.stuck(g, s) : null; } catch (err) { h = null; }
      // (hintN never resets: _enter clears s.hint, and the UI only shows a hint whose seq it has not seen yet)
      if (h && h.text) s.hint = { seq: (s.hintN = (s.hintN | 0) + 1), text: h.text, x: h.x == null ? null : h.x, z: h.z == null ? null : h.z };
    }
  }

  _finish(won) {
    const g = this.game, s = this.s;
    if (g.over) return;
    s.phase = 'over'; s.won = !!won;
    g.over = { won: !!won, winnerTeam: g.teamOf(won ? 0 : 1), tutorial: true };
    g._overSent = true; g.reveal = true;
    try { g._updateFog(); } catch (err) { /* view only */ }
    g.events.emit('gameOver', { won: !!won, winnerTeam: g.over.winnerTeam, tutorial: true });
  }

  serialize() { return { v: 1, s: JSON.parse(JSON.stringify(this.s)), list: JSON.parse(JSON.stringify(this.list)) }; }
  load(o) {
    if (!o || !o.s) return;
    try { Object.assign(this.s, o.s); this.list = Array.isArray(o.list) ? o.list : []; if (!this.list.length) this._item(); } catch (err) { /* ignore */ }
  }
}
