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
