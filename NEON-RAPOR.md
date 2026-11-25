# Neon Performans Optimizasyonu Raporu (`neon-opt`)

Taban commit: `0a2c4207` (`dev`). Tüm değişiklikler istenen sırada (`3, 4, 5, 7, 8, 1, 2, 6`), her madde ayrı commit olacak şekilde `neon-opt` dalına işlendi; hiçbir madde geri alınmadı (revert: yok).

## Yapılan Değişiklikler ve Commit'ler

| Sıra / Madde | Commit | Dosyalar | Özet |
|---|---|---|---|
| **3** | `87e001be` | `src/render/entities.js`, `src/render/static-batch.js`, `src/render/models-sea.js` | `EntityView.update` içinde tüm harita varlıklarını (10k–35k ağaç) gezmek yerine `buildings`, `units`, `deer` ve takip edilen statik kaynakları dönme; duvar/ray bağ haritası ve maskelerini yalnızca bina değişikliğinde yenileme; bina/kaynak zemin yüksekliklerini `terrain` olayına kadar önbellekleme; statik chunk'a giren binalarda `matrixWorldAutoUpdate = false`. |
| **4** | `d26cb729` | `src/render/renderer.js` | Sis dokusu (`_updateFow`) için `Uint32Array` 4-bayt tarama ile değişen kareleri seyrek aktif listeye alma, yalnızca sönümleyen kareleri işleme ve çıktı baytı değişmediyse `fowTex.needsUpdate` yüklemesini atlama. |
| **5** | `c790826f` | `src/ui/ui.js` | `_extraStats` içindeki `[...g.entities.values()]` (35k ağaç kopyası) yerine doğrudan `g.units` okuma; HUD DOM referanslarını önbellekleme ve tüm metin/stil/sınıf yazımlarını diff-guard ile koruma; `_devPanel`/`_clearTop` çift çalışma hatasını düzeltme ve layout ölçümlerini (`getBoundingClientRect`) yalnızca değişiklikte yapma; mini haritada kaynak önbelleği, hazır `PLAYER_HEX` tablosu ve yeniden kullanılan diziler. |
| **7** | `bcee00f4` | `src/render/entities.js`, `src/render/glb-models.js`, `src/render/construction.js` | Bina yüksekliğini vertex tarayan `Box3.setFromObject` yerine önbellekli mesh `boundingBox` dönüşümüyle hesaplama; `glb-models.js`'te takım mavisi piksellerini/vertex'lerini seyrek indeks dizisinde tutma ve aktif oyuncuların boyalı GLB materyallerini GPU'ya ısıtma (`glbWarmColors`); `construction.js`'te `rootPos` matris dönüşümünü inline etme ve `topsAt` üçgen taramasını 9×9 ızgarayla sınırlandırma. |
| **8** | `52bea28a` | `src/sim/ai.js` | `AIController._wallFlood` için yeniden kullanılan typed array tamponları (`_wfSeenA`, `_wfSeenB`, `_wfFnd`, `_wfQ`); `_wallSafe` içinde temel taşkın ve temel maskesini paylaşma; `_walls` tek-tek yedek döngüsü öncesinde temel taşkını (`FA`) bir kez hesaplama. |
| **1** | `6370cec4` | `src/render/entities.js`, `src/render/renderer.js` | Tarla ekin `InstancedMesh`'lerine yerel `boundingSphere` verip `frustumCulled = true` yapma; `_buildDecor` içindeki çimen, çiçek ve kayaları aynı RNG sırası, matris ve renklerle 32×32 dünya-uzayı chunk'larına bölüp frustum-cull etme. |
| **2** | `4b9c9726` | `src/render/entities.js` | `SEG_CACHE` ile oyuncular arası özdeş birim segment geometrilerini paylaşma (referans sayımlı dispose); birim/koyun/balık slotlarında `IBatch` referansını önbellekleme ve yalnızca aktif aralığı (`addUpdateRange`) GPU'ya yükleme; mermileri (`_pb`) ve frustum-cull'lu balık sürülerini (`_fb`) `IBatch` ile birleştirme; `EntityView.dispose()` içindeki `_cb` sızıntısını düzeltme. |
| **6** | `1a4ead94` | `src/sim/game.js` | `buildingAt` için O(1) `_bAt` tablosu; `_cells` için yalnızca dolu hücreleri temizleyen `_dirtyCells`; `dhypot` öncesi kesin kutu ön-elemesiyle closure'sız birim ayrıştırma; `_updateFog` içinde 32-bit `2→1` geçişi, inline birim görüşü ve bitmiş binalar için takım başına birleştirilmiş önbellekli satır aralıkları. |

## Test ve Determinizm Sonuçları

- **Determinizm ve sabit hash'ler (tüm 8 maddede değişmedi):**
  - `node test/determinism-test.mjs`: **GEÇTİ** — başlangıç hash `1863951209`, bitiş hash `1561451403` (A/B/C birebir aynı, `src/sim` içinde yasaklı `Math.*` yok). Madde 6 ile 3×13.4 dk sim süresi **~29 s → 23.2 s**.
  - `node test/tutorial-test.mjs`: **GEÇTİ** — başlangıç `423630152`, 2 dk `2493039770`, öğretici sonu `2484665071` (birebir aynı). Madde 6 ile duvar süresi **~5.3 s → 2.6 s**.
  - `node test/playtest2-ui-test.mjs`, `node test/data-check.mjs`: Her commit sonrası **GEÇTİ**.
- **Ek alan testleri (tümü GEÇTİ):** `naval`, `naval-eco`, `naval-transport`, `formation`, `playtest2-sim`, `playtest3`, `gate`, `wall-pass`, `ai-wall-ring`, `dock-repair`, `healer`, `map`, `land`, `move-rotate`, `gather-spots`, `predator`, `hunt`, `team`, `tech-parallel`, `worker-slot`, `edge-wall`, `stats`.
- **Önceden `dev` üzerinde zaten başarısız olduğu doğrulanan testler (bizim değişikliklerden bağımsız):**
  - `ai-wall-test.mjs`: Hem `HEAD` hem Madde 8 birebir aynı hash `1006144484` ve `P1 villagers = 19` veriyor.
  - `path-test.mjs`: Hem `HEAD` hem Madde 6 birebir aynı mesafeleri (`22.47`, `19.03`, `25.55`) verirken en kötü tick süresi Madde 6'da `38.3 ms → 26.5 ms` ve `10.0 ms → 5.8 ms`'ye düştü.
  - `amove-test.mjs`, `small-map-test.mjs` (`islands` ulaşılabilirlik), `archers-wall-test.mjs`: Taban `dev` kodunda da birebir aynı çıktıyı veriyor.

## Geri Alınan / Atlananlar

- **Geri alınan:** Yok (tüm 8 madde geçti ve korundu).
- **Görsel pixel-diff ve tarayıcı FPS ölçümleri:** Talimat gereği atlandı (Claude tarafından doğrulama aşamasında yapılacak).
