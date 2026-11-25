# Aevum Netcode İyileştirme Raporu (`neon-net`)

**Dal / Worktree:** `neon-net` (`F:\Siber Sörfçü\HiggsfieldAPi\Claude\aevum-neon-net`, baz: `48b692b7`)
**Kapsam:** Yalnızca kod tarafı gecikme / jitter azaltma optimizasyonları (`src/sim/`, `render.yaml`, `srv/admin*`, `srv/firestore-sa.mjs` ve anahtarlara dokunulmadı; lockstep determinizmi birebir korundu).

---

## Yapılan Maddeler ve Commit'ler

| Madde | Commit | Özet Değişiklik | Beklenen / Ölçülen Etki |
| :--- | :--- | :--- | :--- |
| **1** | `030bffbe` | `WSTransport.reliable = true`; güvenilir WS normal akışında 4 turluk `r` tekrarı kaldırıldı (yeniden bağlantı `_resendWindow` ve `need` yanıtları `REDUNDANCY = 4` korur). `server.js` `relay()` sıcak konularda (`turn`/`sync`/`flare`) tekrarlanan `id` alanını kaldırdı ve WS çerçevesini `sendRaw` ile bir kez kodlayıp tüm alıcılara gönderdi. | Canlı 2-istemci WS testinde ortalama `turn` paketi **50.7 B**, `r` tekrarı **0/320**, sunucu `id` eklemesi **0** (~5× daha küçük paket + çok oyunculu odada daha az sunucu CPU/GC). |
| **2** | `74efdd5a` | `TURN_TICKS` `3 → 2` (66.7 ms/tur), taban `DELAY` `3 → 2` (133 ms taban; uzak maç başlangıcı `200 ms`), `MAX_DELAY = 18`, `KEEP_TURNS = 900`, `HASH_EVERY = 45`. `_scheduleOwn`/`advance` içindeki 90 ms gönderim freni kaldırıldı; `_wantFor` sabit payı `70 → 35 ms`. Protokole bağlı iki eski test eşiği güncellendi (`test/net-test.mjs` mesaj bütçesi `12/16 → 18/26 msgs/s`; `test/net-ws-test.mjs` beklenen gecikme formülü). | Taban giriş gecikmesi **300 ms → 133 ms** (yerel) / **400 ms → 200 ms** (uzak başlangıç); 90 ms suni bekletme ortadan kalktı. |
| **3** | `ac6b503d` | `< 60 ms` mikro-duraksamaların gecikmeyi şişirmesi engellendi (bir duraksama döneminde yalnızca `>= 60 ms` ve en fazla 1 kez sayılır). `_rttOf` %90 yerine %80 yüzdelik (`floor((n-1)*0.8)`). `_onTurn` `lead` EMA'sı yalnızca ileri giden yeni turlarda güncellenir. İkili `0.95` hız freni yerine yumuşak orantılı pacing (`0.88–1.06`, `_slow` getter/setter uyumlu). Güvenilir WS'te `PING_MS = 500 ms`, `server.js` `{type:'ping'}`/`{type:'pong'}` ile `srvRtt` ölçümü ve `netInfo()` içinde yumuşatılmış `ping`, `srvPing`, `delay`, `kind`. | `test/net-ws-test.mjs` (~425 ms RTT, Türkiye↔ABD simülasyonu): giriş gecikmesi **400 ms → 267–333 ms**, **0/0 stall**, **0–1 tick** kayma (Item 2 sonrası mikro-stall şişmesi 600 ms'ye çıkarken Item 3 ile 267 ms'ye indi). |
| **4** | `d27dee3f` | `wsProbe` zaman aşımı `2500 → 5000 ms` + 300 ms sonra 1 tekrar. WS başarısızsa HTTP long-poll öncesi `sseProbe` (`/mp/events?probe=1`) ara katmanı eklendi; `server.js` SSE soketlerinde `setNoDelay(true)`. `SSETransport`/`PollTransport` `.kind` eklendi; HUD'da HTTP poll fallback uyarısı (`⚠ HTTP`) ve tıklayınca gecikme/sunucu ping detayı gösterilir. | Uzak/soğuk sunucuda yanlışlıkla HTTP long-poll'a düşme riski azaldı; SSE'de Nagle gecikmesi (~40 ms) kaldırıldı. |
| **5** | `2617a73f` | Güvenilir bağlı WS'te duraksama `need` bekleme/tekrar aralığı RTT ile ölçeklendi (`max(400, 1.25 * worstRtt)` / `max(400, worstRtt)`); kayıplı taşıyıcılarda `200/300 ms` korundu. `need` penceresi sabit `DELAY` yerine aktif `this.delay` (`turn .. turn + this.delay`) kapsayacak şekilde düzeltildi. | Yüksek ping'de yoldaki TCP paketleri için gereksiz `need` fırtınası engellendi; adaptif gecikme yüksekken eksik turlar tek seferde isteniyor. |
| **6** | `9dc7fbd5` | Çok oyunculu otomatik kayıt aralığı `MP_AUTOSAVE_TICKS` `2 dk → 5 dk` (bulut kapısı ile uyumlu), `HASH_EVERY` `45 → 75` (~5 sn), `_execTurn` içindeki gereksiz `JSON.parse(JSON.stringify(args))` kopyalaması kaldırıldı (`execCommand` kendi kopyasını alıyor). | Ana iş parçacığı takılmaları (tam durum serileştirme 2.5×, hash/hashParts 1.67× daha seyrek; komut başına ekstra JSON klonu yok). |
| **7** | `4cc2e3bf` | `src/render/entities.js` `_updUnit` birim konum/dönüş yumuşatması `dt * 14` (~71 ms gecikme) ve `dt * 12` yerine kare hızından bağımsız `1 - exp(-32 * dt)` (~31 ms) ve `1 - exp(-24 * dt)` (~42 ms) yapıldı (yalnızca görünüm, simülasyona dokunulmadı). | Birimlerin komutlara görsel tepkisinde ~40 ms azalma; 60/120/144 Hz ekranlarda tutarlı akıcılık. |
| **8** | `10dc8a52` | `server.js` `logErr` `fs.appendFileSync → fs.appendFile` (asenkron). `CloudSync.stopInbox()` aktif `/mp/inbox` uzun sorgusunu `AbortController` ile iptal eder; `src/main.js` çok oyunculu maç başlayınca `stopInbox()`, oturum kapanınca / menüye dönünce `startInbox()` çağırır. | Hata günlüğü olay döngüsünü bloklamaz; maç sırasında arka planda boş `/mp/inbox` uzun sorgusu tutulmaz. |
| **Test** | `34e5c0e2` | `test/net-test.mjs` içine 5 yeni doğrulama eklendi: (1) güvenilir taşıyıcıda `r` yok / güvenilmezde var, (2) `< 60 ms` mikro-stall gecikme şişirmez & `>= 60 ms` tek sayılır, (3) 90 ms gönderim freni yok (67 ms'de hemen flush), (4) RTT'ye göre ölçeklenen `need` beklemesi ve `turn + delay` kapsamı, (5) %15 kayıplı `MemTransport` üzerinde 2 istemci birebir aynı hash ile senkron kalır. | Yeni protokol davranışları regresyon koruması altında. |

---

## Çalıştırılan Testler (Her Madde Sonrası + Final)

Aşağıdaki **11 test paketi** eksiksiz geçti:
- `node test/net-test.mjs` — **GEÇTİ** (3 istemci %15 kayıp + 2 istemci kayıplı senkron + 5 yeni protokol testi; aynı hash, 0 desync)
- `node test/determinism-test.mjs` — **GEÇTİ** (`final hash 1561451403` birebir korundu)
- `node test/sim-smoke.mjs` — **GEÇTİ** (25 dk simülasyon + kayıt/yükleme)
- `node test/tutorial-test.mjs` — **GEÇTİ** (9/9 bölüm, deterministik hash `2484665071`)
- `node test/playtest2-ui-test.mjs` — **GEÇTİ** (tribute, barter, control groups)
- `node test/mp-save-test.mjs` — **GEÇTİ** (6+6 dk MP kayıt/yükleme, `hash 2883447112`)
- `node test/cloud-test.mjs` — **GEÇTİ** (tüm bulut / hesap / TP / inbox akışları)
- `node test/net-ws-test.mjs` — **GEÇTİ** (gerçek `server.js` + ~400 ms RTT simülasyonu)
- `node test/net-outage-test.mjs` — **GEÇTİ** (sunucu kesintisi + yeniden bağlanma + MP kayıt/devam)
- `node test/net-guard-test.mjs` — **GEÇTİ** (kötü niyetli paket/lobi/withhold korumaları)
- `node test/net-uid-test.mjs` — **GEÇTİ** (doğrulanmış kimlik ve slot eşleme)

### Canlı 2-İstemci WebSocket Doğrulaması (`AEVUM_NO_AUTH=1 PORT=5199`)
- Gerçek `server.js` (port 5199) arka planda başlatılıp iki Node `WSTransport` + `NetSession` + `Game` istemcisi 10 saniyelik gerçek zamanlı maçta çalıştırıldı ve ardından sunucu kapatıldı:
  - `wsProbe(5199)`: `true`
  - Tikler: `319 / 319`, komutlar: `18 / 18`, `stalls: [0, 0]`, `desync: 0`
  - Final hash: `100860033 / 100860033` (**birebir eşit**)
  - `netInfo`: `{"ping":1,"srvPing":1,"delay":133,"kind":"ws","slow":false}`
  - Hat istatistiği: `avgTurnBytes: 50.7 B`, `maxTurnBytes: 135 B`, `turnPackets: 320`, `turnPacketsWithR: 0`, `serverTurnMsgsWithId: 0`

---

## Ölçülen Öncesi / Sonrası Özet

| Metrik | Öncesi (Baz `48b692b7`) | Sonrası (`neon-net`) |
| :--- | :--- | :--- |
| Yerel taban giriş gecikmesi (`DELAY * TURN_TICKS`) | 300 ms (3 × 100 ms) | **133 ms** (2 × 66.7 ms) |
| Uzak maç başlangıç giriş gecikmesi | 400 ms | **200 ms** |
| ~425 ms RTT simülasyon gecikmesi (`net-ws-test`) | 400 ms (`delay=4`, 100 ms tur) | **267–333 ms** (`delay=4–5`, 66.7 ms tur, **0 stall**) |
| Normal WS `turn` paketi tekrar penceresi (`r`) | 4 eski tur (5× veri, ~250–669 B) | **0** (`avg 50.7 B`, `max 135 B`) |
| Sunucu `turn`/`sync`/`flare` mesajında `id` tekrarı | Her pakette (~90 B) | **0** |
| Görsel birim takip gecikmesi (`_updUnit`) | ~71 ms (`dt * 14`) | **~31 ms** (`1 - exp(-32 * dt)`) |
| MP otomatik kayıt / durum hash sıklığı | 2 dk / 3 sn | **5 dk / 5 sn** |

> **Not (Sunucu Mesafesi):** Türkiye'den ölçülen 0.29–1.2 sn origin TTFB (Render bölgesi / ücretsiz plan) fiziksel RTT tabanını belirler; kod optimizasyonları bunun üstüne binen protokol, paket şişkinliği, mikro-duraksama ve görsel gecikmeyi büyük ölçüde temizlemiştir.
