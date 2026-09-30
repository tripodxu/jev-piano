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

/* ---------------- voices 生命周期（轮次 32）：事件驱动清理，不依赖 setTimeout ---------------- */

/** 最小 AudioContext mock：节点可寻址，stop() 不自动触发 onended（由测试手动触发） */
function mockCtx() {
  const nodes = [];
  const mk = (extra = {}) => ({
    connect() {}, start() {}, stop() {},
    gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
    frequency: { value: 0 }, Q: { value: 0 }, type: '', ...extra,
  });
  return {
    currentTime: 0, sampleRate: 44100, destination: {}, nodes,
    createGain: () => { const n = mk(); nodes.push(n); return n; },
    createBiquadFilter: () => { const n = mk(); nodes.push(n); return n; },
    createOscillator: () => { const n = mk(); nodes.push(n); return n; },
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

test('voices 清理：oscillator onended 触发时移除 voice（后台标签页下不再靠定时器与 32 上限硬挤）', async () => {
  const { PianoAudio } = await import('../public/js/audio.js');
  const a = new PianoAudio();
  a.ctx = mockCtx();
  a.play(60, 0, 1, 0.8);
  a.play(64, 0.5, 1, 0.8);
  assert.equal(a.voices.length, 2, '两个音各占一个 voice');
  const triangle = a.ctx.nodes.filter((n) => n.type === 'triangle');
  assert.equal(triangle.length, 2, '每音一个三角波主振荡器');
  triangle[0].onended(); // 主振荡器 stop 到点 → 事件驱动移除对应 voice
  assert.equal(a.voices.length, 1, 'onended 后对应 voice 被移除');
  assert.equal(a.voices[0].midi, 64, '剩下的是第二个音');
  triangle[1].onended();
  assert.equal(a.voices.length, 0);
});
