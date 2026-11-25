// Transcribe assets/sfx/vo/*.mp3 in batches (Gemini) to catch lines read wrong. Key: ~/.aevum/gemini-key
// node tools/check-voices.mjs [--only sd1_,vf2_]  -> prints name | transcript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY = fs.readFileSync(path.join(os.homedir(), '.aevum', 'gemini-key'), 'utf8').trim();
const DIR = path.resolve('assets/sfx/vo');
const MODEL = 'gemini-3-flash-preview';
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mp3') && (!only || only.some((o) => f.includes(o)))).sort();

for (let i = 0; i < files.length; i += 25) {
  const batch = files.slice(i, i + 25);
  const parts = [];
  batch.forEach((f, k) => {
    parts.push({ text: `Clip ${k + 1}:` });
    parts.push({ inlineData: { mimeType: 'audio/mpeg', data: fs.readFileSync(path.join(DIR, f)).toString('base64') } });
  });
  parts.push({ text: 'For each clip, transcribe exactly the spoken words (Turkish or English) and give the speaker gender and a 2-word tone. Reply only as JSON lines: {"clip":n,"text":"...","gender":"m|f","tone":"..."}' });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  const j = await res.json();
  const txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || JSON.stringify(j).slice(0, 300);
  for (const line of txt.split('\n')) {
    const m = line.match(/\{.*\}/);
    if (!m) continue;
    try { const o = JSON.parse(m[0]); console.log(batch[o.clip - 1], '|', o.text, '|', o.gender, o.tone); } catch (e) { /* */ }
  }
}
