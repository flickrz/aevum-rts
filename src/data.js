// Aevum — static game definitions (pure data, no DOM/three)
export const RES = ['food', 'wood', 'stone', 'gold'];
export const PLAYER_COLORS = [0x2e7bff, 0xe23b3b, 0xf2c230, 0x9b4de0, 0x2fbf71, 0xff8a1f, 0x23c9d6, 0xe85fb4];

// Age-ups (owner 2026-11-15: "we skip every age and reach the last one in the first 10 minutes"): about 3.5x the old
// cost and twice the time; more building types (reqBuildings: different types, houses / walls / gates / town centres
// not counted) plus named buildings (reqTypes, finished); and a minimum stay (minStay s since the start or the last
// age-up), so the next age-up can't be clicked the moment the last one lands.
export const AGES = [
  { id: 0, name: 'Taş Devri', cost: {}, time: 0, reqBuildings: 0, unlockText: ['Köylü', 'Mızrakçı', 'Ev', 'Ağıl', 'Kışla', 'Depo', 'Oduncu Kampı', 'Maden Ocağı'] },
  { id: 1, name: 'Tunç Devri', cost: { food: 1000, wood: 500 }, time: 90, reqBuildings: 3, reqTypes: ['barracks'], minStay: 240, unlockText: ['Tarla', 'Kılıç Ustası', 'Okçu', 'Hafif Süvari', 'Okçuluk Alanı', 'Ahır', 'Demirci', 'Pazar', 'Kule', 'Sur', 'Tapınak'] },
  { id: 2, name: 'Orta Çağ', cost: { food: 1800, wood: 800, gold: 1000, stone: 400 }, time: 140, reqBuildings: 5, reqTypes: ['blacksmith', 'market'], minStay: 300, unlockText: ['Ağır Piyade', 'Arbaletçi', 'Şövalye', 'Koçbaşı', 'Mancınık', 'Ticaret Arabası', 'Üniversite', 'Kale', 'Kuşatma Atölyesi'] },
  { id: 3, name: 'Barut Çağı', cost: { food: 2500, wood: 1200, gold: 2000, stone: 1000 }, time: 180, reqBuildings: 7, reqTypes: ['university'], minStay: 360, unlockText: ['Tüfekçi', 'Top', 'Zırhlı Süvari', 'Harp Akademisi', 'Banka'] },
  { id: 4, name: 'Sanayi Çağı', cost: { food: 3200, wood: 1600, gold: 3500, stone: 1600 }, time: 220, reqBuildings: 9, reqTypes: ['academy', 'bank'], minStay: 360, unlockText: ['Piyade Tüfekçisi', 'Sahra Topu', 'Fabrika'] },
];

function U(id, name, cls, age, cost, time, hp, atk, armor, speed, range, rof, los, pop, bonus, proj, icon, desc) {
  return { id, name, cls, age, cost, time, hp, atk, armor, speed, range, rof, los, pop, bonus, proj, icon, desc };
}
export const UNITS = {
  villager: U('villager', 'Köylü', 'civil', 0, { food: 40 }, 18, 25, 3, 0, 2.2, 0, 1.5, 6, 1, {}, null, '🧑‍🌾', 'Kaynak toplar, bina kurar ve onarır.'),
  spearman: U('spearman', 'Mızrakçı', 'infantry', 0, { food: 30, wood: 20 }, 18, 45, 4, 0, 2.3, 0, 1.4, 6, 1, { cavalry: 2.5 }, null, '🔱', 'Ucuz piyade. Süvariye karşı güçlü.'),
  swordsman: U('swordsman', 'Kılıç Ustası', 'infantry', 1, { food: 45, gold: 25 }, 22, 60, 7, 1, 2.2, 0, 1.4, 6, 1, { building: 1.5, siege: 1.5 }, null, '⚔️', 'Dengeli yakın dövüş piyadesi.'),
  archer: U('archer', 'Okçu', 'ranged', 1, { wood: 40, gold: 25 }, 22, 35, 5, 0, 2.3, 5, 1.8, 7, 1, { infantry: 1.4 }, 'arrow', '🏹', 'Menzilli birlik. Piyadeye karşı etkili.'),
  lightcav: U('lightcav', 'Hafif Süvari', 'cavalry', 1, { food: 60, gold: 15 }, 24, 70, 6, 0, 3.8, 0, 1.5, 8, 1, { ranged: 1.5, siege: 2.5 }, null, '🐎', 'Hızlı akıncı. Okçulara karşı güçlü.'),
  heavyinf: U('heavyinf', 'Ağır Piyade', 'infantry', 2, { food: 50, gold: 60 }, 26, 95, 11, 4, 2.0, 0, 1.6, 6, 1, { building: 1.5, siege: 1.5 }, null, '🛡️', 'Yüksek zırhlı ağır piyade.'),
  crossbow: U('crossbow', 'Arbaletçi', 'ranged', 2, { wood: 45, gold: 45 }, 25, 45, 8, 0, 2.2, 6, 2.2, 8, 1, { infantry: 1.5 }, 'arrow', '🎯', 'Güçlü menzilli birlik.'),
  knight: U('knight', 'Şövalye', 'cavalry', 2, { food: 70, gold: 85 }, 30, 130, 12, 3, 3.5, 0, 1.6, 7, 1, { ranged: 1.4, siege: 2.5 }, null, '🏇', 'Zırhlı ağır süvari.'),
  ram: U('ram', 'Koçbaşı', 'siege', 2, { wood: 160, gold: 60 }, 36, 200, 4, 2, 1.3, 0, 3, 5, 2, { building: 12 }, null, '🪵', 'Sadece binalara saldırır, surları yıkar.'),
  catapult: U('catapult', 'Mancınık', 'siege', 2, { wood: 150, gold: 120, stone: 50 }, 40, 70, 30, 0, 1.3, 8, 5, 9, 3, { building: 3 }, 'stone', '☄️', 'Uzun menzilli alan hasarı.'),
  tradecart: U('tradecart', 'Ticaret Arabası', 'civil', 2, { wood: 100, gold: 50 }, 30, 60, 0, 0, 2.4, 0, 2, 5, 1, {}, null, '🛒', 'Pazar ile Şehir Merkezi arasında gidip gelerek altın kazandırır.'),
  musketeer: U('musketeer', 'Tüfekçi', 'ranged', 3, { food: 45, gold: 65 }, 26, 60, 18, 1, 2.2, 6, 3, 8, 1, { cavalry: 1.2, infantry: 1.2 }, 'bullet', '🔫', 'Barutlu menzilli piyade.'),
  cannon: U('cannon', 'Top', 'siege', 3, { wood: 180, gold: 180, stone: 80 }, 45, 90, 30, 0, 1.2, 9, 5.5, 10, 3, { building: 5, cavalry: 0.6 }, 'cannonball', '💣', 'Binaları ve kalabalıkları ezer.'),
  cuirassier: U('cuirassier', 'Zırhlı Süvari', 'cavalry', 3, { food: 85, gold: 110 }, 32, 170, 16, 4, 3.6, 0, 1.5, 7, 1, { ranged: 1.4, siege: 3 }, null, '🦄', 'Barut çağının seçkin süvarisi.'),
  rifleman: U('rifleman', 'Piyade Tüfekçisi', 'ranged', 4, { food: 50, gold: 75 }, 24, 75, 24, 2, 2.3, 7.5, 2, 9, 1, { cavalry: 1.3 }, 'bullet', '🎖️', 'Hızlı ateş eden modern piyade.'),
  artillery: U('artillery', 'Sahra Topu', 'siege', 4, { wood: 220, gold: 250, stone: 120 }, 50, 120, 48, 1, 1.2, 11, 6, 12, 3, { building: 5.8, cavalry: 0.6 }, 'cannonball', '🧨', 'En uzun menzilli kuşatma silahı.'),
  // --- naval (ships: naval:true, cls 'ship', live only on water tiles 3/4) ---
  fishboat: Object.assign(U('fishboat', 'Balıkçı Teknesi', 'ship', 0, { wood: 60 }, 22, 60, 0, 0, 2.6, 0, 2, 7, 1, {}, null, '🎣', 'Balık sürülerinden yiyecek toplar ve en yakın iskeleye taşır.'), { naval: true }),
  transport: Object.assign(U('transport', 'Nakliye Gemisi', 'ship', 1, { wood: 120 }, 30, 160, 0, 2, 2.8, 0, 2, 7, 1, {}, null, '⛵', 'Silahsız. 10 kara birliğini kıyıdan kıyıya taşır.'), { naval: true }),
  galley: Object.assign(U('galley', 'Kadırga', 'ship', 1, { wood: 110, gold: 40 }, 30, 150, 6, 1, 2.9, 6, 2, 8, 2, { ship: 1.2, building: 0.8 }, 'arrow', '🚣', 'Ok atan savaş gemisi. Gemilere ve kıyıdaki birliklere saldırır.'), { naval: true }),
  galleon: Object.assign(U('galleon', 'Kalyon', 'ship', 3, { wood: 220, gold: 120 }, 40, 320, 22, 3, 2.5, 7.5, 4, 9, 3, { ship: 1.6, building: 1.8 }, 'cannonball', '🚢', 'Toplu savaş gemisi. Gemilere ve kıyı binalarına karşı çok güçlü.'), { naval: true }),
  ironclad: Object.assign(U('ironclad', 'Zırhlı', 'ship', 4, { wood: 200, gold: 220, stone: 80 }, 45, 520, 34, 6, 2.6, 8.5, 4, 10, 3, { ship: 1.6, building: 2 }, 'cannonball', '⚓', 'Zırh kaplı buharlı savaş gemisi. Denizlerin hâkimi.'), { naval: true }),
  // railway train: spawned by the sim for each connected station pair, not trainable / not commandable
  train: U('train', 'Tren', 'train', 4, {}, 0, 600, 0, 6, 4.5, 0, 1, 6, 0, {}, null, '🚂', 'İki bağlı istasyon arasında gidip gelir; her varışta altın kazandırır.'),
};

function B(id, name, age, cost, time, hp, size, popCap, trains, researches, dropoff, atk, range, los, icon, desc) {
  return { id, name, age, cost, time, hp, size, popCap, trains, researches, dropoff, atk, range, los, icon, desc };
}
export const BUILDINGS = {
  towncenter: B('towncenter', 'Şehir Merkezi', 0, { wood: 400, stone: 200 }, 90, 2400, 4, 5, ['villager'], ['basket', 'loom', 'wheelbarrow'], RES.slice(), 6, 7, 10, '🏛️', 'Köylü üretir, kaynak teslim alınır, çağ atlanır.'),
  house: B('house', 'Ev', 0, { wood: 30 }, 15, 500, 2, 5, [], [], null, 0, 0, 4, '🏠', '+5 nüfus kapasitesi.'),
  farm: B('farm', 'Tarla', 1, { wood: 150 }, 30, 600, 3, 0, [], ['plow', 'crop', 'irrigation'], null, 0, 0, 3, '🌾', 'Ortada ambar, çevresinde 8 parsel: her parselde bir çiftçi ekip biçer, ürünü ambara taşır. Tarım geliştirmeleri ambarda araştırılır.'),
  barracks: B('barracks', 'Kışla', 0, { wood: 125 }, 30, 1200, 3, 0, ['spearman', 'swordsman', 'heavyinf', 'musketeer', 'rifleman'], ['drill'], null, 0, 0, 6, '⚔️', 'Piyade birlikleri üretir.'),
  archery: B('archery', 'Okçuluk Alanı', 1, { wood: 150 }, 30, 1100, 3, 0, ['archer', 'crossbow'], [], null, 0, 0, 6, '🏹', 'Menzilli birlikler üretir.'),
  stable: B('stable', 'Ahır', 1, { wood: 150 }, 30, 1100, 3, 0, ['lightcav', 'knight', 'cuirassier'], ['husbandry', 'bloodlines'], null, 0, 0, 6, '🐴', 'Süvari birlikleri üretir.'),
  blacksmith: B('blacksmith', 'Demirci', 1, { wood: 150 }, 30, 1100, 3, 0, [], ['forging', 'ironcast', 'steel', 'fletching', 'bodkin', 'scale', 'plate', 'barding'], null, 0, 0, 6, '⚒️', 'Silah ve zırh geliştirmeleri.'),
  market: B('market', 'Pazar', 1, { wood: 150 }, 30, 1100, 3, 0, ['tradecart'], ['coinage', 'caravan'], null, 0, 0, 6, '⚖️', 'Kaynak takası ve ticaret arabaları.'),
  storage: B('storage', 'Depo', 0, { wood: 80 }, 20, 700, 2, 0, [], ['handcart'], RES.slice(), 0, 0, 5, '📦', 'Kaynak teslim noktası.'),
  tower: B('tower', 'Kule', 1, { stone: 125, wood: 25 }, 35, 900, 1, 0, [], [], null, 9, 8, 9, '🗼', 'Yaklaşan düşmanlara ok atar; Barut Çağı’ndan itibaren gülle atar. Her çağda hasarı +5, Orta Çağ’dan itibaren menzili +1 artar.'),
  wall: B('wall', 'Sur', 1, { stone: 5 }, 12.5, 900, 1, 0, [], [], null, 0, 0, 2, '🧱', 'Basılı tutup sürükleyerek sur hattı çiz. Köylüler parçaları sırayla örer.'),
  gate: B('gate', 'Kapı', 1, { stone: 30 }, 30, 1200, 1, 0, [], [], null, 0, 0, 3, '🚪', 'Sadece kendi birliklerin geçebilir.'),
  university: B('university', 'Üniversite', 2, { wood: 200, gold: 100, stone: 100 }, 40, 1300, 3, 0, [], ['masonry', 'architecture', 'arrowslits', 'guardtower', 'fortify', 'ballistics'], null, 0, 0, 6, '🎓', 'Savunma ve mühendislik araştırmaları.'),
  castle: B('castle', 'Kale', 2, { stone: 600, gold: 200 }, 120, 4000, 4, 10, [], ['garrisonart'], null, 12, 9, 11, '🏰', 'Güçlü savunma yapısı: her 2 saniyede 3 hedefe birden ok yağdırır, saldırısı her çağda artar. Kulelerden daha uzağa vurur.'),
  siege: B('siege', 'Kuşatma Atölyesi', 2, { wood: 200, stone: 100 }, 40, 1200, 3, 0, ['ram', 'catapult', 'cannon'], ['siegecraft'], null, 0, 0, 6, '🛠️', 'Kuşatma silahları üretir.'),
  factory: B('factory', 'Fabrika', 4, { wood: 300, stone: 200, gold: 200 }, 60, 2200, 4, 0, ['artillery', 'cannon'], ['assembly', 'steam', 'rifling', 'explosives', 'steelrails'], null, 0, 0, 7, '🏭', 'Sanayi çağı silahları üretir.'),
  mill: B('mill', 'Değirmen', 0, { wood: 100 }, 25, 800, 3, 0, [], [], ['food'], 0, 0, 5, '🌬️', 'Yiyecek teslim noktası (eski kayıtlar).'),
  lumbercamp: B('lumbercamp', 'Oduncu Kampı', 0, { wood: 70 }, 18, 600, 2, 0, [], ['axe', 'saw'], ['wood'], 0, 0, 5, '🪵', 'Odun teslim noktası. Odunculuk geliştirmeleri.'),
  minecamp: B('minecamp', 'Maden Ocağı', 0, { wood: 70 }, 18, 600, 2, 0, [], ['pickaxe', 'shaft'], ['stone', 'gold'], 0, 0, 5, '⛏️', 'Taş ve altın teslim noktası. Madencilik geliştirmeleri.'),
  temple: B('temple', 'Tapınak', 1, { wood: 150, stone: 75 }, 35, 1100, 3, 0, [], ['herbs', 'townwatch', 'medicine'], null, 0, 0, 7, '⛩️', '7 kare içindeki birliklerini yavaşça iyileştirir (savaş dışında 1 can/sn).'),
  academy: B('academy', 'Harp Akademisi', 3, { wood: 250, stone: 150, gold: 200 }, 50, 1500, 3, 0, [], ['formation', 'corning', 'conscription', 'siegeeng'], null, 0, 0, 6, '🎖️', 'İleri askeri araştırmalar.'),
  dock: B('dock', 'İskele', 0, { wood: 150 }, 35, 1200, 3, 0, ['fishboat', 'transport', 'galley', 'galleon', 'ironclad'], ['nets', 'shipwright', 'gunnery', 'careening'], null, 0, 0, 6, '⚓', 'Kıyıya kurulur (en az 2 su, 3 kara karesi). Gemi üretir, balıkçı teknelerinin teslim noktası.'),
  bank: B('bank', 'Banka', 3, { wood: 200, stone: 200, gold: 150 }, 50, 1400, 3, 0, [], ['banking', 'guilds'], null, 0, 0, 6, '🏦', 'Her banka 3 saniyede +1 altın kazandırır (en fazla 3 banka sayılır). Finans araştırmaları.'),
  pasture: B('pasture', 'Ağıl', 0, { wood: 130 }, 25, 500, 3, 0, [], ['breeding'], null, 0, 0, 3, '🐑', 'Koyun ağılı: koyunlar otlayıp yavaşça 8\'e çoğalır ve kimse çalışmasa da az ama düzenli yiyecek verir. En fazla 6 köylü içeride çalışıp çok daha fazlasını toplar.'),
  station: B('station', 'İstasyon', 4, { wood: 250, stone: 150, gold: 100 }, 45, 1600, 3, 0, [], [], null, 0, 0, 6, '🚉', 'İki istasyonu ray hattıyla bağla: aralarında bir tren gidip gelir ve her varışta altın getirir.'),
  rail: B('rail', 'Ray', 4, { wood: 8, stone: 4 }, 4, 250, 1, 0, [], [], null, 0, 0, 1, '🛤️', 'Basılı tutup sürükleyerek ray hattı çiz. Birlikler rayın üstünden geçebilir.'),
};
// The pasture went 4 -> 6 on 2026-11-17 (owner: "it looks far too small next to everything").
// Buildings in real proportion to the people (owner decision 2026-11-13): footprints grow ~1.7x, the models
// keep their design and are drawn scaled by size / baseSize. Towers became 3x3 on 2026-11-14 (owner: walls and towers
// looked tiny next to the bigger buildings). Walls, gates, rails and the dock keep their size (wall lines, the dock's
// water footprint, the station's rail layout); walls and gates are drawn taller instead. A building in an old save keeps the size it was built with.
export const BUILDING_SIZES = { towncenter: 6, castle: 6, factory: 6, house: 3, tower: 3, storage: 3, lumbercamp: 3, minecamp: 3, farm: 12, pasture: 6,
  barracks: 5, archery: 5, stable: 5, blacksmith: 5, market: 5, university: 5, siege: 5, mill: 5, temple: 5, academy: 5, bank: 5 };   // (station: rails and trains are laid out around its 3x3)
for (const [k, b] of Object.entries(BUILDINGS)) { b.baseSize = b.size; if (BUILDING_SIZES[k]) b.size = BUILDING_SIZES[k]; }
// The mill (2026-11-14, owner meeting): its farm radius bonus is gone and its farming techs moved to the farm's granary.
// Kept only so old saves load (a standing mill still takes food); it cannot be placed any more (legacy).
BUILDINGS.mill.legacy = true;
// the farm (2026-11-13): one 12x12 piece = 3x3 cells of 4 tiles, a granary in the middle and 8 plots around it,
// one farmer per plot. Its model is drawn at its real size (not scaled).
export const FARM_SLOTS = 8;
BUILDINGS.farm.baseSize = BUILDINGS.farm.size;

function T(id, name, desc, age, cost, time, cat, icon, fx) { return { id, name, desc, age, cost, time, cat, icon, fx }; }
export const TECHS = {
  axe: T('axe', 'Taş Balta', 'Odun toplama +%25', 0, { food: 40, wood: 40 }, 20, 'eco', '🪓', { gather: { wood: 0.25 } }),
  basket: T('basket', 'Sepet', 'Taşıma kapasitesi +5', 0, { food: 40, wood: 40 }, 20, 'eco', '🧺', { carry: 5 }),
  pickaxe: T('pickaxe', 'Kazma', 'Taş ve altın toplama +%25', 1, { food: 50, wood: 75 }, 25, 'eco', '⛏️', { gather: { stone: 0.25, gold: 0.25 } }),
  plow: T('plow', 'Saban', 'Tarla verimi +%50', 1, { wood: 75 }, 25, 'eco', '🚜', { farm: 0.5 }),
  wheelbarrow: T('wheelbarrow', 'El Arabası', 'Köylü hızı +%10, taşıma +5', 1, { food: 100, wood: 75 }, 35, 'eco', '🛞', { vspeed: 0.1, carry: 5 }),
  crop: T('crop', 'Ekim Nöbeti', 'Tarla verimi +%50', 1, { wood: 100, gold: 50 }, 35, 'eco', '🌱', { farm: 0.5 }),
  saw: T('saw', 'Hızar', 'Odun toplama +%25', 2, { gold: 100, stone: 75 }, 35, 'eco', '🪚', { gather: { wood: 0.25 } }),
  shaft: T('shaft', 'Maden Kuyusu', 'Taş ve altın toplama +%25', 2, { wood: 150, stone: 75 }, 35, 'eco', '🕳️', { gather: { stone: 0.25, gold: 0.25 } }),
  forging: T('forging', 'Dövme', 'Piyade ve süvari saldırısı +2', 1, { food: 75, gold: 75 }, 35, 'mil', '🔨', { atk: { infantry: 2, cavalry: 2 } }),
  ironcast: T('ironcast', 'Demir Döküm', 'Piyade ve süvari saldırısı +2', 2, { food: 100, gold: 200, stone: 50 }, 45, 'mil', '🗡️', { atk: { infantry: 2, cavalry: 2 } }),
  fletching: T('fletching', 'Ok Tüyü', 'Menzilli saldırı +1, menzil +1', 1, { wood: 75, gold: 60 }, 30, 'mil', '🪶', { atk: { ranged: 1 }, range: { ranged: 1 } }),
  bodkin: T('bodkin', 'Zırh Delen Uç', 'Menzilli saldırı +2, menzil +1', 2, { wood: 125, gold: 150 }, 45, 'mil', '📍', { atk: { ranged: 2 }, range: { ranged: 1 } }),
  scale: T('scale', 'Pul Zırh', 'Piyade zırhı +1', 1, { food: 50, stone: 75 }, 30, 'mil', '🥋', { armor: { infantry: 1 } }),
  plate: T('plate', 'Plaka Zırh', 'Piyade zırhı +2', 2, { food: 100, stone: 150, gold: 100 }, 45, 'mil', '🛡️', { armor: { infantry: 2 } }),
  barding: T('barding', 'At Zırhı', 'Süvari zırhı +2', 1, { food: 75, stone: 75, gold: 50 }, 35, 'mil', '🐎', { armor: { cavalry: 2 } }),
  husbandry: T('husbandry', 'At Yetiştiriciliği', 'Süvari hızı +%10', 2, { food: 75, gold: 75 }, 35, 'mil', '🥕', { speed: { cavalry: 0.1 } }),
  drill: T('drill', 'Talim', 'Piyade hızı +%10', 3, { food: 100, gold: 150 }, 40, 'mil', '🥁', { speed: { infantry: 0.1 } }),
  ballistics: T('ballistics', 'Balistik', 'Kuşatma saldırısı +%25', 3, { wood: 250, gold: 200 }, 50, 'mil', '📐', { atkMul: { siege: 0.25 } }),
  masonry: T('masonry', 'Duvarcılık', 'Bina dayanıklılığı +%20', 2, { wood: 150, stone: 100 }, 40, 'def', '🧱', { bhp: 0.2 }),
  architecture: T('architecture', 'Mimarlık', 'Bina dayanıklılığı +%20', 3, { wood: 250, stone: 200 }, 50, 'def', '📏', { bhp: 0.2 }),
  arrowslits: T('arrowslits', 'Mazgal', 'Kule ve kale saldırısı +3', 2, { wood: 150, gold: 100 }, 40, 'def', '🎯', { towerAtk: 3 }),
  // --- economy (new) ---
  loom: T('loom', 'Dokuma Tezgâhı', 'Köylü canı +%40', 0, { food: 50, wood: 30 }, 20, 'eco', '🧶', { vhp: 0.4 }),
  handcart: T('handcart', 'Yük Arabası', 'Köylü hızı +%10, taşıma +5', 2, { gold: 150, stone: 100 }, 40, 'eco', '🛻', { vspeed: 0.1, carry: 5 }),
  irrigation: T('irrigation', 'Sulama Kanalı', 'Tarla verimi +%25', 2, { wood: 150, stone: 100 }, 40, 'eco', '💧', { farm: 0.25 }),
  coinage: T('coinage', 'Sikke Basımı', 'Pazar takas oranı +%15', 2, { gold: 150, stone: 50 }, 35, 'eco', '🪙', { trade: 0.15 }),
  caravan: T('caravan', 'Kervan', 'Ticaret arabası kazancı +%25', 2, { wood: 150, gold: 100 }, 40, 'eco', '🐫', { cart: 0.25 }),
  banking: T('banking', 'Bankacılık', 'Banka geliri +%50', 3, { gold: 300, stone: 150 }, 50, 'eco', '💰', { bank: 0.5 }),
  guilds: T('guilds', 'Loncalar', 'Pazar takas oranı +%15, ticaret arabası kazancı +%25', 3, { gold: 250, stone: 200 }, 50, 'eco', '🤝', { trade: 0.15, cart: 0.25 }),
  steam: T('steam', 'Buhar Gücü', 'Tüm kaynak toplama +%15', 4, { gold: 400, stone: 300 }, 60, 'eco', '🚂', { gather: { food: 0.15, wood: 0.15, stone: 0.15, gold: 0.15 } }),
  assembly: T('assembly', 'Montaj Hattı', 'Fabrika üretimi %50 daha hızlı', 4, { gold: 350, stone: 250 }, 55, 'eco', '⚙️', { factory: 0.5 }),
  // --- military (new) ---
  steel: T('steel', 'Çelik', 'Piyade ve süvari saldırısı +2', 3, { gold: 300, stone: 150 }, 55, 'mil', '⚔️', { atk: { infantry: 2, cavalry: 2 } }),
  bloodlines: T('bloodlines', 'Safkan Atlar', 'Süvari canı +%15', 2, { food: 150, gold: 100 }, 40, 'mil', '🐴', { hp: { cavalry: 0.15 } }),
  formation: T('formation', 'Saf Talimi', 'Piyade canı +%15', 3, { food: 150, gold: 250 }, 50, 'mil', '🪖', { hp: { infantry: 0.15 } }),
  corning: T('corning', 'Tane Barut', 'Menzilli birlik hasarı +%15', 3, { gold: 300, stone: 100 }, 50, 'mil', '🧪', { atkMul: { ranged: 0.15 } }),
  conscription: T('conscription', 'Zorunlu Askerlik', 'Tüm birlik üretimi %20 daha hızlı', 3, { food: 200, gold: 250 }, 55, 'mil', '📜', { train: 0.2 }),
  siegeeng: T('siegeeng', 'Kuşatma Mühendisliği', 'Kuşatma menzili +1', 3, { gold: 300, stone: 200 }, 55, 'mil', '🧮', { range: { siege: 1 } }),
  siegecraft: T('siegecraft', 'Kuşatma Ustalığı', 'Kuşatma silahı canı +%20', 2, { wood: 150, gold: 150 }, 45, 'mil', '🪚', { hp: { siege: 0.2 } }),
  rifling: T('rifling', 'Yivli Namlu', 'Menzilli saldırı +2, menzil +1', 4, { gold: 400, stone: 200 }, 60, 'mil', '🎯', { atk: { ranged: 2 }, range: { ranged: 1 } }),
  explosives: T('explosives', 'Yüksek Patlayıcı', 'Kuşatma saldırısı +%25', 4, { gold: 500, stone: 300 }, 65, 'mil', '🧨', { atkMul: { siege: 0.25 } }),
  // --- defence / support (new) ---
  herbs: T('herbs', 'Şifalı Otlar', 'Tapınak iyileştirmesi +%50', 1, { food: 75, gold: 50 }, 30, 'def', '🌿', { heal: 0.5 }),
  medicine: T('medicine', 'Tıp', 'Tapınak iyileştirmesi +%100', 3, { gold: 250, stone: 100 }, 50, 'def', '⚕️', { heal: 1 }),
  townwatch: T('townwatch', 'Şehir Nöbeti', 'Bina görüş mesafesi +3', 1, { food: 75, stone: 50 }, 30, 'def', '👁️', { blos: 3 }),
  guardtower: T('guardtower', 'Gözcü Kulesi', 'Kule ve kale menzili +1', 2, { stone: 200, gold: 100 }, 45, 'def', '🗼', { towerRange: 1 }),
  garrisonart: T('garrisonart', 'Kale Topçusu', 'Kule ve kale saldırısı +4, menzil +1', 3, { stone: 300, gold: 250 }, 55, 'def', '🏰', { towerAtk: 4, towerRange: 1 }),
  fortify: T('fortify', 'Tahkimat', 'Sur ve kapı dayanıklılığı +%50', 2, { stone: 200, gold: 100 }, 45, 'def', '🏯', { wallhp: 0.5 }),
  // --- naval (researched at the dock) ---
  nets: T('nets', 'Gelişmiş Ağlar', 'Balık toplama +%25', 0, { food: 50, wood: 75 }, 25, 'eco', '🕸️', { gather: { fish: 0.25 } }),
  shipwright: T('shipwright', 'Gemi Yapımcılığı', 'Gemi canı +%20', 1, { wood: 150, gold: 75 }, 35, 'mil', '🪚', { hp: { ship: 0.2 } }),
  gunnery: T('gunnery', 'Deniz Topçuluğu', 'Gemi saldırısı +3, menzil +1', 2, { wood: 150, gold: 150 }, 45, 'mil', '💥', { atk: { ship: 3 }, range: { ship: 1 } }),
  careening: T('careening', 'Karina Bakımı', 'Gemi hızı +%15, zırhı +1', 1, { wood: 100, gold: 50 }, 30, 'mil', '⛵', { speed: { ship: 0.15 }, armor: { ship: 1 } }),
  // --- pasture / railway ---
  breeding: T('breeding', 'Seçici Islah', 'Ağıl verimi +%25', 1, { food: 100, wood: 100 }, 35, 'eco', '🐏', { pasture: 0.25 }),
  steelrails: T('steelrails', 'Çelik Raylar', 'Tren altın kazancı +%30', 4, { gold: 300, stone: 200 }, 55, 'eco', '🛤️', { rail: 0.3 }),
};
