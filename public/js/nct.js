// nct.js — 非和声音分析：把「旋律音与当前和弦的关系」变成可测可看的数。
// 分析层：**只读**已生成的小节，不参与决策（与 tension.js 同级、同样无决策耦合）。
// 分类判据取自 Kostka-Payne《Tonal Harmony》——按音的「进出方式」区分非和声音，
// 而不是只做「在不在和弦里」的二分：经过音、邻音、倚音在听感上含义完全不同。
import { chordPcs } from './music.js';

/** 分类的中文名（文字通道，不依赖颜色——曲线/标记都必须有非颜色的读法） */
export const NCT_ZH = { chord: '和弦音', passing: '经过音', neighbor: '邻音', appoggiatura: '倚音', other: '非和弦' };

const pcOf = (midi) => ((Math.round(midi) % 12) + 12) % 12;

/**
 * 单个旋律音的分类。pc 传**音级类**（0..11），不是 midi。
 * 判定顺序：先看是不是和弦音（是就到此为止），再按进出方式分非和弦音。
 * 首尾音没有邻居可依，一律 other——把「4→5」判成经过音是错的，那只是半个经过音。
 */
export function classifyNote(prevPc, pc, nextPc, chordTones) {
  if (!chordTones || typeof chordTones.has !== 'function') return 'other';
  if (!Number.isFinite(pc)) return 'other';
  if (chordTones.has(pc)) return 'chord';
  if (!Number.isFinite(prevPc) || !Number.isFinite(nextPc)) return 'other';
  const d1 = pc - prevPc, d2 = nextPc - pc;
  if (Math.abs(d1) <= 2 && Math.abs(d2) <= 2) return Math.sign(d1) === Math.sign(d2) ? 'passing' : 'neighbor';
  if (Math.abs(d2) <= 2 && d2 < 0) return 'appoggiatura';   // 跳进、级进下行解决
  return 'other';
}

/** 单小节的和声契合度：{kinds 每音分类, fit 和弦音占比 0..1, nct 非和声音数} */
export function barHarmonyFit(bar) {
  if (!bar || !Array.isArray(bar.notes) || !bar.chord) return { kinds: [], fit: 0, nct: 0 };
  const tones = new Set(chordPcs(bar.chord.rootPc ?? 0, bar.chord.shape ?? ''));
  const mel = bar.notes.filter((n) => n.hand === 'R').sort((a, b) => a.startBeats - b.startBeats);
  if (!mel.length) return { kinds: [], fit: 1, nct: 0 };
  const kinds = mel.map((n, k) => classifyNote(
    mel[k - 1] ? pcOf(mel[k - 1].midi) : null,
    pcOf(n.midi),
    mel[k + 1] ? pcOf(mel[k + 1].midi) : null,
    tones,
  ));
  const chordCount = kinds.filter((t) => t === 'chord').length;
  return { kinds, fit: chordCount / kinds.length, nct: kinds.length - chordCount };
}

/** 跨小节汇总（用于给用户一个可读的百分比） */
export function harmonySummary(bars) {
  if (!Array.isArray(bars) || !bars.length) return { total: 0, chord: 0, nct: 0, fit: 1, kinds: {} };
  const kinds = {};
  let chord = 0, total = 0;
  for (const b of bars) {
    for (const t of barHarmonyFit(b).kinds) { kinds[t] = (kinds[t] ?? 0) + 1; total++; if (t === 'chord') chord++; }
  }
  return { total, chord, nct: total - chord, fit: total ? chord / total : 1, kinds };
}
