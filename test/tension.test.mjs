// tension.test.mjs — 张力分析层：形状排序正确、区间有界、平滑不吞数据、脏输入不抛错。
// 锁住的核心是"它测的是张力不是强度"——若哪天相关性趋近 1，这层就失去存在意义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeTension, barTension, tensionSeries, smooth, tensionStats, FUNCTION_TENSION } from '../public/js/tension.js';
import { planTargetSeries, deriveSections } from '../public/js/candidates.js';

const bar = (over = {}) => ({
  chord: { rootPc: 0, shape: '', symbol: 'C' },
  intensity: 1,
  decision: { chordFn: 'T' },
  notes: [
    { midi: 48, hand: 'L', startBeats: 0, durBeats: 2, vel: 0.5 },
    { midi: 72, hand: 'R', startBeats: 0, durBeats: 1, vel: 0.6 },
  ],
  ...over,
});

test('shapeTension: 排序符合乐理直觉（三和弦 < 七和弦 < 减/半减）', () => {
  assert.ok(shapeTension('') < shapeTension('7'), '大三 < 属七');
  assert.ok(shapeTension('') < shapeTension('m7'), '大三 < 小七');
  assert.ok(shapeTension('7') < shapeTension('dim'), '属七 < 减三和弦');
  assert.ok(shapeTension('m7') < shapeTension('m7b5'), '小七 < 半减七（最紧）');
  assert.ok(shapeTension('m7b5') > shapeTension('dim'), '半减七是最紧的');
  // 小七大七：M7 明显比 m7 紧
  assert.ok(shapeTension('maj7') > shapeTension('m7'), '大七 > 小七');
  // 全部形状有界
  for (const s of ['', 'm', 'dim', 'aug', '7', 'm7', 'maj7', 'm7b5', '9', 'm9', 'maj9', '6', 'm6', 'sus4', '7sus4', 'add9']) {
    const v = shapeTension(s);
    assert.ok(v >= 0 && v <= 1, `shape ${s} => ${v} 越界`);
  }
  assert.equal(shapeTension('不存在的形状'), shapeTension(''), '未知形状退化为大三');
});

test('barTension: 五个分量单调可分辨，且恒在 0..1', () => {
  const base = barTension(bar());
  // 功能：属 > 主
  assert.ok(barTension(bar({ decision: { chordFn: 'D' } })) > base, '属功能比主功能紧');
  // 和声：m7b5 > 三和弦
  assert.ok(barTension(bar({ chord: { rootPc: 2, shape: 'm7b5' } })) > base, '半减比三和弦紧');
  // 音域：摊得越开越紧
  const wide = barTension(bar({ notes: [{ midi: 36, hand: 'L' }, { midi: 84, hand: 'R' }] }));
  assert.ok(wide > base, '音域跨 48 半音更紧');
  // 密度：右手音越多越紧
  const dense = barTension(bar({ notes: Array.from({ length: 8 }, (_, i) => ({ midi: 60 + i, hand: 'R' })) }));
  assert.ok(dense > base, '8 个右手音比 2 个紧');
  // 力度
  assert.ok(barTension(bar({ intensity: 3 })) > barTension(bar({ intensity: 0 })), '力度 3 比力度 0 紧');
  for (const b of [bar(), bar({ intensity: 3 }), bar({ chord: { shape: 'm7b5' }, decision: { chordFn: 'D' }, intensity: 3 })]) {
    const v = barTension(b);
    assert.ok(v >= 0 && v <= 1, `${v} 越界`);
  }
});

test('barTension: 脏输入降级为中性值，绝不抛错（分析层不能打断播放）', () => {
  for (const bad of [null, undefined, {}, { notes: null }, { notes: 'x' }, { notes: [{ hand: 'R' }] }]) {
    const v = barTension(bad);
    assert.ok(Number.isFinite(v), `${JSON.stringify(bad)} => ${v}`);
    assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(barTension({ notes: [] }), 0, '空小节张力为 0');
});

test('barTension: 同一小节的不同功能有严格次序 T < Tp < S < D', () => {
  const at = (fn) => barTension(bar({ decision: { chordFn: fn } }));
  assert.ok(at('T') < at('Tp') && at('Tp') < at('S') && at('S') < at('D'), '功能张力次序不对');
  assert.deepEqual(Object.keys(FUNCTION_TENSION).sort(), ['D', 'S', 'T', 'Tp']);
});

test('tensionSeries / tensionStats: 逐小节对应，统计量自洽', () => {
  const bars = [bar(), bar({ decision: { chordFn: 'D' } }), bar({ chord: { rootPc: 2, shape: 'm7b5' }, decision: { chordFn: 'D' }, intensity: 3 })];
  const s = tensionSeries(bars);
  assert.equal(s.length, 3);
  assert.ok(s[2] > s[1] && s[1] > s[0], '序列应单调可比');
  const st = tensionStats(s);
  assert.ok(st.max >= st.mean && st.mean >= st.min, '统计量次序不对');
  assert.ok(Math.abs(st.span - (st.max - st.min)) < 1e-9, 'span 应等于 max-min');
  assert.deepEqual(tensionStats([]), { mean: 0, max: 0, min: 0, span: 0 }, '空序列不应崩');
});

test('planTargetSeries: 段落感知且归一到 0..1（张力带的幽灵线必须与音乐同源）', () => {
  const plan = { arc: 'arch', totalBars: 32, barsPerPhrase: 8, sections: deriveSections('arch', 32) };
  const s = planTargetSeries(plan, 8);
  assert.equal(s.length, 32);
  for (const v of s) assert.ok(v >= 0 && v <= 1, `${v} 越界`);
  // B 段（8..15）应明显高于 Coda（24..31）
  const bMax = Math.max(...s.slice(8, 16));
  const codaMax = Math.max(...s.slice(24, 32));
  assert.ok(bMax > codaMax, `B 段 ${bMax.toFixed(2)} 应高于 Coda ${codaMax.toFixed(2)}`);
  // 乐句尾有下陷
  assert.ok(s[7] < s[6], '第 8 小节（乐句尾）应比前一小节低');
  // 无 sections 的旧计划仍能工作
  const legacy = planTargetSeries({ arc: 'fall', totalBars: 16 }, 8);
  assert.equal(legacy.length, 16);
  assert.ok(legacy.every((v) => v >= 0 && v <= 1));
});

test('smooth: 端点不丢数据、长度不变、确实降噪', () => {
  const raw = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1];
  const sm = smooth(raw, 3);
  assert.equal(sm.length, raw.length, '长度不变（不能丢小节）');
  const rough = raw.reduce((s, v) => s + Math.abs(v - sm[0]), 0);
  const smoothSpread = sm.reduce((s, v) => s + Math.abs(v - sm[0]), 0);
  assert.ok(smoothSpread < rough, '平滑后总偏移应变小');
  assert.deepEqual(smooth(raw, 1), raw, 'win<2 时原样返回');
  assert.deepEqual(smooth([]), [], '空数组不崩');
  assert.ok(Number.isFinite(smooth([0.2])[0]), '单元素不崩');
});
