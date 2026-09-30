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
  await h.advance(7); // 64 BPM 下一小节约 3.7s，取 7s 保证至少两个小节
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

test('暂停/继续：暂停时不调度，恢复后继续', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p.start();
  await h.advance(1.5);
  p.pause(true);
  assert.equal(p.paused, true);
  const frozen = p.records.length;
  await h.advance(2); // 定时器已清空，records 不再增长
  assert.equal(p.records.length, frozen, '暂停期间不应有新音符');
  p.pause(false);
  await h.advance(2);
  assert.ok(p.records.length > frozen, '恢复后应继续调度');
  p.stop();
  assert.equal(p.paused, false, 'stop 应解除暂停态');
});

/* ---------------- 速度弧线（轮次 20）：每小节乘数 + 顺序游标 ---------------- */

test('速度弧线：B 段小节更短，游标按小节累计且单调', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h); // 星空→newage·arch·64 小节：A(0-15 flat) B(16-31 arch)
  p._t0 = 100; p._cursorBeat = 0; p._cursorSec = 100;
  for (let i = 0; i <= 17; i++) p._enqueueBar({ index: i, notes: [] });
  const marks = p.barMarks.map((m) => m.t);
  const barLen = p.meterNum * p.secPerBeat;
  assert.ok(Math.abs(marks[0] - 100) < 1e-9, '首小节从 _t0 起');
  for (let i = 1; i <= 16; i++) assert.ok(Math.abs(marks[i] - marks[i - 1] - barLen) < 1e-9, 'A 段恒定时长');
  assert.ok(marks[17] - marks[16] < barLen - 1e-9, 'bar 16 在 B 段（1.04）应更短');
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i] > marks[i - 1], '小节起点必须严格递增');
});

test('乱序入队回退线性映射，不崩溃', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p._t0 = 50;
  p._enqueueBar({ index: 3, notes: [] }); // 游标未起（期望 beat 0），实际 beat 12
  const t = p.barMarks[0].t;
  assert.ok(Math.abs(t - (50 + 12 * p.secPerBeat)) < 1e-9, '回退按恒定 secPerBeat 线性映射');
});

/* ---------------- 展示层异常不得中断播放（轮次 47）：调度器免疫 onBar/onNote 抛错 ---------------- */

test('onBar 回调抛异常：调度器继续推进，后续小节照常调度', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p.onBarCb = (bar) => { h.barsSeen.push(bar); if (bar.index >= 1) throw new Error('展示层炸了'); }; // 先记录再抛（第 2 小节起必炸）
  p.start();
  await h.advance(9);
  assert.ok(p.running, '播放器必须还在运行');
  assert.ok(p.records.length > 0, '音符调度不受影响');
  const idx = h.barsSeen.map((b) => b.index);
  assert.ok(idx.length >= 3, `onBar 抛错后应继续触发后续小节: ${idx.length}`);
  p.stop();
});

test('onNote/audio.play 抛异常：不中断排程循环', async () => {
  const h = await makeHarness();
  const p = await makePlayer(h);
  p.audio.play = () => { throw new Error('音频节点炸了'); };
  p.start();
  await h.advance(9);
  assert.ok(p.running);
  assert.ok(p.records.length > 0, 'records 照常记录');
  p.stop();
});
