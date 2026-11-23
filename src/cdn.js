// Aevum - where the browser gets the files under assets/ (models, sounds, the icon sprite).
// (2026-11-20: the host's free monthly bandwidth ran out; 2026-11-22, owner: "render.com'u mümkün olduğunca hafifletelim")
// On the live site they come from jsDelivr, which serves this public repository's files for free, from the edge, and
// lets browsers keep them for a year. They are pinned to one commit, the ASSET PIN, and not to the deployed commit, so a
// release that does not touch assets/ does not make every player download the models again (a URL with a commit SHA
// never changes). test/cdn-pin-test.mjs checks that every file under assets/ is byte-identical at the pin; when one
// changes: push it, move ASSET_PIN to that pushed commit, run the test (README: How the live site is served).
// The code itself (style.css, src/**) comes from jsDelivr at the deployed commit: index.html decides that.
// Local servers and ?cdn=0 load everything from the host; ?cdn=1 tries the CDN on a local server. A file the CDN
// cannot give is loaded from the host instead, and after a few CDN failures the rest of the page's assets come from
// the host directly (jsDelivr down: no waiting on it for every file).
export const ASSET_PIN = '6bd8ea5801aba53d3169e14d3c8bdc399edfb665';
const CDN_ASSETS = 'https://cdn.jsdelivr.net/gh/flickrz/aevum-rts@' + ASSET_PIN + '/assets/';
const HOST_ASSETS = './assets/';
const MAX_FAILS = 3;

export const USE_CDN = (() => {
  try {
    if (/[?&]cdn=0/.test(location.search)) return false;
    if (/[?&]cdn=1/.test(location.search)) return true;
    const h = location.hostname;
    return !(h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost'));
  } catch { return false; }
})();
let fails = 0;

// the URLs to try for assets/<rel>, in order: [CDN, host] or [host]
export function assetUrls(rel) {
  return USE_CDN && fails < MAX_FAILS ? [CDN_ASSETS + rel, HOST_ASSETS + rel] : [HOST_ASSETS + rel];
}
// a CDN load failed (the caller then tries the host)
export function cdnFailed() { fails++; }

// fetch() of assets/<rel>: the CDN first, then the host. `hostInit` (default: `init`) is used for the host request.
export async function fetchAsset(rel, init, hostInit = init) {
  const urls = assetUrls(rel);
  if (urls.length > 1) {
    try { const r = await fetch(urls[0], init); if (r.ok) return r; } catch { /* the host below */ }
    cdnFailed();
  }
  return fetch(urls[urls.length - 1], hostInit);
}
