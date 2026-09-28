// nct.test.mjs — 非和声音分类（Kostka-Payne《Tonal Harmony》的标准判据）
// 锁住的是「分类不能乱判」：判错一个音，契合度读数就没有意义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNote, barHarmonyFit, NCT_ZH, harmonySummary } from '../public/js/nct.js';

test('classifyNote: 和弦音 / 经过音 / 邻音 / 倚音 的标准判据', () => {
  const C = new Set([0, 4, 7]);           // C 大三和弦
  assert.equal(classifyNote(0, 4, 7, C), 'chord', '和弦音');
  assert.equal(classifyNote(4, 5, 7, C), 'passing', '4→5→7 同向上行级进 = 经过音');
  assert.equal(classifyNote(4, 5, 4, C), 'neighbor', '4→5→4 折返 = 邻音');
  assert.equal(classifyNote(0, 8, 7, C), 'appoggiatura', '跳进到 8 再级进下行解到 7 = 倚音');
  assert.equal(classifyNote(0, 10, 4, C), 'other', '其余归 other');
  assert.equal(classifyNote(7, 0, 4, C), 'chord', '即使下行且是和弦音也优先判 chord');
});

test('classifyNote: 首尾音没有邻居时不得误判为经过/邻音', () => {
  const C = new Set([0, 4, 7]);
  assert.equal(classifyNote(null, 5, 7, C), 'other', '缺前邻 → other');
  assert.equal(classifyNote(4, 5, null, C), 'other', '缺后邻 → other');
  assert.equal(classifyNote(undefined, undefined, undefined, C), 'other');
});

test('classifyNote: 脏输入降级为 other，绝不抛错（分析层不能打断播放）', () => {
  const C = new Set([0, 4, 7]);
  for (const bad of [null, undefined, 0, 'x', [], {}]) {
    const t = classifyNote(0, 4, 7, bad);
    assert.equal(t, 'other', `脏和弦集 ${String(bad)} 应降级为 other，实际 ${t}`);
  }
});

test('barHarmonyFit: fit 恒在 0..1，空旋律按 1（无旋律即无不适）处理', () => {
  const bar = {
    chord: { rootPc: 0, shape: '' },
    notes: [
      { midi: 60, hand: 'R', startBeats: 0, durBeats: 1, vel: 0.5 },
      { midi: 64, hand: 'R', startBeats: 1, durBeats: 1, vel: 0.5 },
      { midi: 61, hand: 'R', startBeats: 2, durBeats: 1, vel: 0.5 },
    ],
  };
  const f = barHarmonyFit(bar);
  assert.equal(f.kinds.length, 3, 'kinds 与旋律音数一致');
  assert.ok(f.fit > 0.6 && f.fit <= 1, `fit=${f.fit}`);
  assert.equal(f.nct, 1, '61(C#) 不在 C 大三和弦里');
  assert.equal(barHarmonyFit({ chord: { rootPc: 0, shape: '' }, notes: [] }).fit, 1);
  assert.equal(barHarmonyFit(null).fit, 0, '脏输入返回 0 而不是崩');
});

test('barHarmonyFit: 左手不参与分类（只分析旋律）', () => {
  const bar = {
    chord: { rootPc: 0, shape: '' },
    notes: [
      { midi: 60, hand: 'R', startBeats: 0, durBeats: 1, vel: 0.5 },
      { midi: 36, hand: 'L', startBeats: 0, durBeats: 2, vel: 0.5 },
    ],
  };
  assert.equal(barHarmonyFit(bar).kinds.length, 1, '只有右手一个音参与');
});

test('harmonySummary: 汇总分布且归一（用于给用户一个可读的百分比）', () => {
  const bars = [
    { chord: { rootPc: 0, shape: '' }, notes: [
      { midi: 60, hand: 'R', startBeats: 0, durBeats: 1, vel: .5 },
      { midi: 64, hand: 'R', startBeats: 1, durBeats: 1, vel: .5 },
    ] },
    { chord: { rootPc: 0, shape: '' }, notes: [
      { midi: 61, hand: 'R', startBeats: 0, durBeats: 1, vel: .5 },
    ] },
  ];
  const s = harmonySummary(bars);
  assert.equal(s.total, 3);
  assert.equal(s.chord, 2);
  assert.equal(s.nct, 1);
  assert.ok(Math.abs(s.fit - 2 / 3) < 1e-9, `fit=${s.fit}`);
  assert.equal(harmonySummary(null).total, 0, '脏输入不崩');
  assert.equal(harmonySummary([]).fit, 1, '空集合按「无不适」处理');
});

test('NCT_ZH: 五类都有中文名（文字通道，不依赖颜色）', () => {
  for (const k of ['chord', 'passing', 'neighbor', 'appoggiatura', 'other']) {
    assert.ok(NCT_ZH[k], `缺 ${k} 的中文名`);
  }
  assert.equal(NCT_ZH.chord, '和弦音', '和弦音是主体，不是「无」');
});
