// Aevum - tiny dependency-free static file server (works as CommonJS or ES module).
(async () => {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const zlib = await import('node:zlib');
  const crypto = await import('node:crypto');

  const ROOT = path.dirname(path.resolve(process.argv[1]));
  const PORT = Number(process.env.PORT) || 5173;
  // verified player identity (srv/identity.mjs): Firebase ID token -> relay ticket; TP ledger.
  // AEVUM_NO_AUTH=1 (local tests only): the relay also accepts peers without a ticket and dev identities.
  const { pathToFileURL } = await import('node:url');
  const IDM = await import(pathToFileURL(path.join(ROOT, 'srv', 'identity.mjs')).href);
  const NO_AUTH = /^(1|true|yes)$/i.test(process.env.AEVUM_NO_AUTH || '');
  // AEVUM_TEST_ACCOUNTS=1 (local tests only): aevum-test-*@example.com password accounts are accepted as well
  const TEST_ACCOUNTS = /^(1|true|yes)$/i.test(process.env.AEVUM_TEST_ACCOUNTS || '');
  const KEYS = IDM.keysFromEnv(process.env);
  // AEVUM_SA (a service account key, set in the host's dashboard) keeps the daily statistics and the owners of the
  // profile uids (srv/identity.mjs) in Firestore. (identity.mjs calls the store's claimUid, the method it has)
  const SAM = await import(pathToFileURL(path.join(ROOT, 'srv', 'firestore-sa.mjs')).href);
  const SA = SAM.serviceAccountFromEnv(process.env);
  const SA_STORE = SA ? SAM.createSaStore({ sa: SA, projectId: process.env.AEVUM_FIREBASE_PROJECT || undefined }) : null;
  const ID = IDM.createIdentity({ projectId: process.env.AEVUM_FIREBASE_PROJECT || undefined, keys: KEYS.keys, noAuth: NO_AUTH, testAccounts: TEST_ACCOUNTS, uidStore: SA_STORE, log: (t, e) => logErr(t, e), tpMinMs: process.env.AEVUM_TP_MIN_MS != null ? Number(process.env.AEVUM_TP_MIN_MS) : undefined });
  if (KEYS.source === 'ephemeral') console.warn('AEVUM_SECRET yok: TP kayitlari bu surec kapaninca gecersiz olur (yalnizca yerel test icin uygun).');
  if (KEYS.source === 'service') console.warn('AEVUM_SECRET yok: imza anahtari RENDER_SERVICE_ID ile turetiliyor (gizli degil). AEVUM_SECRET ayarlayin.');
  if (NO_AUTH) console.warn('AEVUM_NO_AUTH: kimlik dogrulamasi KAPALI (yalnizca yerel test).');
  if (TEST_ACCOUNTS) console.warn('AEVUM_TEST_ACCOUNTS: test hesaplari kabul ediliyor (yalnizca yerel test).');
  // player statistics (srv/stats.mjs), shown only to the accounts in AEVUM_OWNERS (comma separated Firebase uids).
  const STM = await import(pathToFileURL(path.join(ROOT, 'srv', 'stats.mjs')).href);
  const OWNERS = new Set(String(process.env.AEVUM_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean));
  const STATS = STM.createStats({
    store: SA_STORE,
    log: (t, e) => logErr(t, e),
  });
  if (!SA) console.warn('AEVUM_SA yok: istatistikler yalnizca bellekte tutulur.');
  // the owner's admin page (/admin, /mp/admin/*, srv/admin.mjs): the @claude lines and the decisions on them, live
  // from Firestore. Without a service account only local tests have one (AEVUM_NO_AUTH: an in-memory store, seeded
  // from the JSON file AEVUM_ADMIN_FAKE names).
  const ADM = await import(pathToFileURL(path.join(ROOT, 'srv', 'admin.mjs')).href);
  let adminStore = SA_STORE;
  if (!adminStore && NO_AUTH) {
    let seed = {};
    try { if (process.env.AEVUM_ADMIN_FAKE) seed = JSON.parse(fs.readFileSync(process.env.AEVUM_ADMIN_FAKE, 'utf8')); } catch (e) { console.warn('AEVUM_ADMIN_FAKE okunamadi: ' + e.message); }
    adminStore = ADM.createMemoryAdminStore(seed);
  }
  const ADMIN = adminStore ? ADM.createAdmin({ store: adminStore }) : null;
  setInterval(() => { STATS.flush().catch(() => {}); }, 3 * 60 * 1000).unref();
  // ---- update notices (owner 2026-11-20: players are told before an update and continue where they left off) ----
  // How a release goes:
  //   1. The owner clicks "Güncelleme Duyur" in the main menu (owner only) -> POST /mp/announce {inSec: 60}.
  //      Every open tab polls GET /mp/notice (every 20 s) and shows a countdown banner. ~15 s before the deadline the
  //      host of every multiplayer match requests a shared lockstep save, single player autosaves, and the tab notes
  //      the interrupted match (main menu: "Kesilen maça devam et" for 30 minutes). src/net/notice.js, src/ui/notice-ui.js
  //   2. The owner waits the 60 s, then pushes. Render builds and starts the new server, then stops this one with
  //      SIGTERM: we set a 'restart' notice, keep serving ~8 s (polling tabs see it), flush the statistics, exit.
  //   3. Tabs see a new `ver` from /mp/notice -> "Yeni sürüm hazır · Yenile". A tab on the old files can neither host
  //      nor join a room with new ones (the build id travels in the lobby hello, src/net/session.js).
  // The notice lives in memory only (a restart forgets it; the new ver tells the tabs what happened).
  const BUILD_VER = buildVersion();
  let notice = null;   // {id, kind: 'update'|'restart', at: ms epoch, msg}
  const drainEnv = Number(process.env.AEVUM_DRAIN_MS);
  const DRAIN_MS = process.env.AEVUM_DRAIN_MS && drainEnv >= 0 ? Math.min(25000, drainEnv) : 8000;
  function buildVersion() {
    // a short hash over what the browser runs (index.html, style.css, src/**), so a server-only change does not make
    // every tab reload; RENDER_GIT_COMMIT is only the fallback when the files cannot be read
    let latest = '0';
    try { const m = /\bv:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src', 'changelog.js'), 'utf8')); if (m) latest = m[1]; } catch { /* ignore */ }
    try {
      const h = crypto.createHash('sha1');
      const files = ['index.html', 'style.css'];
      const walk = (rel) => {
        const list = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const d of list) { const r = rel + '/' + d.name; if (d.isDirectory()) walk(r); else if (d.isFile()) files.push(r); }
      };
      walk('src');
      for (const f of files) { h.update(f + '\0'); h.update(fs.readFileSync(path.join(ROOT, f))); h.update('\0'); }
      return latest + '-' + h.digest('hex').slice(0, 10);
    } catch (e) {
      const c = String(process.env.RENDER_GIT_COMMIT || '').replace(/[^0-9a-f]/gi, '').slice(0, 10);
      return latest + '-' + (c || 't' + Date.now().toString(36));
    }
  }
  function noticeJson() {
    const now = Date.now();
    // an update that was announced but never came is dropped 5 minutes after its time
    if (notice && notice.kind === 'update' && now > notice.at + 5 * 60000) notice = null;
    return JSON.stringify({ ver: BUILD_VER, notice: notice ? { id: notice.id, kind: notice.kind, at: notice.at, in: Math.max(0, notice.at - now), msg: notice.msg } : null });
  }
  // POST /mp/announce is for the game's owner only: the same check as the statistics (a ticket whose account is in AEVUM_OWNERS;
  // with AEVUM_NO_AUTH a dev ticket, e.g. fb 'devowner1' with AEVUM_OWNERS=devowner1)
  const ownerCheck = (me) => (!me ? 401 : OWNERS.has(me.fb) ? 0 : 403);
  // ...or a short token signed with the game's service account key (tools/announce.mjs on the publisher's machine,
  // owner 2026-11-20: "otomatik hale getir"): checked against Google's public certificates of that account
  const AAM = await import(pathToFileURL(path.join(ROOT, 'srv', 'announce-auth.mjs')).href);
  const announceAuth = AAM.createAnnounceAuth({ email: SA && SA.client_email });
  // a deploy or a restart: tell the tabs, keep serving a few seconds, write the last minutes of numbers, then go
  let stopping = false;
  function onStopSignal() {
    if (stopping) { process.exit(0); return; }   // (a second Ctrl+C: right away)
    stopping = true;
    notice = { id: 'r' + Date.now().toString(36), kind: 'restart', at: Date.now() + DRAIN_MS, msg: (notice && notice.msg) || '' };
    let flushed = false, drained = false;
    const end = () => { if (flushed && drained) process.exit(0); };
    STATS.flush().then(() => { flushed = true; end(); }, () => { flushed = true; end(); });
    setTimeout(() => { drained = true; end(); setTimeout(() => process.exit(0), 4000).unref(); }, DRAIN_MS).unref();
  }
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, onStopSignal);
  // (Windows gives a child process no real SIGTERM: test/notice-test.mjs sends it over the IPC channel instead)
  if (NO_AUTH && typeof process.send === 'function') process.on('message', (m) => { if (m === 'SIGTERM') onStopSignal(); });
  // ---- the live site serves only index.html, the favicons and /mp/* (owner 2026-11-22: "render.com'u mümkün olduğunca
  // hafifletelim"): index.html names the deployed commit and the page loads style.css and src/** from jsDelivr at that
  // commit (assets/** at the asset pin, src/cdn.js); this host keeps a copy of everything as the fallback.
  // RENDER_GIT_COMMIT is set by Render; AEVUM_CDN_COMMIT (a pushed commit) tries it locally, with ?cdn=1 in the URL.
  const CODE_SHA = [process.env.AEVUM_CDN_COMMIT, process.env.RENDER_GIT_COMMIT].map((c) => String(c || '').trim().toLowerCase()).find((c) => /^[0-9a-f]{40}$/.test(c)) || '';
  if (CODE_SHA) console.log('Kod jsDelivr uzerinden: ' + CODE_SHA.slice(0, 7));
  const PAGE = path.join(ROOT, 'index.html');
  let pageCache = null;   // {mtime, size, buf, etag, hashes}: index.html as it is served
  function servedPage(st) {
    if (pageCache && pageCache.mtime === st.mtimeMs && pageCache.size === st.size) return pageCache;
    const html = fs.readFileSync(PAGE, 'utf8').replace(/<meta name="aevum-cdn" content="[^"]*">/, '<meta name="aevum-cdn" content="' + CODE_SHA + '">');
    const buf = Buffer.from(html, 'utf8');
    pageCache = { mtime: st.mtimeMs, size: st.size, buf, etag: 'W/"p' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"', hashes: scriptHashes(html) };
    return pageCache;
  }
  const GZ_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.md', '.txt']);
  const gzCache = new Map();   // file -> { etag, buf }: the gzipped copy of a text file, per version
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary',
    '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  };

  // ---- multiplayer relay: in-memory rooms; SSE or long-polling down, POST up ----
  // Every peer is an object { send(obj), end(), sse|poll }; nothing here may throw into the event loop.
  // The relay keeps no game state: after a restart the clients reconnect with the same peer ids and rebuild the rooms.
  const T0 = Date.now();
  const MAX_PEERS = 16, MAX_ROOMS = 1000, MAX_Q = 4000, MAX_SSE_BUF = 2 * 1024 * 1024;
  const MAX_BODY = 65536, BLOB_MAX = 32 * 1024 * 1024,   // (saves of 512 maps)
    BLOB_TTL = 30 * 60 * 1000, BLOB_TOTAL = 96 * 1024 * 1024, BLOB_EMPTY_KEEP = 60 * 1000;
  // abuse limits: open rooms per account, saves being uploaded per account and how long a body may take (a save may
  // pause BLOB_IDLE_MS between chunks and take BLOB_BODY_MS in all, the client's own timeout), relayed messages per
  // connection (a token bucket: lockstep turns + acks + chat stay far below it). The bytes of the saves being uploaded
  // are reserved up front (their Content-Length), so uploads + stored saves never hold more than BLOB_TOTAL in memory.
  const ROOMS_PER_FB = 3, BLOB_UP_PER_FB = 1, BODY_MS = 20000, BLOB_BODY_MS = 60000, BLOB_IDLE_MS = 15000;
  const RL_MSGS = 400, RL_MSGS_S = 100, RL_BYTES = 8 * 1024 * 1024, RL_BYTES_S = 2 * 1024 * 1024, RL_DROP_CLOSE = 2000;
  const J = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const rooms = new Map();      // room -> Map(peer -> peer object)
  const blobs = new Map();      // room -> Map(id -> { buf, t })
  const emptySince = new Map(); // room -> time it became empty (its blobs are kept a little longer)
  const blobUps = new Map();    // account (or room + peer without one) -> saves it is uploading right now
  let blobReserved = 0;         // the Content-Length bytes of all the saves being uploaded right now
  const okName = s => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,48}$/.test(s);
  const alive = res => !!res && !res.destroyed && !res.writableEnded;
  const reply = (res, code, headers, body) => { try { if (!alive(res)) return; if (!res.headersSent) res.writeHead(code, headers); res.end(body); } catch { /* closed */ } };
  const tell = (o, obj) => { try { o.send(obj); } catch (e) { logErr('send', e); } };
  function getRoom(room) { let r = rooms.get(room); if (!r) { r = new Map(); rooms.set(room, r); } emptySince.delete(room); return r; }
  function removePeer(room, peer, obj) {
    const r = rooms.get(room);
    if (!r || r.get(peer) !== obj) return;
    r.delete(peer);
    for (const o of r.values()) tell(o, { type: 'left', peer });
    if (!r.size) { rooms.delete(room); emptySince.set(room, Date.now()); }
  }
  // the public part of a verified identity, as the relay stamps it on messages
  const pub = (id) => (id ? { uid: id.uid, name: id.name, av: id.av, tp: id.tp } : null);
  const kicked = new Map();   // room + ' ' + peer -> time: replaced by a newer connection of the same account
  function addPeer(room, peer, pe, r) {
    const old = r.get(peer);
    if (old) { try { old.end(); } catch { /* ignore */ } }
    // one account = one player: the same account under another peer id (a second tab) replaces the older connection
    // (compared by the verified Firebase id: the profile uid is written by the player himself)
    if (pe.ident) {
      for (const [p, o] of [...r]) {
        if (p === peer || !o.ident || o.ident.fb !== pe.ident.fb) continue;
        kicked.set(room + ' ' + p, Date.now());
        tell(o, { type: 'dup' });
        r.delete(p);
        try { o.dead = true; o.end(); } catch { /* ignore */ }
        for (const q of r.values()) if (q !== pe) tell(q, { type: 'left', peer: p });
      }
    }
    // the first peer of a new room is its host (the room Map is deleted once it is empty, so a new one starts over)
    if (!r.size && !r.host) r.host = peer;
    r.set(peer, pe);
    const ids = {}; for (const [p, o] of r) if (o.ident) ids[p] = pub(o.ident);
    tell(pe, { type: 'hello', peers: [...r.keys()], ids, host: r.host || null });
    if (!old) for (const [p, o] of r) if (p !== peer) tell(o, { type: 'joined', peer, id: pub(pe.ident) });
  }
  setInterval(() => { const t = Date.now(); for (const [k, v] of kicked) if (t - v > 120000) kicked.delete(k); }, 30000).unref();
  // rooms an account is in; a new room (or a room it is not in yet) is refused once it is in ROOMS_PER_FB others
  function roomsOf(fb) { let n = 0; for (const r of rooms.values()) for (const o of r.values()) if (o.ident && o.ident.fb === fb) { n++; break; } return n; }
  function roomRefused(room, peer, ident) {
    const r0 = rooms.get(room);
    if ((!r0 && rooms.size >= MAX_ROOMS) || (r0 && !r0.has(peer) && r0.size >= MAX_PEERS)) return true;
    if (!ident) return false;
    if (r0) for (const o of r0.values()) if (o.ident && o.ident.fb === ident.fb) return false;
    return roomsOf(ident.fb) >= ROOMS_PER_FB;
  }
  // a message of size n from connection pe: false = over its budget (dropped; a connection that keeps on is closed)
  function rateOk(pe, n) {
    if (!pe) return true;
    const t = Date.now();
    if (!pe.rl) pe.rl = { m: RL_MSGS, b: RL_BYTES, t, drops: 0 };
    const rl = pe.rl, dt = Math.max(0, t - rl.t) / 1000;
    rl.t = t;
    rl.m = Math.min(RL_MSGS, rl.m + dt * RL_MSGS_S); rl.b = Math.min(RL_BYTES, rl.b + dt * RL_BYTES_S);
    if (rl.m >= 1 && rl.b >= n) { rl.m -= 1; rl.b -= n; return true; }
    if (++rl.drops === 1 || rl.drops % 500 === 0) console.warn('relay: mesaj siniri asildi (' + rl.drops + ')');
    if (rl.drops >= RL_DROP_CLOSE) { try { pe.dead = true; pe.end(); } catch { /* ignore */ } }
    return false;
  }
  // friends: one inbox per account {q, waiter, seen}; online = a long-poll is open or ended < 40 s ago
  const FB_OK = /^[A-Za-z0-9]{1,128}$/;
  const inboxes = new Map(), inviteRate = new Map();
  function inboxOf(fb) { let b = inboxes.get(fb); if (!b) { b = { q: [], waiter: null, seen: 0 }; inboxes.set(fb, b); } return b; }
  function isOnline(fb) { const b = inboxes.get(fb); return !!b && (!!b.waiter || Date.now() - b.seen < 40000); }
  // puts a message in an account's inbox and wakes its long-poll
  function deliver(to, msg) {
    const box = inboxOf(to);
    box.q.push(msg);
    if (box.q.length > 20) box.q.splice(0, box.q.length - 20);
    if (box.waiter) { const w = box.waiter; box.waiter = null; clearTimeout(w.to); reply(w.res, 200, J, JSON.stringify(box.q.splice(0))); }
  }
  // every signed-in account with the game open (its card comes from its own verified ticket), what it is doing
  function onlinePlayers(exceptFb) {
    const st = STATS.fbStates(), out = [];
    for (const [fb, b] of inboxes) if (fb !== exceptFb && b.card && isOnline(fb)) out.push(Object.assign({ s: st.get(fb) || 'menu' }, b.card));
    return out;
  }
  const inviteAllRate = new Map();   // fb -> time of the last "invite everyone"
  setInterval(() => {
    const t = Date.now();
    for (const [fb, b] of inboxes) if (!b.waiter && t - b.seen > 10 * 60000) inboxes.delete(fb);
    for (const [fb, l] of inviteRate) if (!l.some(x => t - x < 60000)) inviteRate.delete(fb);
  }, 60000).unref();
  // TP: the relay room an account plays in (the one it named, else any) and the verified accounts in it
  function mpRoomOf(fb, want) {
    const w = typeof want === 'string' ? want.toUpperCase() : '';
    let pick = null;
    for (const [name, r] of rooms) {
      let mine = false; for (const o of r.values()) if (o.ident && o.ident.fb === fb) { mine = true; break; }
      if (mine && (!pick || name === w)) pick = name;
    }
    if (!pick) return null;
    const humans = []; for (const o of rooms.get(pick).values()) if (o.ident && !humans.includes(o.ident.fb)) humans.push(o.ident.fb);
    return { room: pick, humans };
  }
  // statistics beats without an account: at most BEAT_VIDS browser ids per address an hour
  // (the address: the CDN's own header (Cloudflare cf-connecting-ip / true-client-ip) first; else the host's proxy
  // appends the caller's address last to X-Forwarded-For, so the last entry is the one to trust; else the socket)
  const BEAT_VIDS = 30, beatIps = new Map();
  function clientIp(req) {
    const one = (h) => String(req.headers[h] || '').split(',')[0].trim().slice(0, 64);
    const cf = one('cf-connecting-ip') || one('true-client-ip');
    if (cf) return cf;
    const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
    return (xf.length ? xf[xf.length - 1] : req.socket && req.socket.remoteAddress) || '?';
  }
  function beatOk(ip, vid) {
    const t = Date.now();
    let e = beatIps.get(ip);
    if (!e || t - e.t > 3600000) { e = { t, v: new Set() }; beatIps.set(ip, e); }
    if (e.v.has(vid)) return true;
    if (e.v.size >= BEAT_VIDS) return false;
    e.v.add(vid); return true;
  }
  setInterval(() => { const t = Date.now(); for (const [ip, e] of beatIps) if (t - e.t > 3600000) beatIps.delete(ip); }, 10 * 60000).unref();
  // the identity of a request: ticket in the X-Aevum-Ticket header or the tk query parameter (EventSource cannot set headers)
  function identOf(req, url) {
    const tk = req.headers['x-aevum-ticket'] || url.searchParams.get('tk') || '';
    const id = tk ? ID.checkTicket(String(tk)) : null;
    if (id && isBanned(id.fb, req)) { noteBannedIp(id.fb, req); return null; }   // (banned: as if it had no ticket)
    return id;
  }
  // ---- bans (owner 2026-11-25, srv/admin.mjs BANS): a banned account gets no relay ticket and no relay access; the
  // addresses it is seen on are refused for IP_BAN_MS too (a new account from the same place). Loaded at start and every
  // 5 minutes; a ban from the admin page applies at once and drops the account's live connections.
  const BANNED = new Map();      // fb -> ban row {fb, name, ips: []}
  const BANNED_IPS = new Map();  // ip -> refused until (ms)
  function banApply(items) {
    BANNED.clear(); BANNED_IPS.clear();
    for (const b of items) {
      BANNED.set(b.fb, b);
      const t0 = Date.parse(b.ipAt || b.at) || Date.now();
      for (const ip of b.ips || []) if (t0 + ADM.IP_BAN_MS > Date.now()) BANNED_IPS.set(ip, t0 + ADM.IP_BAN_MS);
    }
  }
  function banLoad() { if (ADMIN) ADMIN.bans().then((r) => banApply(r.items), (e) => logErr('bans', e)); }
  banLoad(); setInterval(banLoad, 5 * 60000).unref();
  function isBanned(fb, req) {
    if (fb && OWNERS.has(fb)) return false;
    if (fb && BANNED.has(fb)) return true;
    const ip = req ? clientIp(req) : '';
    const until = ip && ip !== '?' ? BANNED_IPS.get(ip) : 0;
    return !!(until && until > Date.now());
  }
  // a banned account seen on a new address: remember it (memory now, the ban doc in the background)
  function noteBannedIp(fb, req) {
    const b = BANNED.get(fb), ip = req ? clientIp(req) : '';
    if (!b || !ip || ip === '?' || (b.ips || []).includes(ip)) return;
    b.ips = [ip, ...(b.ips || [])].slice(0, ADM.IP_MAX);
    BANNED_IPS.set(ip, Date.now() + ADM.IP_BAN_MS);
    if (ADMIN) ADMIN.banIps(fb, [ip], b.ips).catch((e) => logErr('ban ip', e));
  }
  // drops every live relay connection of an account (just banned)
  function kickBanned(fb) {
    for (const [room, r] of [...rooms]) for (const [p, o] of [...r]) {
      if (!o.ident || o.ident.fb !== fb) continue;
      if (o.ip) { const b = BANNED.get(fb); if (b && !(b.ips || []).includes(o.ip)) { b.ips = [o.ip, ...(b.ips || [])].slice(0, ADM.IP_MAX); BANNED_IPS.set(o.ip, Date.now() + ADM.IP_BAN_MS); if (ADMIN) ADMIN.banIps(fb, [o.ip], b.ips).catch((e) => logErr('ban ip', e)); } }
      tell(o, { type: 'err', code: 403, banned: true });
      removePeer(room, p, o);
      try { o.dead = true; o.end(); } catch { /* ignore */ }
    }
  }
  function makeSsePeer(room, peer, res) {
    return {
      sse: true, res,
      send(obj) {
        if (!alive(res)) return;
        if (res.writableLength > MAX_SSE_BUF) { try { res.destroy(); } catch { /* ignore */ } return; } // client stopped reading
        try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch { /* closed */ }
      },
      end() { try { res.end(); } catch { /* ignore */ } },
    };
  }
  function makePollPeer(room, peer) {
    return {
      poll: true, q: [], waiter: null, timer: null, dead: false,
      send(obj) { if (this.dead) return; this.q.push(obj); if (this.q.length > MAX_Q) this.q.splice(0, this.q.length - MAX_Q); this.flush(); },
      end() { this.dead = true; clearTimeout(this.timer); this.answer('[]'); },
      answer(body) { const w = this.waiter; if (!w) return false; this.waiter = null; clearTimeout(w.to); reply(w.res, 200, J, body); return true; },
      flush() { if (this.waiter && this.q.length) { let body; try { body = JSON.stringify(this.q.splice(0)); } catch { body = '[]'; } this.answer(body); this.arm(); } },
      arm() {
        clearTimeout(this.timer);
        if (this.dead) return;
        this.timer = setTimeout(() => {
          if (this.dead) return;
          if (this.waiter) { this.arm(); return; }
          this.dead = true; this.q.length = 0;
          removePeer(room, peer, this);
        }, 10000);
      },
    };
  }
  // reads a request body (at most max bytes, within ms; with idleMs also at most idleMs between two chunks):
  // cb(err 'big'|'slow'|'err'|null, buf)
  function readBody(req, max, cb, ms = BODY_MS, idleMs = 0) {
    const chunks = []; let size = 0, done = false, idle = null;
    const slow = () => { if (done) return; chunks.length = 0; finish('slow'); try { req.destroy(); } catch { /* ignore */ } };
    const to = setTimeout(slow, ms);
    const poke = () => { if (!idleMs) return; clearTimeout(idle); idle = setTimeout(slow, idleMs); };
    const finish = (err, buf) => { if (done) return; done = true; clearTimeout(to); clearTimeout(idle); try { cb(err, buf); } catch (e) { logErr('body cb', e); } };
    poke();
    req.on('data', c => { if (done) return; poke(); size += c.length; if (size > max) { chunks.length = 0; finish('big'); return; } chunks.push(c); });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', () => finish('err'));
    req.on('aborted', () => finish('err'));
  }
  function blobBytes() { let n = 0; for (const m of blobs.values()) for (const b of m.values()) n += b.buf.length; return n; }
  function sweepBlobs(force) {
    const now = Date.now();
    for (const [room, m] of blobs) {
      const es = emptySince.get(room);
      if (!rooms.has(room) && (es == null || now - es > BLOB_EMPTY_KEEP)) { blobs.delete(room); continue; }
      for (const [id, b] of m) if (now - b.t > BLOB_TTL) m.delete(id);
      if (!m.size) blobs.delete(room);
    }
    for (const [room, t] of emptySince) if (now - t > BLOB_EMPTY_KEEP * 2) emptySince.delete(room);
    while (force && blobBytes() > BLOB_TOTAL) { // evict the oldest blob
      let old = null; for (const [room, m] of blobs) for (const [id, b] of m) if (!old || b.t < old.b.t) old = { room, id, b };
      if (!old) break; blobs.get(old.room).delete(old.id);
    }
  }
  setInterval(() => { try { sweepBlobs(false); } catch (e) { logErr('sweep', e); } }, 30000).unref();

  // ---- WebSocket peers (GET /mp/ws upgrade): one socket both ways, so a turn packet costs one hop, not a POST
  // plus a long-poll round trip. Minimal RFC 6455 (text frames, ping/pong, close); no dependencies.
  const WS_MAX = 65536;
  function wsFrame(op, payload) {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    return Buffer.concat([head, payload]);
  }
  function wsAccept(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return false; }
    const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    socket.setNoDelay(true);
    return true;
  }
  // reads client frames; onText(string) per complete message; onEnd() once
  function wsReader(socket, onText, onEnd) {
    let buf = Buffer.alloc(0), frag = [], fragLen = 0, ended = false;
    const end = () => { if (ended) return; ended = true; try { onEnd(); } catch (e) { logErr('ws end', e); } };
    socket.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= 2) {
        const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(WS_MAX)) { socket.destroy(); return; } len = Number(big); off = 10; }
        if (len > WS_MAX || !masked) { socket.destroy(); return; }   // (clients must mask)
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
        buf = buf.subarray(off + 4 + len);
        if (op === 8) { try { socket.end(wsFrame(8, Buffer.alloc(0))); } catch { /* ignore */ } end(); return; }
        if (op === 9) { try { socket.write(wsFrame(10, data)); } catch { /* ignore */ } continue; }
        if (op === 10) continue;
        if (op === 1 || op === 2 || op === 0) {
          frag.push(data); fragLen += len;
          if (fragLen > WS_MAX) { socket.destroy(); return; }
          if (fin) { const msg = Buffer.concat(frag).toString('utf8'); frag = []; fragLen = 0; try { onText(msg); } catch (e) { logErr('ws msg', e); } }
        }
      }
    });
    socket.on('close', end); socket.on('end', end); socket.on('error', end);
  }
  function makeWsPeer(socket) {
    return {
      ws: true, socket, dead: false,
      sendRaw(buf) {
        if (this.dead || socket.destroyed) return;
        if (socket.writableLength > MAX_SSE_BUF) { try { socket.destroy(); } catch { /* ignore */ } return; }   // client stopped reading
        try { socket.write(buf); } catch { /* closed */ }
      },
      send(obj) {
        if (this.dead || socket.destroyed) return;
        this.sendRaw(wsFrame(1, Buffer.from(JSON.stringify(obj))));
      },
      end() { this.dead = true; try { socket.end(wsFrame(8, Buffer.alloc(0))); } catch { /* ignore */ } setTimeout(() => { try { socket.destroy(); } catch { /* ignore */ } }, 1000).unref(); },
    };
  }
  // ---- public room list (GET /mp/rooms): the relay reads its host's lobby broadcasts (src/net/session.js, every 2 s)
  // and keeps a small card of each room still in its lobby. A room is not listed once its host started the match, for a
  // continued match or an invite-only room, when its card is older than ROOM_CARD_MS, the host left, or it is full.
  const LOBBY_MAX = 8, ROOM_CARD_MS = 15000, ROOMS_LISTED = 50;   // (LOBBY_MAX = MAX_PLAYERS of src/net/session.js)
  function noteLobby(r, d, sender) {
    if (!d || typeof d !== 'object') return;
    if (d.k === 'start') { r.started = true; r.lobby = null; return; }
    if (d.k !== 'state' || r.started) return;
    const st = d.state;
    if (!st || typeof st !== 'object' || !Array.isArray(st.slots) || !st.settings || typeof st.settings !== 'object') return;
    if (st.listed === false || st.resume) { r.lobby = null; return; }
    const set = st.settings, hs = st.slots.find(s => s && s.kind === 'human' && s.peer === r.host);
    const id = sender && sender.ident;
    r.lobby = {
      host: String((id && id.name) || (hs && hs.name) || 'Oyuncu').slice(0, 20),
      uid: id ? id.uid : null, av: id ? id.av : null, tp: id ? id.tp | 0 : 0,
      n: st.slots.filter(s => s && s.kind === 'human').length, slots: Math.min(st.slots.length, 99),
      map: typeof set.mapType === 'string' && /^[a-z_-]{1,20}$/.test(set.mapType) ? set.mapType : null,
      size: Number.isInteger(set.mapSize) && set.mapSize > 0 && set.mapSize <= 4096 ? set.mapSize : null,
      t0: (r.lobby && r.lobby.t0) || Date.now(), t: Date.now(),
    };
  }
  function openRooms() {
    const now = Date.now(), out = [];
    for (const [code, r] of rooms) {
      const l = r.lobby;
      if (!l || r.started || now - l.t > ROOM_CARD_MS || l.slots >= LOBBY_MAX || !/^[A-Z0-9]{5}$/.test(code)) continue;
      const h = r.get(r.host); if (!h || h.dead) continue;
      out.push({ code, host: l.host, uid: l.uid, av: l.av, tp: l.tp, n: l.n, slots: l.slots, max: LOBBY_MAX, map: l.map, size: l.size, t0: l.t0 });
    }
    out.sort((a, b) => (b.n - a.n) || (b.t0 - a.t0));
    return out.slice(0, ROOMS_LISTED).map(({ t0, ...o }) => o);
  }
  // relays one {topic, data} message of `peer` to the rest of its room (shared by POST /mp/send and WebSocket)
  function relay(room, peer, m, n) {
    const r = rooms.get(room);
    if (!r || !m || typeof m.topic !== 'string' || m.topic.length > 32) return;
    const sender = r.get(peer);
    if (!sender && !NO_AUTH) return;   // (only a peer that is in the room may post; its verified identity travels with the message)
    if (sender && sender.dead) return;
    if (n != null && !rateOk(sender, n)) { if (sender && sender.dead) removePeer(room, peer, sender); return; }
    if (m.topic === 'lobby' && peer === r.host) noteLobby(r, m.data, sender);
    // hot match topics (turn/sync/flare) do not need verified identity repeated on every packet (sent on hello/joined/lobby/chat)
    const hot = m.topic === 'turn' || m.topic === 'sync' || m.topic === 'flare';
    const msg = hot ? { type: 'msg', topic: m.topic, data: m.data, from: peer } : { type: 'msg', topic: m.topic, data: m.data, from: peer, id: pub(sender && sender.ident) };
    let wsBuf = null;
    for (const [p, o] of r) {
      if (p === peer) continue;
      if (o.ws) {
        if (!wsBuf) wsBuf = wsFrame(1, Buffer.from(JSON.stringify(msg)));
        try { o.sendRaw(wsBuf); } catch (e) { logErr('send', e); }
      } else {
        tell(o, msg);
      }
    }
  }
  function handleUpgrade(req, socket) {
    let url; try { url = new URL(req.url || '', 'http://x'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/mp/ws') { socket.destroy(); return; }
    if (!wsAccept(req, socket)) return;
    const say = (obj) => { try { socket.write(wsFrame(1, Buffer.from(JSON.stringify(obj)))); } catch { /* ignore */ } };
    const bye = (obj) => { say(obj); try { socket.end(wsFrame(8, Buffer.alloc(0))); } catch { /* ignore */ } };
    // a probe: the client checks that WebSockets pass (proxies / tunnels) before it picks this transport
    if (url.searchParams.has('probe')) { bye({ type: 'probe' }); return; }
    const room = (url.searchParams.get('room') || '').toUpperCase(), peer = url.searchParams.get('peer') || '';
    if (!okName(room) || !okName(peer)) { bye({ type: 'err', code: 400 }); return; }
    const ident = identOf(req, url);
    if (!ident && !NO_AUTH) { bye({ type: 'err', code: 401 }); return; }
    if (kicked.has(room + ' ' + peer)) { bye({ type: 'dup' }); return; }
    const known = rooms.get(room) && rooms.get(room).get(peer);
    if (known && known.ident && (!ident || ident.fb !== known.ident.fb)) { bye({ type: 'err', code: 403 }); return; }
    if (roomRefused(room, peer, ident)) { bye({ type: 'err', code: 429 }); return; }
    const pe = makeWsPeer(socket);
    pe.ident = ident;
    pe.ip = clientIp(req);
    addPeer(room, peer, pe, getRoom(room));
    const hb = setInterval(() => pe.send({ type: 'hb' }), 15000);
    wsReader(socket, (text) => {
      if (pe.dead) return;
      if (!rateOk(pe, text.length)) return;
      let m; try { m = JSON.parse(text); } catch { return; }
      if (m && m.type === 'ping') { pe.send({ type: 'pong', t: m.t }); return; }
      relay(room, peer, m);
    }, () => { clearInterval(hb); pe.dead = true; removePeer(room, peer, pe); });
  }

  // GET /mp/admin/feedback, POST /mp/admin/feedback {id, status?, note?}, GET /mp/admin/stats (see srv/admin.mjs)
  const adminWrites = new Map();   // fb -> times of its recent writes (at most 120 a minute)
  function handleAdmin(req, res, url) {
    const tk = req.headers['x-aevum-ticket'];
    const code = ownerCheck(tk ? ID.checkTicket(String(tk)) : null);
    if (code) { req.resume(); reply(res, code, J, code === 401 ? '{"error":"ticket"}' : '{"error":"owner"}'); return; }
    const me = ID.checkTicket(String(tk));
    const fail = (e, tag) => { logErr('admin ' + tag, e); reply(res, 503, J, '{"error":"Veriler şu an okunamadı."}'); };
    if (url.pathname === '/mp/admin/stats' && req.method === 'GET') {
      let peers = 0; for (const r of rooms.values()) peers += r.size;
      const live = { rooms: rooms.size, peers, ver: BUILD_VER, uptime: Math.round(process.uptime()) };
      Promise.all([STATS.report(30), ADMIN ? ADMIN.accounts().catch((e) => { logErr('admin accounts', e); return null; }) : null]).then(([r, accounts]) => {
        reply(res, 200, J, JSON.stringify({ accounts, live, online: r.online, daily: r.days, persisted: r.persisted }));
      }, (e) => fail(e, 'stats'));
      return;
    }
    // one screenshot of a @claude line, only when the owner asks for it (one Firestore read)
    if (url.pathname === '/mp/admin/shot' && req.method === 'GET') {
      if (!ADMIN) { reply(res, 503, J, '{"error":"Veri deposu yok (AEVUM_SA)."}'); return; }
      ADMIN.shot(String(url.searchParams.get('id') || '')).then((img) => (img ? reply(res, 200, J, JSON.stringify({ img })) : reply(res, 404, J, '{"error":"Görüntü yok."}')), (e) => fail(e, 'shot'));
      return;
    }
    // Fikirler: GET /mp/admin/ideas (one list query), POST /mp/admin/ideas {op: add|update|delete, ...} (srv/admin.mjs)
    // Banlar: GET /mp/admin/bans, POST /mp/admin/bans {op: ban, name|fb, reason} | {op: unban, fb} (srv/admin.mjs)
    if (url.pathname === '/mp/admin/bans') {
      if (!ADMIN) { req.resume(); reply(res, 503, J, '{"error":"Veri deposu yok (AEVUM_SA)."}'); return; }
      if (req.method === 'GET') { ADMIN.bans().then((r) => { banApply(r.items); reply(res, 200, J, JSON.stringify(r)); }, (e) => fail(e, 'bans')); return; }
      if (req.method !== 'POST') { req.resume(); reply(res, 405, J, '{"error":"method"}'); return; }
      readBody(req, 4096, (err, buf) => {
        if (err) { reply(res, err === 'big' ? 413 : 400, J, '{"error":"bad body"}'); return; }
        let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { reply(res, 400, J, '{"error":"bad json"}'); return; }
        const d = ADM.cleanBan(body);
        if (d.error) { reply(res, 400, J, JSON.stringify({ error: d.error })); return; }
        if (d.fb && OWNERS.has(d.fb)) { reply(res, 400, J, '{"error":"Kendini banlayamazsın."}'); return; }
        ADMIN.ban(d).then((r) => {
          if (r.unbanned) { const b = BANNED.get(r.fb); BANNED.delete(r.fb); for (const ip of (b && b.ips) || []) BANNED_IPS.delete(ip); }
          else if (r.edited) { const b = BANNED.get(r.fb); if (b) b.reason = r.reason; }
          else if (OWNERS.has(r.fb)) { ADMIN.ban({ op: 'unban', fb: r.fb }).catch(() => {}); reply(res, 400, J, '{"error":"Kendini banlayamazsın."}'); return; }
          else { BANNED.set(r.fb, Object.assign({ ips: [] }, r)); kickBanned(r.fb); }
          reply(res, 200, J, JSON.stringify(Object.assign({ ok: true }, r)));
        }, (e) => { if (e && e.status === 404) reply(res, 404, J, JSON.stringify({ error: e.message })); else fail(e, 'ban'); });
      }, 5000);
      return;
    }
    if (url.pathname === '/mp/admin/ideas') {
      if (!ADMIN) { req.resume(); reply(res, 503, J, '{"error":"Veri deposu yok (AEVUM_SA)."}'); return; }
      if (req.method === 'GET') { ADMIN.ideas().then((r) => reply(res, 200, J, JSON.stringify(r)), (e) => fail(e, 'ideas')); return; }
      if (req.method !== 'POST') { req.resume(); reply(res, 405, J, '{"error":"method"}'); return; }
      readBody(req, 16384, (err, buf) => {
        if (err) { reply(res, err === 'big' ? 413 : 400, J, '{"error":"bad body"}'); return; }
        let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { reply(res, 400, J, '{"error":"bad json"}'); return; }
        const d = ADM.cleanIdea(body);
        if (d.error) { reply(res, 400, J, JSON.stringify({ error: d.error })); return; }
        const now = Date.now(), recent = (adminWrites.get(me.fb) || []).filter((t) => now - t < 60000);
        if (recent.length >= 120) { reply(res, 429, J, '{"error":"Çok hızlı; biraz bekle."}'); return; }
        recent.push(now); adminWrites.set(me.fb, recent);
        ADMIN.idea(d).then((r) => reply(res, 200, J, JSON.stringify(Object.assign({ ok: true }, r))), (e) => fail(e, 'idea'));
      }, 5000);
      return;
    }
    if (url.pathname !== '/mp/admin/feedback') { req.resume(); reply(res, 404, J, '{"error":"not found"}'); return; }
    if (!ADMIN) { req.resume(); reply(res, 503, J, '{"error":"Veri deposu yok (AEVUM_SA)."}'); return; }
    if (req.method === 'GET') { ADMIN.feedback({ fresh: url.searchParams.get('fresh') === '1' }).then((r) => reply(res, 200, J, JSON.stringify(r)), (e) => fail(e, 'feedback')); return; }
    if (req.method !== 'POST') { req.resume(); reply(res, 405, J, '{"error":"method"}'); return; }
    readBody(req, 4096, (err, buf) => {
      if (err) { reply(res, err === 'big' ? 413 : 400, J, '{"error":"bad body"}'); return; }
      let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { reply(res, 400, J, '{"error":"bad json"}'); return; }
      const d = ADM.cleanDecision(body);
      if (d.error) { reply(res, 400, J, JSON.stringify({ error: d.error })); return; }
      const now = Date.now(), recent = (adminWrites.get(me.fb) || []).filter((t) => now - t < 60000);
      if (recent.length >= 120) { reply(res, 429, J, '{"error":"Çok hızlı; biraz bekle."}'); return; }
      recent.push(now); adminWrites.set(me.fb, recent);
      ADMIN.decide(d).then((r) => reply(res, 200, J, JSON.stringify(Object.assign({ ok: true }, r))), (e) => fail(e, 'decide'));
    }, 5000);
  }
  // the admin page itself (GET /admin): public HTML that holds no data; it signs in with the game's stored session
  // (same origin) and reads everything from /mp/admin/*. Firebase's web API key (public, src/cloud/config.js) goes in.
  let adminPage = null;   // {buf, etag, csp}
  function servedAdminPage() {
    if (adminPage) return adminPage;
    let key = '';
    try { const m = /apiKey:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src', 'cloud', 'config.js'), 'utf8')); if (m) key = m[1]; } catch { /* no key: the page says it cannot sign in */ }
    const html = fs.readFileSync(path.join(ROOT, 'srv', 'admin-page.html'), 'utf8').replace('__API_KEY__', key.replace(/[^A-Za-z0-9_-]/g, ''));
    const buf = Buffer.from(html, 'utf8');
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map((m) => "'sha256-" + crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64') + "'").join(' ');
    const csp = ["default-src 'none'", 'script-src ' + scriptHashes(html), 'style-src ' + styles, "img-src 'self' data:", "connect-src 'self' https://securetoken.googleapis.com", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
    adminPage = { buf, etag: 'W/"a' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"', csp };
    return adminPage;
  }
  function serveAdmin(req, res) {
    let p; try { p = servedAdminPage(); } catch (e) { logErr('admin page', e); res.writeHead(500); res.end(); return; }
    const head = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: p.etag, 'Content-Security-Policy': p.csp, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
    if (String(req.headers['if-none-match'] || '') === p.etag) { res.writeHead(304, head); res.end(); return; }
    head['Content-Length'] = p.buf.length;
    res.writeHead(200, head);
    res.end(req.method === 'HEAD' ? undefined : p.buf);
  }

  function handleMp(req, res, url) {
    const room = (url.searchParams.get('room') || '').toUpperCase(), peer = url.searchParams.get('peer') || '';
    if (url.pathname === '/mp/ping') { reply(res, 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, 'aevum-mp'); return; }
    // ---- update notice (see the comment at BUILD_VER): every tab asks every 20 s; tiny on purpose ----
    if (url.pathname === '/mp/notice' && (req.method === 'GET' || req.method === 'HEAD')) { reply(res, 200, J, req.method === 'HEAD' ? undefined : noticeJson()); return; }
    if (url.pathname === '/mp/announce' && (req.method === 'POST' || req.method === 'DELETE')) {
      readBody(req, 4096, async (err, buf) => {
        if (err) { reply(res, 400, J, '{"error":"bad body"}'); return; }
        const bearer = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ''));
        let body = {}, signed = null;
        if (bearer) {
          try { signed = await announceAuth.verify(bearer[1]); } catch { signed = null; }
          if (!signed) { reply(res, 403, J, '{"error":"signature"}'); return; }
          body = signed;   // (the signed values, never the unsigned request body)
        } else {
          const code = ownerCheck(identOf(req, url));
          if (code) { reply(res, code, J, code === 401 ? '{"error":"ticket"}' : '{"error":"owner"}'); return; }
          if (req.method === 'POST') { try { body = JSON.parse(buf.toString('utf8') || '{}') || {}; } catch { reply(res, 400, J, '{"error":"bad json"}'); return; } }
          if (typeof body !== 'object') { reply(res, 400, J, '{"error":"bad json"}'); return; }
        }
        if (req.method === 'DELETE' || body.cancel === true) {
          if (notice && notice.kind === 'update') notice = null;   // (a restart that is under way cannot be called off)
          reply(res, 200, J, noticeJson()); return;
        }
        if (stopping) { reply(res, 409, J, '{"error":"Sunucu zaten yeniden başlıyor."}'); return; }
        const n = Number(body.inSec), inSec = Number.isFinite(n) ? Math.max(10, Math.min(600, Math.round(n))) : 60;
        const msg = typeof body.msg === 'string' ? body.msg.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) : '';
        notice = { id: 'u' + Date.now().toString(36), kind: 'update', at: Date.now() + inSec * 1000, msg };
        console.log('Guncelleme duyurusu: ' + inSec + ' sn sonra');
        reply(res, 200, J, noticeJson());
      });
      return;
    }
    if (url.pathname === '/mp/health') {
      let peers = 0; for (const r of rooms.values()) peers += r.size;
      let nb = 0; for (const m of blobs.values()) nb += m.size;
      reply(res, 200, J, JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), since: new Date(T0).toISOString(), rooms: rooms.size, peers, blobs: nb, blobBytes: blobBytes(), rssMB: Math.round(process.memoryUsage().rss / 1048576), pid: process.pid, auth: NO_AUTH ? 'off' : 'on', ver: BUILD_VER }));
      return;
    }
    // ---- statistics: a beat from every open game tab (a random browser id, what it is doing), the owner's report ----
    if (url.pathname === '/mp/beat') {
      const me = identOf(req, url);
      // a beat without an account counts only for a few browser ids per address (or anyone could invent visitors)
      if (me || beatOk(clientIp(req), url.searchParams.get('v') || '')) STATS.beat(url.searchParams.get('v') || '', url.searchParams.get('s') || '', me ? me.fb : null);
      reply(res, 204, { 'Cache-Control': 'no-store' });
      return;
    }
    if (url.pathname === '/mp/stats' && req.method === 'GET') {
      const me = identOf(req, url);
      if (!me) { reply(res, 401, J, '{"error":"ticket"}'); return; }
      if (!OWNERS.has(me.fb)) { reply(res, 403, J, '{"error":"owner"}'); return; }
      STATS.report(30).then(r => reply(res, 200, J, JSON.stringify(r)), e => { logErr('stats', e); reply(res, 500, J, '{"error":"stats"}'); });
      return;
    }
    // ---- the owner's admin page data: owner only, the ticket in the X-Aevum-Ticket header only (never the query or a
    // cookie, so another site cannot make a browser call these) ----
    if (url.pathname.startsWith('/mp/admin/')) { handleAdmin(req, res, url); return; }
    // ---- friends: online status + room invites (an inbox per verified account; memory only) ----
    if (url.pathname === '/mp/inbox' && req.method === 'GET') {
      const me = identOf(req, url);
      if (!me) { reply(res, 401, J, '{"error":"ticket"}'); return; }
      const box = inboxOf(me.fb);
      box.seen = Date.now();
      box.card = { fb: me.fb, uid: me.uid, name: me.name, av: me.av, tp: me.tp | 0 };
      if (box.waiter) { const w = box.waiter; box.waiter = null; clearTimeout(w.to); reply(w.res, 200, J, '[]'); }
      if (box.q.length) { reply(res, 200, J, JSON.stringify(box.q.splice(0))); return; }
      const w = { res, to: setTimeout(() => { if (box.waiter === w) { box.waiter = null; box.seen = Date.now(); reply(res, 200, J, '[]'); } }, 25000) };
      box.waiter = w;
      res.on('close', () => { if (box.waiter === w) { box.waiter = null; clearTimeout(w.to); box.seen = Date.now(); } });
      return;
    }
    if ((url.pathname === '/mp/invite' || url.pathname === '/mp/online') && req.method === 'POST') {
      readBody(req, 8192, (err, buf) => {
        if (err) { reply(res, 400, J, '{"error":"bad body"}'); return; }
        const me = identOf(req, url);
        if (!me) { reply(res, 401, J, '{"error":"ticket"}'); return; }
        let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { reply(res, 400, J, '{"error":"bad json"}'); return; }
        if (!body || typeof body !== 'object') { reply(res, 400, J, '{"error":"bad json"}'); return; }
        if (url.pathname === '/mp/online') {
          const fbs = Array.isArray(body.fbs) ? body.fbs.filter(f => typeof f === 'string' && FB_OK.test(f)).slice(0, 200) : [];
          inboxOf(me.fb).seen = Date.now();
          reply(res, 200, J, JSON.stringify({ online: fbs.filter(isOnline) }));
          return;
        }
        const to = String(body.to || ''), code = String(body.code || '').toUpperCase();
        if (!FB_OK.test(to) || !/^[A-Z0-9]{5}$/.test(code) || to === me.fb) { reply(res, 400, J, '{"error":"bad invite"}'); return; }
        // at most 20 invites a minute per account
        const now = Date.now(), rl = inviteRate.get(me.fb) || [];
        const recent = rl.filter(t => now - t < 60000);
        if (recent.length >= 20) { reply(res, 429, J, '{"error":"Çok fazla davet; biraz bekle."}'); return; }
        recent.push(now); inviteRate.set(me.fb, recent);
        const online = isOnline(to);
        if (online) deliver(to, { type: 'invite', code, from: { fb: me.fb, uid: me.uid, name: me.name, av: me.av, tp: me.tp }, t: now });
        reply(res, 200, J, JSON.stringify({ online }));
      });
      return;
    }
    // ---- everyone online: the list of the multiplayer screen, and "invite everyone" ----
    if (url.pathname === '/mp/players' && req.method === 'GET') {
      const me = identOf(req, url);
      if (!me) { reply(res, 401, J, '{"error":"ticket"}'); return; }
      inboxOf(me.fb).seen = Date.now();
      const order = { menu: 0, sp: 1, mp: 2 };
      const list = onlinePlayers(me.fb).sort((a, b) => (order[a.s] - order[b.s]) || String(a.name).localeCompare(String(b.name), 'tr'));
      reply(res, 200, J, JSON.stringify({ total: list.length, players: list.slice(0, 200) }));
      return;
    }
    // ---- the open rooms (still in their lobby, joinable) for the multiplayer screen's room list ----
    if (url.pathname === '/mp/rooms' && req.method === 'GET') {
      const me = identOf(req, url);
      if (!me) { reply(res, 401, J, '{"error":"ticket"}'); return; }
      const list = openRooms();
      reply(res, 200, J, JSON.stringify({ total: list.length, rooms: list }));
      return;
    }
    if (url.pathname === '/mp/invite-all' && req.method === 'POST') {
      readBody(req, 16384, (err, buf) => {
        if (err) { reply(res, 400, J, '{"error":"bad body"}'); return; }
        const me = identOf(req, url);
        if (!me) { reply(res, 401, J, '{"error":"ticket"}'); return; }
        let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { reply(res, 400, J, '{"error":"bad json"}'); return; }
        if (!body || typeof body !== 'object') { reply(res, 400, J, '{"error":"bad json"}'); return; }
        const code = String(body.code || '').toUpperCase();
        if (!/^[A-Z0-9]{5}$/.test(code)) { reply(res, 400, J, '{"error":"bad invite"}'); return; }
        // once every 2 minutes per account (everyone gets a card, so it must not become spam)
        const now = Date.now(), last = inviteAllRate.get(me.fb) || 0;
        if (now - last < 120000) { reply(res, 429, J, JSON.stringify({ error: 'Herkesi davet etmek için ' + Math.ceil((120000 - (now - last)) / 1000) + ' sn bekle.' })); return; }
        inviteAllRate.set(me.fb, now);
        const skip = new Set(Array.isArray(body.skip) ? body.skip.filter(f => typeof f === 'string').slice(0, 50) : []);
        // (players already in a match are left alone; they can still be invited one by one)
        const to = onlinePlayers(me.fb).filter(p => p.s === 'menu' && !skip.has(p.fb));
        const msg = { type: 'invite', code, from: { fb: me.fb, uid: me.uid, name: me.name, av: me.av, tp: me.tp }, t: now };
        for (const p of to) deliver(p.fb, msg);
        reply(res, 200, J, JSON.stringify({ sent: to.length }));
      });
      return;
    }
    // ---- identity: Firebase ID token -> relay ticket; TP match tickets and ledger ----
    if (url.pathname.startsWith('/mp/auth') || url.pathname.startsWith('/mp/tp/')) {
      if (req.method !== 'POST') { reply(res, 405, {}, ''); return; }
      readBody(req, 32768, (err, buf) => {
        if (err) { reply(res, 400, J, '{"error":"bad body"}'); return; }
        let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { reply(res, 400, J, '{"error":"bad json"}'); return; }
        if (!body || typeof body !== 'object') { reply(res, 400, J, '{"error":"bad json"}'); return; }
        const fail = (code, msg) => reply(res, code, J, JSON.stringify({ error: msg }));
        if (url.pathname === '/mp/auth') {
          ID.auth(body).then((r) => {
            if (isBanned(r.ident.fb, req)) { noteBannedIp(r.ident.fb, req); fail(403, 'Bu hesap oyundan uzaklaştırıldı.'); return; }
            reply(res, 200, J, JSON.stringify(Object.assign(r, OWNERS.has(r.ident.fb) ? { owner: true } : {})));
          }, (e) => {
            if (e instanceof IDM.IdentityError) { fail(e.status, e.message); return; }
            logErr('auth', e); fail(503, 'Kimlik şu an doğrulanamadı.');
          });
          return;
        }
        const me = identOf(req, url);
        if (!me) { fail(401, 'Bilet geçersiz.'); return; }
        try {
          if (url.pathname === '/mp/tp/start') { reply(res, 200, J, JSON.stringify(ID.matchStart(me, body, body.mode === 'mp' ? mpRoomOf(me.fb, body.room) : null))); STATS.match(body.mode === 'mp' ? 'mp' : 'sp', typeof body.room === 'string' ? body.room.slice(0, 16) : null, me.fb); }
          else if (url.pathname === '/mp/tp/claim') {
            // a credited match: the new TP comes with a new relay ticket (the client needs no /mp/auth, 3-4 reads)
            const r = ID.matchClaim(me, body);
            if (r && r.ok && r.gained) Object.assign(r, ID.reticket(me, r.tp));
            reply(res, 200, J, JSON.stringify(r));
          }
          else if (url.pathname === '/mp/tp/info') reply(res, 200, J, JSON.stringify(ID.ledgerInfo(me, body.ledger)));
          else reply(res, 404, {}, '');
        } catch (e) { logErr('tp', e); fail(500, 'Sunucu hatası.'); }
      });
      return;
    }
    if (url.pathname === '/mp/events' && req.method === 'GET' && url.searchParams.has('probe')) {
      if (res.socket) res.socket.setNoDelay(true);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      try { res.end('data: {"type":"probe"}\n\n'); } catch { /* ignore */ }
      return;
    }
    if (!okName(room) || !okName(peer)) { reply(res, 400, {}, 'bad room/peer'); return; }
    const ident = identOf(req, url);
    if (!ident && !NO_AUTH) { reply(res, 401, J, '{"error":"ticket"}'); return; }
    if (kicked.has(room + ' ' + peer)) { reply(res, 409, J, '{"error":"dup"}'); return; }
    // a peer id belongs to the identity that registered it
    const known = rooms.get(room) && rooms.get(room).get(peer);
    if (known && known.ident && (!ident || ident.fb !== known.ident.fb)) { reply(res, 403, J, '{"error":"peer"}'); return; }
    if (url.pathname === '/mp/events' && req.method === 'GET') {
      if (roomRefused(room, peer, ident)) { reply(res, 429, {}, 'full'); return; }
      if (res.socket) res.socket.setNoDelay(true);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      try { res.write('retry: 1500\n\n'); } catch { /* ignore */ }
      const pe = makeSsePeer(room, peer, res);
      pe.ident = ident;
      addPeer(room, peer, pe, getRoom(room));
      // a data heartbeat (not a comment) so the client can notice a silently dead stream
      const hb = setInterval(() => pe.send({ type: 'hb' }), 15000);
      res.on('close', () => { clearInterval(hb); removePeer(room, peer, pe); });
      return;
    }
    if (url.pathname === '/mp/poll' && req.method === 'GET') {
      // long-polling peer (for tunnels/proxies that do not pass SSE); shares rooms with SSE peers
      let r = rooms.get(room);
      let pe = r && r.get(peer);
      if (!pe || !pe.poll || pe.dead) {
        if (roomRefused(room, peer, ident)) { reply(res, 429, {}, 'full'); return; }
        r = getRoom(room);
        pe = makePollPeer(room, peer);
        pe.ident = ident;
        addPeer(room, peer, pe, r);
      }
      pe.answer('[]');                      // an older waiting request of the same peer
      clearTimeout(pe.timer);
      if (pe.q.length) { pe.waiter = { res, to: null }; pe.flush(); return; }
      const w = { res, to: setTimeout(() => { if (pe.waiter === w) { pe.answer('[]'); pe.arm(); } }, 20000) };
      pe.waiter = w;
      res.on('close', () => { if (pe.waiter === w) { pe.waiter = null; clearTimeout(w.to); pe.arm(); } });
      return;
    }
    if (url.pathname === '/mp/send' && req.method === 'POST') {
      readBody(req, MAX_BODY, (err, buf) => {
        if (err) { reply(res, err === 'big' ? 413 : 400, { Connection: 'close' }, ''); return; }
        let m; try { m = JSON.parse(buf.toString('utf8')); } catch { reply(res, 400, {}, 'bad json'); return; }
        relay(room, peer, m, buf.length);
        reply(res, 204, { 'Cache-Control': 'no-store' });
      });
      return;
    }
    if (url.pathname === '/mp/blob' && req.method === 'POST') {
      // a saved match handed from the host to the other players (in memory, per room, 30 min)
      // only a peer in the room may upload (its identity is checked above), or anyone could push out a room's save;
      // one upload per account; its Content-Length is required and reserved while it runs (see BLOB_TOTAL)
      if (!known) { reply(res, 403, J, '{"error":"peer"}'); return; }
      const upKey = ident ? ident.fb : 'peer ' + room + ' ' + peer;
      const clen = String(req.headers['content-length'] || '');
      if (!/^\d{1,12}$/.test(clen)) { reply(res, 411, { Connection: 'close' }, 'length required'); return; }
      const want = Number(clen);
      if (want > BLOB_MAX) { reply(res, 413, { Connection: 'close' }, 'too big'); return; }
      if ((blobUps.get(upKey) | 0) >= BLOB_UP_PER_FB || blobReserved + want > BLOB_TOTAL) { reply(res, 429, { Connection: 'close' }, 'busy'); return; }
      /* stored saves make room for a new upload: the oldest go first (only uploads in flight can refuse one) */
      while (blobReserved + want + blobBytes() > BLOB_TOTAL) {
        let old = null; for (const [rm, m] of blobs) for (const [id, b] of m) if (!old || b.t < old.b.t) old = { rm, id, b };
        if (!old) break; blobs.get(old.rm).delete(old.id); if (!blobs.get(old.rm).size) blobs.delete(old.rm);
      }
      blobUps.set(upKey, (blobUps.get(upKey) | 0) + 1);
      blobReserved += want;
      readBody(req, want, (err, buf) => {
        const left = (blobUps.get(upKey) | 0) - 1;
        if (left > 0) blobUps.set(upKey, left); else blobUps.delete(upKey);
        blobReserved = Math.max(0, blobReserved - want);
        if (err) { reply(res, err === 'big' ? 413 : err === 'slow' ? 408 : 400, { Connection: 'close' }, err === 'big' ? 'too big' : ''); return; }
        if (!buf.length) { reply(res, 400, J, '{"error":"empty"}'); return; }
        let m = blobs.get(room); if (!m) { m = new Map(); blobs.set(room, m); }
        while (m.size >= 8) { const k = m.keys().next().value; m.delete(k); }
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        m.set(id, { buf, t: Date.now() });
        if (!rooms.has(room) && !emptySince.has(room)) emptySince.set(room, Date.now());
        try { sweepBlobs(true); } catch (e) { logErr('sweep', e); }
        reply(res, 200, J, JSON.stringify({ id, size: buf.length }));
      }, BLOB_BODY_MS, BLOB_IDLE_MS);
      return;
    }
    if (url.pathname === '/mp/blob' && req.method === 'GET') {
      const m = blobs.get(room), b = m && m.get(url.searchParams.get('id') || '');
      if (!b) { reply(res, 404, J, '{"error":"not found"}'); return; }
      reply(res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.buf.length, 'Cache-Control': 'no-store' }, b.buf);
      return;
    }
    reply(res, 404, {}, '');
  }

  // Never let one bad request or a dropped connection take the whole server (and every running match) down.
  const logErr = (tag, e) => { try { const line = new Date().toISOString() + ' ' + tag + ' ' + (e && e.stack || e) + String.fromCharCode(10); console.error(line); fs.appendFile(path.join(ROOT, 'server-error.log'), line, () => {}); } catch { /* ignore */ } };
  process.on('uncaughtException', e => logErr('uncaughtException', e));
  process.on('unhandledRejection', e => logErr('unhandledRejection', e));

  const server = http.createServer((req, res) => {
    req.on('error', () => {}); res.on('error', () => {});
    try { handle(req, res); } catch (e) { logErr('request ' + req.url, e); try { if (!res.headersSent) res.writeHead(500); res.end(); } catch { /* ignore */ } }
  });
  server.on('clientError', (e, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
  server.on('upgrade', (req, socket) => {
    socket.on('error', () => {});
    try { handleUpgrade(req, socket); } catch (e) { logErr('upgrade ' + req.url, e); try { socket.destroy(); } catch { /* ignore */ } }
  });
  // never served: dotfiles and folders (.git, .env, .claude), logs, and on Windows the names that reach them another
  // way: 8.3 short names (GIT~1), alternate streams (x.log::$DATA) and trailing dots / spaces (x.log.)
  function hiddenPath(rel) {
    return rel.split(/[\\/]/).some(s => s.startsWith('.') || s.includes('~') || s.includes(':') || /[. ]$/.test(s)) || /\.log$/i.test(rel);
  }
  // Content-Security-Policy of the game page, sent as Report-Only (the browser console names what it would block):
  // the inline import map by its hash, three.js and models from jsDelivr, the emoji font, Firebase / Google sign-in,
  // the relay on this host (also ws/wss for older browsers where 'self' does not cover them)
  // (the inline scripts by their hashes: the import map and index.html's two loaders)
  const cspCache = new Map();   // file -> {mtime, hashes}
  function scriptHashes(html) {
    const list = [];
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) list.push("'sha256-" + crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64') + "'");   // (the browser hashes the text with \n line ends)
    return list.join(' ');
  }
  function cspFor(req, file, pageHashes) {
    let hashes = pageHashes || '';
    if (pageHashes == null) {
      try {
        const st = fs.statSync(file), hit = cspCache.get(file);
        if (hit && hit.mtime === st.mtimeMs) hashes = hit.hashes;
        else { hashes = scriptHashes(fs.readFileSync(file, 'utf8')); cspCache.set(file, { mtime: st.mtimeMs, hashes }); }
      } catch { /* no hashes */ }
    }
    const host = /^[A-Za-z0-9.:[\]-]{1,255}$/.test(String(req.headers.host || '')) ? String(req.headers.host) : '';
    const g = 'https://www.gstatic.com https://apis.google.com https://accounts.google.com https://aevum-a081f.firebaseapp.com';
    return [
      "default-src 'self'",
      // 'wasm-unsafe-eval': three's MeshoptDecoder compiles WebAssembly (it allows WebAssembly only, not eval)
      "script-src 'self' 'wasm-unsafe-eval' " + hashes + ' https://cdn.jsdelivr.net ' + g,
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://cdn.jsdelivr.net https://*.googleusercontent.com https://www.gstatic.com",
      "media-src 'self' data: blob: https://cdn.jsdelivr.net",
      "connect-src 'self'" + (host ? ' ws://' + host + ' wss://' + host : '') + ' https://cdn.jsdelivr.net https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com ' + g,
      'frame-src ' + g,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
  }
  function handle(req, res) {
    if ((req.url || '').startsWith('/mp/')) {
      let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); res.end(); return; }
      handleMp(req, res, url); return;
    }
    if (/^\/admin\/?(\?.*)?$/.test(req.url || '') && (req.method === 'GET' || req.method === 'HEAD')) { serveAdmin(req, res); return; }
    let rel;
    try { rel = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]); }
    catch { res.writeHead(400); res.end('Bad request'); return; }
    if (rel.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }   // (fs.stat would throw)
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (hiddenPath(rel)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 - Bulunamadi: ' + rel);
        return;
      }
      // (2026-11-20: the free plan's 5 GB a month ran out - every visit downloaded everything again under "no-store")
      // Files carry an ETag, so a browser that has one gets an empty 304. The game's code and pages are revalidated on
      // every load (a new version shows at once); models, sounds, icons and the favicons are kept for a day before asking
      // again. Text files go out gzipped (kept in memory per file version). (On the live site only index.html, the
      // favicons and the CDN fallback come from here, see CODE_SHA.)
      const ext = path.extname(file).toLowerCase();
      let page = null;
      if (file === PAGE) { try { page = servedPage(st); } catch { res.writeHead(500); res.end(); return; } }
      const etag = page ? page.etag : 'W/"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
      const head = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': rel.startsWith('/assets/') || /^\/(favicon[^/]*|apple-touch-icon\.png)$/.test(rel) ? 'public, max-age=86400' : 'no-cache',
        ETag: etag,
        Vary: 'Accept-Encoding',
      };
      if (ext === '.html') head['Content-Security-Policy-Report-Only'] = cspFor(req, file, page ? page.hashes : null);
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === '*')) { res.writeHead(304, head); res.end(); return; }
      const size = page ? page.buf.length : st.size;
      if (GZ_EXT.has(ext) && size > 1024 && size < 8 * 1024 * 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
        const hit = gzCache.get(file);
        const send = (buf) => { res.writeHead(200, Object.assign(head, { 'Content-Encoding': 'gzip', 'Content-Length': buf.length })); res.end(req.method === 'HEAD' ? undefined : buf); };
        if (hit && hit.etag === etag) { send(hit.buf); return; }
        const read = page ? (cb) => cb(null, page.buf) : (cb) => fs.readFile(file, cb);
        read((e2, raw) => {
          if (e2) { res.writeHead(500); res.end(); return; }
          zlib.gzip(raw, { level: 9 }, (e3, buf) => {
            if (e3) { res.writeHead(200, Object.assign(head, { 'Content-Length': raw.length })); res.end(req.method === 'HEAD' ? undefined : raw); return; }
            gzCache.set(file, { etag, buf }); send(buf);
          });
        });
        return;
      }
      head['Content-Length'] = size;
      res.writeHead(200, head);
      if (req.method === 'HEAD') { res.end(); return; }
      if (page) { res.end(page.buf); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  }
  let listening = false;
  server.on('error', e => {
    if (e && e.code === 'EADDRINUSE') { console.error(`Port ${PORT} kullanimda. Oyun zaten acik olabilir: http://localhost:${PORT}`); process.exit(1); }
    if (!listening) { console.error(e); process.exit(1); }
    logErr('server', e); // a runtime error (e.g. EMFILE) must not end every running match
  });
  // SSE / long-poll responses stay open; never let the http defaults cut them
  server.requestTimeout = 0; server.headersTimeout = 60000; server.keepAliveTimeout = 30000;
  server.listen(PORT, '0.0.0.0', async () => {
    listening = true;
    console.log(`Aevum calisiyor: http://localhost:${PORT}  (kapatmak icin Ctrl+C)`);
    try {
      const os = await import('node:os');
      const ips = [];
      for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
      if (ips.length) console.log('Ayni agdaki diger bilgisayarlar icin: ' + ips.map(ip => `http://${ip}:${PORT}`).join('  '));
    } catch { /* ignore */ }
  });
})();
