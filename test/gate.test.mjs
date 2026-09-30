// gate.test.mjs — 回归门的纯逻辑：解析、均值、硬不变量判定（轮次 28 固化）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_CONFIG, parseMetrics, numeratorOf, evaluateGate } from '../scripts/regression-gate.mjs';

const sample = (over = {}) => JSON.stringify({
  style: 'romantic', bars: 32, seed: 2026, channel: 'fixture',
  melody_unique_bars: '32/32', melody_adjacent_repeat: 0, melody_2gram_repeat: 0,
  lh_unique_bars: '31/32', lh_adjacent_repeat: 0,
  unique_chords: 9, chord_seq: 'Cm Fm G', interval_entropy: 2.45, leap_ratio: '20%', rh_notes_per_bar: 4.8,
  ...over,
});

test('parseMetrics: 正常行解析，坏行返回 null 不崩', () => {
  const m = parseMetrics(sample());
  assert.equal(m.unique_chords, 9);
  assert.equal(m.melody_unique_bars, '32/32');
  assert.equal(parseMetrics('not json'), null);
  assert.equal(parseMetrics('{}'), null, '缺关键键视同无效');
  assert.equal(parseMetrics(null), null);
});

test('numeratorOf: "31/32" → 31；脏输入 NaN', () => {
  assert.equal(numeratorOf('31/32'), 31);
  assert.equal(numeratorOf('32/32'), 32);
  assert.ok(Number.isNaN(numeratorOf('x')));
  assert.ok(Number.isNaN(numeratorOf(undefined)));
});

test('evaluateGate: 全绿样例通过，均值按口径计算', () => {
  const results = GATE_CONFIG.seeds.map((seed) => ({ seed, data: parseMetrics(sample({ seed })) }));
  const { ok, failures, means } = evaluateGate(results);
  assert.ok(ok, `应通过: ${failures.join('; ')}`);
  assert.deepEqual(failures, []);
  assert.ok(Math.abs(means.unique_chords - 9) < 1e-9);
  assert.ok(Math.abs(means.melody_unique_bars - 32) < 1e-9);
  assert.ok(Math.abs(means.lh_unique_bars - 31) < 1e-9);
});

test('evaluateGate: 硬不变量违约逐种子点名；软指标均值破线只报一条', () => {
  const results = GATE_CONFIG.seeds.map((seed, i) => ({
    seed,
    data: parseMetrics(sample({ seed, melody_adjacent_repeat: i === 0 ? 1 : 0, unique_chords: 8 })),
  }));
  const { ok, failures } = evaluateGate(results);
  assert.equal(ok, false);
  assert.equal(failures.filter((f) => f.includes('硬不变量')).length, 1, '只有 seed 2026 违约');
  assert.ok(failures.some((f) => f.includes('均值 unique_chords=8.00 低于门槛 8.5')));
});

test('evaluateGate: 种子运行失败计为失败（不静默跳过）', () => {
  const results = GATE_CONFIG.seeds.map((seed, i) => ({ seed, data: i === 3 ? null : parseMetrics(sample({ seed })) }));
  const { ok, failures } = evaluateGate(results);
  assert.equal(ok, false);
  assert.ok(failures.some((f) => f.includes('11/12 个种子')));
});

test('GATE_CONFIG: 门槛与项目校准记录一致（键名对齐数据键；chords 8.5 / entropy 2.30 / unique 28）', () => {
  assert.equal(GATE_CONFIG.mean.unique_chords, 8.5);
  assert.equal(GATE_CONFIG.mean.interval_entropy, 2.3);
  assert.equal(GATE_CONFIG.mean.melody_unique_bars, 28);
  assert.equal(GATE_CONFIG.mean.lh_unique_bars, 28);
  assert.equal(GATE_CONFIG.seeds.length, 12);
  assert.deepEqual(GATE_CONFIG.hard, { melody_adjacent_repeat: 0, lh_adjacent_repeat: 0 });
});
