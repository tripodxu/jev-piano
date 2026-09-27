// audio.test.mjs — 可纯测的声学参数
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envFor } from '../public/js/audio.js';

test('envFor: 高音衰减更快、力度抬亮滤波、峰值随力度单调', () => {
  const low = envFor(36, 0.5, 0.5);
  const high = envFor(84, 0.5, 0.5);
  assert.ok(high.decay < low.decay, '高音衰减应更短');

  const soft = envFor(60, 0.2, 0.5);
  const loud = envFor(60, 1, 0.5);
  assert.ok(loud.cutoff > soft.cutoff, '力度应抬亮低通截止');
  assert.ok(loud.peak > soft.peak, '力度应抬高峰值');

  // 单调性扫一遍
  let prev = 0;
  for (let v = 0; v <= 1.001; v += 0.1) {
    const e = envFor(60, v, 0.5);
    assert.ok(e.peak >= prev - 1e-9);
    prev = e.peak;
  }
  assert.ok(low.release === high.release);
});
