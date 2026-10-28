// keysync.test.mjs — 琴键视觉与音频时钟的同步契约（轮次 71）。
//
// 为什么值得单独立一份测试：旧实现（main.js 的 setTimeout + ui.js 的 flash）的偏差是
// **渐进且隐形**的——偶发几十毫秒，人耳未必察觉，但连奏会累积、卡顿会放大。
// 这类问题不会自己报错，只能靠"把时序变成可断言的数字"来守住。
// 全部用假时钟：把音频时钟当成一个可以任意推进的数，逐毫秒验证亮灭时刻。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeySync, KEY_TICK_MS, WAKE_MAX_MS } from '../public/js/keysync.js';
import { PianoAudio } from '../public/js/audio.js';

/** 假时钟 + 假定时器：完全掌控时间推进，不受真实事件循环影响 */
function harness(latency = () => 0, now0 = 0) {
  let now = now0;
  let timer = null, ticks = 0, lastMs = null;
  const ks = new KeySync({
    clock: () => now,
    latency,
    setTimer: (fn, ms) => { timer = fn; lastMs = ms; return ++ticks; },
    clearTimer: () => { timer = null; },
  });
  return {
    ks,
    get now() { return now; },
    get timer() { return timer; },
    get ticks() { return ticks; },
    get lastMs() { return lastMs; },
    advanceTo(t) { now = t; const f = timer; timer = null; f?.(); },
    /** 逐 tick 推进到 t，模拟真实的 30ms 轮询（不是一步跳过去） */
    runTo(t) { while (now < t && timer) { now = Math.min(t, now + KEY_TICK_MS / 1000); const f = timer; timer = null; f?.(); } now = t; const f = timer; timer = null; f?.(); },
  };
}

test('clock() 必填：没接音频时钟就抛错（不给它静默退化成挂钟的机会）', () => {
  assert.throws(() => new KeySync({}), /clock/);
});

test('基本时序：按下在 onAt、抬起在 offAt，误差为零（不是"大约"）', () => {
  const h = harness();
  const seen = [];
  h.ks.start((ch) => { for (const [m, v] of ch) seen.push([h.now, m, v]); });
  h.ks.schedule(60, 10, 10.5, 0.8);

  h.runTo(9.99);
  assert.equal(seen.length, 0, 'onAt 之前不应亮');

  h.runTo(10);
  assert.deepEqual(seen, [[10, 60, 0.8]], 'onAt 当刻点亮，力度原样传出');

  h.runTo(10.49);
  assert.equal(seen.length, 1, 'offAt 之前不应熄灭');

  h.runTo(10.5);
  assert.deepEqual(seen[1], [10.5, 60, null], 'offAt 当刻熄灭');
});

test('长音：整段持续点亮，不在中途掉（旧实现 80ms 下限会提前灭）', () => {
  const h = harness();
  const seen = [];
  h.ks.start((ch) => { for (const [m, v] of ch) seen.push([h.now, m, v]); });
  h.ks.schedule(48, 10, 14, 0.5); // 4 秒长音（含延音的低音）
  h.runTo(13.9);
  assert.equal(seen.length, 1, '长音期间一次都不该熄灭');
  assert.equal(seen[0][2], 0.5);
  h.runTo(14);
  assert.equal(seen[1][2], null, '到点才灭');
});

test('快速连奏：16 分音符连打同一键——不提前灭、不丢音、顺序不漂移', () => {
  // 直接用纯逻辑推进（不借定时器），逐个音验证"精确在排程时刻亮起"
  const ks = new KeySync({ clock: () => 0 });
  // 0.125s 一个音、每个响 0.2s（故意重叠：后一个音的起在前一个音的止之前）
  for (let i = 0; i < 16; i++) ks.schedule(60, 10 + i * 0.125, 10 + i * 0.125 + 0.2, 0.7);

  for (let i = 0; i < 16; i++) {
    const t = 10 + i * 0.125;
    const ch = ks.advance(t);
    assert.deepEqual([...ch], [[60, 0.7]], `第 ${i + 1} 个音必须在 ${t} 精确点亮（无累积漂移）`);
    assert.equal(ks.active.size, 1, '重叠期间键应持续亮着，不被前一个音的到点熄灭');
  }
  // 全部弹完：最后一个音的 release 走完才灭
  assert.equal(ks.advance(10 + 15 * 0.125 + 0.2 - 0.001).size, 0, '还差 1ms 就不该灭');
  assert.deepEqual([...ks.advance(10 + 15 * 0.125 + 0.2)], [[60, null]], '到点才灭');
});

test('唤醒时刻精确：定时到事件本身，不是固定 30ms 轮询（16 分音符下肉眼可见的差别）', () => {
  const h = harness();
  h.ks.start(() => {});
  h.ks.schedule(60, 10, 10.5, 0.7);
  assert.equal(h.lastMs, WAKE_MAX_MS, '事件还很远 → 睡到上限再复查（防时钟跳变睡死）');

  h.advanceTo(9.95); // 走到只剩 50ms
  assert.ok(Math.abs(h.lastMs - 50) < 1e-6, `临近事件时精确到毫秒——不是一个 tick 的粒度（实 ${h.lastMs}）`);
});

test('力度区分：同一个键轻弹与重弹传出的 vel 不同（视觉强弱与音量同源）', () => {
  const h = harness();
  const seen = [];
  h.ks.start((ch) => { for (const [m, v] of ch) seen.push([h.now, v]); });
  h.ks.schedule(60, 10, 10.2, 0.25);
  h.ks.schedule(60, 11, 11.2, 0.95);
  h.runTo(12);
  assert.equal(seen[0][1], 0.25);
  assert.equal(seen[2][1], 0.95);
});

test('输出延迟补偿：视觉按 latency 提前，与耳朵听到的对齐', () => {
  const h = harness(() => 0.08); // 蓝牙耳机量级的输出延迟
  const seen = [];
  h.ks.start((ch) => { for (const [m, v] of ch) seen.push([Number(h.now.toFixed(4)), v]); });
  h.ks.schedule(60, 10, 10.5, 0.7);
  h.advanceTo(9.92);
  assert.equal(seen[0][0], 9.92, '声音还在路上，视觉必须先动 80ms');
  h.advanceTo(10.42);
  assert.equal(seen[1][0], 10.42);
});

test('大跳（后台节流/卡顿）：过期的不补亮，直接落到当前应有状态', () => {
  const h = harness();
  const seen = [];
  h.ks.start((ch) => { for (const [m, v] of ch) seen.push([h.now, m, v]); });
  h.ks.schedule(60, 10, 10.3, 0.7);
  h.ks.schedule(64, 10.1, 10.4, 0.7);
  h.advanceTo(60); // 一口气睡了 50 秒
  // 两个音都已过期：应直接熄灭/不存在，而不是补一段迟到的动画
  assert.deepEqual(seen, [], '过期的音不该在卡顿后回放一遍');
  assert.equal(h.ks.active.size, 0);
});

test('能耗：没有音符时不起定时器，排了音才起，播完自动停', () => {
  const h = harness();
  h.ks.start(() => {});
  assert.equal(h.timer, null, 'start() 不得起常驻定时器（静止类能耗契约）');

  h.ks.schedule(60, 10, 10.2, 0.7);
  assert.ok(h.timer != null, '排了音才起定时器');

  h.runTo(10.3);
  assert.equal(h.timer, null, '全部播完应自动停机，不留空转的 30ms 轮询');
});

test('stop()/clear()：返回待熄灭的键并清空，停止后不残留', () => {
  const h = harness();
  h.ks.start(() => {});
  h.ks.schedule(60, 10, 12, 0.7);
  h.advanceTo(10.1);
  assert.equal(h.ks.active.size, 1);

  const dying = h.ks.stop();
  assert.deepEqual([...dying.keys()], [60], 'stop 要交出还亮着的键，调用方才能同步灭掉 DOM');
  assert.equal(dying.get(60), null);
  assert.equal(h.ks.active.size, 0);
  assert.equal(h.ks.pending.length, 0);
});

/* ---------------- 与 audio.js 的真实起止对账 ---------------- */

/** 最小 AudioContext mock（沿用 audio.test.mjs 的同款骨架） */
function mockCtx(currentTime = 0) {
  const mk = (extra = {}) => ({
    connect() {}, start() {}, stop() {},
    gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} },
    frequency: { value: 0 }, Q: { value: 0 }, type: '', ...extra,
  });
  return {
    currentTime, sampleRate: 44100, destination: {},
    createGain: mk, createBiquadFilter: mk, createOscillator: mk,
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

test('audio.play 返回真实起止：视觉用它排程才与声音同源', () => {
  const a = new PianoAudio();
  a.ctx = mockCtx(0);
  a.master = { gain: { value: 1 }, connect() {} };
  a.dry = { connect() {} }; a.wet = { connect() {} };

  const v = a.play(60, 10, 1, 0.8);
  assert.ok(v, 'play 必须返回起止，否则视觉只能猜');
  assert.equal(v.t0, 10, '不迟到时起点 = 请求时刻');
  // 终点含 release 尾巴：envFor 的 release = 0.28
  assert.ok(Math.abs(v.offAt - (10 + 1 + 0.28)) < 1e-9, `终点应含 release，实 ${v.offAt}`);
  assert.equal(v.vel, 0.8);
});

test('迟到排程：真实起点被推后，视觉若按请求时刻算就会早亮（这正是旧 bug）', () => {
  const a = new PianoAudio();
  a.ctx = mockCtx(10); // 音频时钟已经走到 10
  a.master = { gain: { value: 1 }, connect() {} };
  a.dry = { connect() {} }; a.wet = { connect() {} };

  const v = a.play(60, 9, 1, 0.8); // 请求排在过去
  assert.ok(v.t0 > 10, `迟到的音应被推到 currentTime+0.005 之后，实 ${v.t0}`);
  assert.notEqual(v.t0, 9, '绝不能按请求时刻发声——否则整小节炸成一片');

  // 视觉用 v.t0 排程 → 与真实发声同一刻
  const h = harness();
  h.ks.start(() => {});
  h.ks.schedule(v.midi, v.t0, v.offAt, v.vel);
  h.runTo(v.t0 + 0.001);
  assert.equal(h.ks.active.size, 1, '琴键亮起的判据是声音的真实起点');
});

test('同一个音：琴键熄灭时刻 = 声音停止时刻（不是音符时值）', () => {
  const a = new PianoAudio();
  a.ctx = mockCtx(0);
  a.master = { gain: { value: 1 }, connect() {} };
  a.dry = { connect() {} }; a.wet = { connect() {} };

  const v = a.play(60, 0, 0.5, 0.6);
  const h = harness();
  h.ks.start(() => {});
  h.ks.schedule(v.midi, v.t0, v.offAt, v.vel);

  h.runTo(0.5); // 音符时值结束
  assert.equal(h.ks.active.size, 1, '时值到了但 release 还在响：键不能灭');

  h.runTo(v.offAt + 0.001);
  assert.equal(h.ks.active.size, 0, 'release 走完才灭');
});
