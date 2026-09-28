// scripts/analyze-repetition.mjs — 重复度量化分析（fixture 决策，确定性可复现）
// 用法：node scripts/analyze-repetition.mjs [bars=32] [seed=2026] [styleId=random] [--real]
// --real 用真实 Jev（key 取自 .dev.vars 的 TYPESAFE_API_KEY，花费 ≈ bars × $0.00006）
import { readFileSync } from 'node:fs';
import { buildPlan, Composer } from '../public/js/composer.js';

const args = process.argv.slice(2);
const real = args.includes('--real');
const bars = Number(args[0] ?? 32);
const seed = Number(args[1] ?? 2026);
const styleId = args[2] ?? 'random';

let key = process.env.TYPESAFE_API_KEY;
if (!key) {
  try { key = /^TYPESAFE_API_KEY=(.*)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1]?.trim(); } catch { /* */ }
}
const plan = await buildPlan({ prompt: '雨夜的城市，一个人走在霓虹下', goal: '随机冒险', styleId, seed, bars }, {});
const c = new Composer(plan, real ? { channel: 'typesafe', apiKey: key } : { channel: 'fixture' });
const sigs = [], lhSigs = [], chords = [], intervals = [], onsets = [];
for (let i = 0; i < bars; i++) {
  const bar = await c.nextBar();
  const rh = bar.notes.filter((n) => n.hand === 'R');
  const lh = bar.notes.filter((n) => n.hand === 'L');
  sigs.push(rh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(','));
  lhSigs.push(lh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(','));
  chords.push(bar.chord.symbol);
  for (let k = 1; k < rh.length; k++) intervals.push(Math.abs(rh[k].midi - rh[k - 1].midi));
  onsets.push(rh.length);
}
const uniq = new Set(sigs), uniqLh = new Set(lhSigs), uniqChord = new Set(chords);
// 相邻两小节完全相同的次数（旋律/左手）
let adjMel = 0, adjLh = 0;
for (let i = 1; i < bars; i++) { if (sigs[i] === sigs[i - 1]) adjMel++; if (lhSigs[i] === lhSigs[i - 1]) adjLh++; }
// 2-gram 重复
const bigrams = new Map();
for (let i = 0; i + 1 < bars; i++) { const k = sigs[i] + '|' + sigs[i + 1]; bigrams.set(k, (bigrams.get(k) ?? 0) + 1); }
const rep2 = [...bigrams.values()].filter((v) => v > 1).reduce((s, v) => s + v - 1, 0);
// 音程直方图熵（越大越丰富）
const hist = new Map();
for (const x of intervals) hist.set(x, (hist.get(x) ?? 0) + 1);
const total = intervals.length;
let H = 0;
for (const v of hist.values()) { const p = v / total; H -= p * Math.log2(p); }
const leaps = intervals.filter((x) => x >= 5).length;
console.log(JSON.stringify({
  style: plan.styleId, bars, seed, channel: real ? 'typesafe(jev-1.13)' : 'fixture',
  melody_unique_bars: `${uniq.size}/${bars}`,
  melody_adjacent_repeat: adjMel,
  melody_2gram_repeat: rep2,
  lh_unique_bars: `${uniqLh.size}/${bars}`,
  lh_adjacent_repeat: adjLh,
  unique_chords: uniqChord.size,
  chord_seq: chords.join(' '),
  interval_entropy: +H.toFixed(2),
  leap_ratio: `${((leaps / total) * 100).toFixed(0)}%`,
  rh_notes_per_bar: +(onsets.reduce((s, x) => s + x, 0) / bars).toFixed(1),
}, null, 1));
