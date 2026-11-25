// Unit voice lines (owner 2026-11-25): Gemini TTS -> assets/sfx/vo/*.mp3
// Key: ~/.aevum/gemini-key (never in the repo). Run: node tools/gen-voices.mjs [--only <substring>] [--force]
// Needs ffmpeg on PATH. Writes src/voice-lines.js (the file list the game reads).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const MODEL = 'gemini-3.8-flash-tts';
const OUT = path.resolve('assets/sfx/vo');
const KEY = fs.readFileSync(path.join(os.homedir(), '.aevum', 'gemini-key'), 'utf8').trim();

// voice id -> [Gemini voice, group]
export const VOICES = {
  vm1: ['Puck', 'vm'], vm2: ['Orus', 'vm'],
  vf1: ['Kore', 'vf'], vf2: ['Leda', 'vf'],
  sd1: ['Fenrir', 'sd'], sd2: ['Alnilam', 'sd'], sd3: ['Algenib', 'sd'],
  sh1: ['Charon', 'sh'],
};

const STYLE = {
  tr: {
    vm: 'Ortaçağ köyünde çalışan samimi, sıradan bir erkek köylü gibi, doğal ve kısa söyle:',
    vf: 'Ortaçağ köyünde çalışan samimi, enerjik bir kadın köylü gibi, doğal ve kısa söyle:',
    sd: 'Gür, kalın ve sert sesli cengaver bir savaşçı gibi, kararlı ve kısa söyle:',
    sdA: 'Gür sesli cengaver bir savaşçı gibi, savaş naresi atarak bağır:',
    sh: 'Tecrübeli, kalın sesli bir gemi kaptanı gibi, kısa ve net söyle:',
  },
  en: {
    vm: 'Say it briefly and naturally, like a friendly ordinary medieval village man:',
    vf: 'Say it briefly and naturally, like a lively medieval village woman:',
    sd: 'Say it briefly and firmly, like a gruff, deep-voiced battle-hardened warrior:',
    sdA: 'Shout it as a battle cry, like a deep-voiced fierce warrior:',
    sh: 'Say it briefly and clearly, like a seasoned deep-voiced ship captain:',
  },
};

const VILLAGER = {
  select: { tr: ['Evet?', 'Emrin olur.', 'Buyur?', 'Ne yapayım?', 'Hazırım.'], en: ['Yes?', 'At your service.', 'What is it?', 'What shall I do?', 'Ready.'] },
  move:   { tr: ['Gidiyorum.', 'Tamamdır.', 'Hemen.'], en: ['On my way.', 'Alright.', 'Right away.'] },
  wood:   { tr: ['Odun keserim.', 'Baltamı aldım.'], en: ['Chopping wood.', 'Axe in hand.'] },
  food:   { tr: ['Yiyecek toplarım.', 'Tarlaya gidiyorum.'], en: ['Gathering food.', 'To the fields.'] },
  stone:  { tr: ['Taş kırmaya!', 'Ocağa gidiyorum.'], en: ['Breaking stone.', 'To the quarry.'] },
  gold:   { tr: ['Altın, ha?', 'Madene iniyorum.'], en: ['Gold, eh?', 'Down to the mine.'] },
  build:  { tr: ['İnşa ederim.', 'Çekicim hazır.'], en: ["I'll build it.", 'Hammer ready.'] },
};
const SOLDIER = {
  select: { tr: ['Emredin!', 'Komutanım?', 'Hazırız!', 'Emrindeyim.', 'Söyle komutan.'], en: ['Orders?', 'Commander?', 'Ready!', 'At your command.', 'Speak, commander.'] },
  move:   { tr: ['Emredersiniz!', 'İleri!', 'Yola çıkıyoruz.', 'Anlaşıldı.'], en: ['Yes, sir!', 'Forward!', 'Moving out.', 'Understood.'] },
  attack: { tr: ['Saldırın!', 'Hücum!', 'Kılıçlar çekilsin!', 'Yok edin onları!', 'Savaşa!'], en: ['Attack!', 'Charge!', 'Draw swords!', 'Destroy them!', 'To battle!'] },
};
const SHIP = {
  select: { tr: ['Kaptan burada.', 'Yelkenler hazır.', 'Emir verin.'], en: ['Captain here.', 'Sails ready.', 'Your orders?'] },
  move:   { tr: ['Rota belirlendi.', 'Yelken açın!', 'Tam yol!'], en: ['Course set.', 'Hoist the sails!', 'Full ahead!'] },
  attack: { tr: ['Ateş!', 'Toplar hazır!', 'Batırın onu!'], en: ['Fire!', 'Cannons ready!', 'Sink her!'] },
};
const TABLE = { vm: VILLAGER, vf: VILLAGER, sd: SOLDIER, sh: SHIP };

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const force = args.includes('--force');
fs.mkdirSync(OUT, { recursive: true });

const jobs = [];
for (const [vid, [gv, grp]] of Object.entries(VOICES)) {
  for (const lang of ['tr', 'en']) {
    for (const [kind, ls] of Object.entries(TABLE[grp])) {
      ls[lang].forEach((line, i) => {
        const name = `${vid}_${lang}_${kind}${i + 1}`;
        const style = STYLE[lang][grp === 'sd' && kind === 'attack' ? 'sdA' : grp];
        jobs.push({ name, gv, style, line });
      });
    }
  }
}

// One request per voice + language (owner 2026-11-25: the model allows only 100 requests a day): all missing lines of the
// set are read in one go, one per line with a pause between, then cut at the silences. A cut that does not give exactly
// the asked number of lines is not saved (rerun later); nothing falls back to another model.
const ff = (a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a]);
// ffmpeg's report (silencedetect + duration go to stderr)
const probe = (wav) => spawnSync('ffmpeg', ['-v', 'info', '-i', wav, '-af', 'silencedetect=n=-40dB:d=0.35', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
async function ttsSet(gv, list) {
  const text = list.map((j) => j.line).join('\n...\n');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: gv } } } } }),
    });
    if (res.status === 429) { const t = await res.text(); if (/per day/i.test(t)) throw new Error('daily quota used up'); await new Promise((r) => setTimeout(r, 20000)); continue; }
    const j = await res.json();
    const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error(JSON.stringify(j).slice(0, 200));
    const tmp = path.join(os.tmpdir(), 'aevum-vo-set.raw'), wav = path.join(os.tmpdir(), 'aevum-vo-set.wav');
    fs.writeFileSync(tmp, Buffer.from(part.inlineData.data, 'base64'));
    const pcm = !/wav/i.test(part.inlineData.mimeType || '');
    ff([...(pcm ? ['-f', 's16le', '-ar', '24000', '-ac', '1'] : []), '-i', tmp, '-ar', '24000', '-ac', '1', wav]);
    return wav;
  }
  throw new Error('rate limited');
}
function cuts(log) {
  const d = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dur = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  const st = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const en = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const segs = []; let from = 0;
  for (let i = 0; i < st.length; i++) { if (st[i] - from > 0.15) segs.push([from, st[i]]); from = en[i] ?? dur; }
  if (dur - from > 0.15) segs.push([from, dur]);
  return segs;
}
const sets = {};
for (const j of jobs) {
  if (only && !only.some((o) => j.name.includes(o))) continue;
  if (!force && fs.existsSync(path.join(OUT, j.name + '.mp3'))) continue;
  (sets[j.name.split('_').slice(0, 2).join('_')] ||= []).push(j);
}
let n = 0, fail = 0;
for (const [k, list] of Object.entries(sets)) {
  try {
    const wav = await ttsSet(list[0].gv, list);
    const segs = cuts(probe(wav));
    if (segs.length !== list.length) { fail++; console.log('FAIL', k, 'got', segs.length, 'lines, want', list.length); fs.copyFileSync(wav, path.join(os.tmpdir(), 'vo-' + k + '-raw.wav')); continue; }
    list.forEach((j, i) => {
      const [a, b] = segs[i];
      ff(['-i', wav, '-ss', Math.max(0, a - 0.03).toFixed(3), '-to', (b + 0.08).toFixed(3), '-af', 'loudnorm=I=-18:TP=-2', '-ar', '24000', '-ac', '1', '-b:a', '48k', path.join(OUT, j.name + '.mp3')]);
    });
    n += list.length; console.log('ok', k, list.length);
  } catch (e) { fail++; console.log('FAIL', k, e.message); if (/daily/.test(e.message)) break; }
}

// the game's list: { 'vm1_tr_select': 5, ... } (counts of files present)
const counts = {};
for (const f of fs.readdirSync(OUT)) {
  const m = f.match(/^(.+?)(\d+)\.mp3$/);
  if (m) counts[m[1]] = Math.max(counts[m[1]] || 0, +m[2]);
}
const groups = {};
for (const [vid, [, grp]] of Object.entries(VOICES)) if (Object.keys(counts).some((k) => k.startsWith(vid + '_'))) (groups[grp] ||= []).push(vid);
fs.writeFileSync('src/voice-lines.js',
  '// Generated by tools/gen-voices.mjs: unit voice lines in assets/sfx/vo/ (name -> number of variants)\n' +
  'export const VO_GROUPS = ' + JSON.stringify(groups) + ';\n' +
  'export const VO_COUNTS = ' + JSON.stringify(counts) + ';\n');
console.log('done', n, 'failed', fail);
