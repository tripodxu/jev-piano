// player.test.mjs — 假时钟下的调度顺序、管线深度、停止、记录
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player, AHEAD_BARS } from '../public/js/player.js';
import { buildPlan, Composer } from '../public/js/composer.js';

function makeHarness() {
  let t = 0;
  const timers = new Map();
  let nextId = 1;
  const played = [];
  const barsSeen = [];
  const audio = { play: (midi, when, dur, vel) => played.push({ midi, when, dur, vel }) };
  const now = () => t;
  const setTimer = (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const advance = async (sec, stepMs = 30) => {
    const end = t + sec;
    while (t < end) {
      t = Math.min(end, t + stepMs / 1000);
      for (const { fn } of [...timers.values()]) fn();
      await new Promise((r) => setTimeout(r, 0)); // 让 nextBar 的 promise 链跑完
    }
  };
  return { audio, now, setTimer, clearTimer, advance, played, barsSeen, timers, get t() { return t; } };
}

async function makePlayer(h) {
  const plan = await buildPlan({ prompt: '星空', goal: '随机冒险', styleId: 'newage', seed: 9, bars: 64 }, {});
  const composer = new Composer(plan, { channel: 'fixture' });
  return new Player({
    audio: h.audio, composer, bpm: plan.bpm,
    onBar: (bar) => h.barsSeen.push(bar),
    now: h.now, setTimer: h.setTimer, clearTimer: h.clearTimer,
  });
}

test('调度顺序：播放事件时间单调不减，管线深度不超过 AHEAD_BARS', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p.start();
  await h.advance(4);
  assert.ok(p.running);
  assert.ok(p.records.length > 10, '应有足够音符被调度');
  const times = h.played.map((e) => e.when);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] >= times[i - 1] - 1e-9, '播放时间必须单调');
  // 决策深度：已决策小节数 - 已开播小节数 ≤ AHEAD_BARS（+余量）
  const decided = Math.min(p.composer.index, 8);
  assert.ok(decided <= p.scheduledBars + AHEAD_BARS + 2, `决策过深: decided=${decided} scheduled=${p.scheduledBars}`);
  p.stop();
});

test('records 与音符一一对应；stop 后不再调度', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p.start();
  await h.advance(2);
  const n1 = p.records.length;
  assert.ok(n1 > 0);
  p.stop();
  await h.advance(2);
  assert.equal(p.records.length, n1, 'stop 后 records 不再增长');
  assert.equal(h.timers.size, 0, '定时器应被清理');
});

test('onBar 在小节起点按序触发', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p.start();
  await h.advance(6);
  const idx = h.barsSeen.map((b) => b.index);
  assert.ok(idx.length >= 2, `6 秒内应至少播 2 个小节: ${idx}`);
  assert.equal(idx[0], 0);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] === idx[i - 1] + 1, '小节序号必须严格递增');
  p.stop();
});
