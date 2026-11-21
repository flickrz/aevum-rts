# Contributing to Aevum

Aevum is a browser RTS (Three.js, plain ES modules, no build step) with a small Node server for multiplayer.
Contributions are welcome: bug fixes, balance, AI, maps, performance, translations.

## Run it

- Node.js 20+. No `npm install` needed.
- `node server.js`, then open http://localhost:5173.
- Three.js loads from a CDN, so the first start needs internet.
- On localhost the new-game screen offers **Developer mode** (map revealed, endless resources, age switching).
  On other hosts add `?dev=1` to the URL (`?dev=0` turns it off again).

## Accounts and Firebase

Playing requires a Google sign-in through Firebase (Auth + Firestore, free Spark plan).

- The official game uses the project in `src/cloud/config.js`. That web config is public by design; access to the
  data is limited by Firestore security rules (every player can only write their own data).
- Contributors never get access to the official Firebase console or data, and don't need it.
- To test accounts and cloud saves against your own backend, create a free Firebase project with Google sign-in
  and Firestore, put its web config in `src/cloud/config.js` (don't commit that change), and start the server with
  `AEVUM_FIREBASE_PROJECT=<your-project-id> node server.js`.
- For offline tests the server accepts `AEVUM_NO_AUTH=1` (local only, never in production).
- Never commit keys, service-account files (`*firebase-sa*.json`, `*-adminsdk-*.json`) or `.env` files.

## Tests

Plain Node scripts in `test/`, no framework:

    node test/sim-smoke.mjs
    node test/determinism-test.mjs

Run those two plus the suites your change touches (for example `path-test.mjs` for pathing, `net-test.mjs` for
multiplayer). The simulation must stay deterministic: multiplayer is lockstep, so no `Math.random()`, `Date.now()`
or floating-point order differences inside `src/sim/`.

## How the live site is served

The live site runs on Render's free plan (5 GB of bandwidth a month), so Render serves as little as possible. The
repository is public, and jsDelivr serves its files for free from its edge:

| What | From | URL |
|---|---|---|
| `style.css`, `src/**` (the code) | jsDelivr, at the deployed commit | `cdn.jsdelivr.net/gh/flickrz/aevum-rts@<RENDER_GIT_COMMIT>/...` |
| `assets/**` (models, sounds, icons, licences) | jsDelivr, at the asset pin | `cdn.jsdelivr.net/gh/flickrz/aevum-rts@<ASSET_PIN>/assets/...` |
| three.js | jsDelivr npm | `cdn.jsdelivr.net/npm/three@0.160.0/...` |
| `index.html`, `/favicon.*`, `apple-touch-icon.png`, `/mp/*` (API, relay: WebSocket / SSE / polling) | Render | |

- `server.js` writes the deployed commit (`RENDER_GIT_COMMIT`, set by Render) into `index.html`'s
  `<meta name="aevum-cdn">`; the page's two small inline loaders then take `style.css` and `src/main.js` (and with it
  every module it imports) from jsDelivr. If the CDN copy cannot be fetched, the same files load from Render.
- Assets are pinned to their own commit (`ASSET_PIN` in `src/cdn.js`) so a release that does not touch `assets/` does
  not make every player download the models again. `src/cdn.js` loads every asset: CDN first, Render on failure.
- Without a commit (a local server) everything comes from the host. `?cdn=0` forces the host; `?cdn=1` tries the CDN
  on a local server (for the code, start the server with `AEVUM_CDN_COMMIT=<a pushed commit>`).
- Fetches of `/mp/...` and the relay go to the page's origin (Render) no matter where the code came from.

**When anything under `assets/` changes:** push it, set `ASSET_PIN` in `src/cdn.js` to that pushed commit (a commit
that is on GitHub and has exactly these files), then run `node test/cdn-pin-test.mjs` (every file under `assets/` must
match the pin). Run it before every release; `node test/cdn-serve-test.mjs` checks the page serving.

## Pull requests

- Fork the repo, work on a branch, open a PR against `main`. `main` deploys the live game, so every PR is reviewed.
- Keep a PR to one topic. Describe what changed and how you tested it; add a screenshot for visual changes.
- Code and comments in English. In-game text is Turkish.
- Assets: only add files you have the right to share (CC0 / CC BY are ideal) and list the source and licence
  (see `assets/sfx/LICENSES.md`). No AI-generated sound.

## Licence of contributions

By opening a pull request you agree that:

1. your contribution is your own work (or you have the right to submit it), and
2. it is licensed under the project's licences (code: AGPL-3.0-or-later; assets: as listed in `assets/LICENSE.md`),
   and you grant the project owner the right to also release it under other licence terms in the future.

## Name

"Aevum" and its logo are not licensed. Forks are welcome but must use another name.
