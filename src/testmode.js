// Aevum - local test mode (owner 2026-11-23: try the phone controls before a release). Only on this PC's own test
// server, opened as http://<this PC's LAN address>:<port>/?test from a phone on the same Wi-Fi (or localhost/?test):
// the Google sign-in (which only works on the real site) is skipped with a throwaway local profile. Never on the live
// site: a public host name never matches.
export const TEST_MODE = (() => {
  try {
    const h = location.hostname;
    const local = h === 'localhost' || h === '127.0.0.1' || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
    return local && /[?&]test\b/.test(location.search);
  } catch (e) { return false; }
})();
export const TEST_PROFILE = { name: 'Test', uid: '0000000000test00', avatar: null };
