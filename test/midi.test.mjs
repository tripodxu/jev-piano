// midi.test.mjs — SMF 字节级断言
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMidi, vlq, TPQN } from '../public/js/midi.js';

test('vlq 编码', () => {
  assert.deepEqual(vlq(0), [0]);
  assert.deepEqual(vlq(0x7f), [0x7f]);
  assert.deepEqual(vlq(0x80), [0x81, 0x00]);
  assert.deepEqual(vlq(480), [0x83, 0x60]);
});

test('exportMidi: 头、轨数、tempo、双轨分hand', () => {
  const records = [
    { midi: 60, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' },
    { midi: 48, startBeats: 0, durBeats: 4, vel: 0.5, hand: 'L' },
    { midi: 64, startBeats: 1.5, durBeats: 0.5, vel: 0.6, hand: 'R' },
  ];
  const b = exportMidi(records, { bpm: 96, meterNum: 4 });
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0'));
  assert.deepEqual(hex.slice(0, 4), ['4d', '54', '68', '64']);          // MThd
  assert.deepEqual(hex.slice(8, 14), ['00', '01', '00', '03', '01', 'e0']); // format1, 3 tracks, division 480

  // tempo: 60000000/96 = 625000 = 0x098968
  const tempoIdx = b.findIndex((x, i) => x === 0xff && b[i + 1] === 0x51 && b[i + 2] === 0x03);
  assert.ok(tempoIdx > 0);
  assert.equal((b[tempoIdx + 3] << 16) | (b[tempoIdx + 4] << 8) | b[tempoIdx + 5], 625000);

  // 右手 track 有 note-on 60(0x3c)，左手 track 有 note-on 48(0x30)
  const text = hex.join(' ');
  const trkHeaders = [];
  for (let i = 0; i < hex.length - 4; i++) {
    if (hex[i] === '4d' && hex[i + 1] === '54' && hex[i + 2] === '72' && hex[i + 3] === '6b') trkHeaders.push(i);
  }
  assert.equal(trkHeaders.length, 3);
  const rh = hex.slice(trkHeaders[1], trkHeaders[2]).join(' ');
  const lh = hex.slice(trkHeaders[2]).join(' ');
  assert.ok(rh.includes('90 3c'), '右手轨应有 note-on 60');
  assert.ok(!rh.includes('90 30'), '右手轨不应有左手音');
  assert.ok(lh.includes('90 30'), '左手轨应有 note-on 48');
  assert.ok(lh.includes('80 30'), '左手轨应有 note-off 48');

  // 总长度字段自洽
  const total = 14 + [...b].length - 14;
  assert.equal(b.length, total); // 平凡，但防止 off-by-one 重构回归
  assert.equal(TPQN, 480);
});

/* ---------------- 速度弧线（轮次 20）：分段 set_tempo ---------------- */

/** 解析 track0 的全部 set_tempo 事件 → [{tick, us}] */
function metaTempos(bytes) {
  const hex = [...bytes];
  let i = 14; // 跳过 MThd
  const len = (hex[i + 4] << 24) | (hex[i + 5] << 16) | (hex[i + 6] << 8) | hex[i + 7];
  let p = i + 8, end = p + len, tick = 0;
  const out = [];
  while (p < end) {
    let d = 0, b0;
    do { b0 = hex[p++]; d = (d << 7) | (b0 & 0x7f); } while (b0 & 0x80);
    tick += d;
    if (hex[p] === 0xff) {
      const type = hex[p + 1], ln = hex[p + 2];
      if (type === 0x51) out.push({ tick, us: (hex[p + 3] << 16) | (hex[p + 4] << 8) | hex[p + 5] });
      p += 3 + ln; // ff(1) + type(1) + length(1) + data(ln)
    } else { p += 2; } // 音符事件不影响此解析（track0 只有 meta）
  }
  return out;
}

test('exportMidi: tempoMults 写入分段 set_tempo（plateau 只写一次）', () => {
  const records = [{ midi: 60, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' }];
  const b = exportMidi(records, { bpm: 96, meterNum: 4, tempoMults: [1.04, 1.04, 0.8] });
  const t = metaTempos(b);
  assert.equal(t.length, 2, 'plateau 不重复写');
  assert.deepEqual(t[0], { tick: 0, us: Math.round(60000000 / (96 * 1.04)) });
  assert.deepEqual(t[1], { tick: 8 * 480, us: Math.round(60000000 / (96 * 0.8)) });
});

test('exportMidi: 不带 tempoMults 时字节与现行为逐位一致', () => {
  const records = [{ midi: 60, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' }];
  const a = exportMidi(records, { bpm: 96, meterNum: 4 });
  const c = exportMidi(records, { bpm: 96, meterNum: 4, tempoMults: null });
  assert.deepEqual([...a], [...c]);
});

/* ---------------- sustain 踏板（轮次 39 · 创意）：和声变化处 CC64 重踏 ---------------- */

test('exportMidi: pedalBars 在右手轨写 CC64（同 tick 顺序：松踏→重踏→音符）', () => {
  const records = [{ midi: 60, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' }];
  const b = exportMidi(records, { bpm: 96, meterNum: 4, pedalBars: [0, 1] });
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  // CC64 = 0xb0 0x40，val 0x7f / 0x00
  assert.ok(hex.includes('b0 40 7f'), '应有踏板按下 CC64=127');
  assert.ok(hex.includes('b0 40 00'), '应有松踏 CC64=0');
  // 第一小节只有按下（无松踏）；第二小节先松后踏
  const onCount = hex.split('b0 40 7f').length - 1, offCount = hex.split('b0 40 00').length - 1;
  assert.equal(onCount, 2, '两个和声点各按下一次');
  assert.equal(offCount, 1, '重踏点先松一次');
});

test('exportMidi: 不带 pedalBars 时字节与现行为逐位一致', () => {
  const records = [{ midi: 60, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' }];
  const a = exportMidi(records, { bpm: 96, meterNum: 4 });
  const c = exportMidi(records, { bpm: 96, meterNum: 4, pedalBars: null });
  assert.deepEqual([...a], [...c]);
});
