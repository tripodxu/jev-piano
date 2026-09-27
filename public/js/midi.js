// midi.js — 标准 MIDI 文件（SMF Type-1）导出：track0 速度/拍号，track1 右手，track2 左手。
// records = [{midi, startBeats(绝对拍), durBeats, vel(0..1), hand:'R'|'L'}]

export const TPQN = 480; // ticks per quarter note

/** MIDI 变长数量编码 */
export function vlq(n) {
  n = Math.max(0, Math.round(n));
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];

/** 一串 (tick, 状态字节, 音高, 力度) → delta 编码的音轨字节 */
function trackBytes(events) {
  events.sort((a, b) => a.tick - b.tick || a.status - b.status || a.midi - b.midi); // 同 tick 先 off(0x80) 后 on(0x90)
  const out = [];
  let last = 0;
  for (const ev of events) {
    out.push(...vlq(ev.tick - last), ev.status, ev.midi & 127, ev.vel);
    last = ev.tick;
  }
  out.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  return out;
}

export function exportMidi(records, { bpm = 90, meterNum = 4 } = {}) {
  const byHand = { R: [], L: [] };
  for (const r of records) {
    const hand = r.hand === 'L' ? 'L' : 'R';
    const onTick = Math.round(r.startBeats * TPQN);
    const offTick = Math.max(onTick + 1, Math.round((r.startBeats + r.durBeats) * TPQN));
    byHand[hand].push({ tick: onTick, status: 0x90, midi: r.midi, vel: Math.max(1, Math.min(127, Math.round(r.vel * 127))) });
    byHand[hand].push({ tick: offTick, status: 0x80, midi: r.midi, vel: 0 });
  }
  const usPerQuarter = Math.round(60000000 / bpm);
  const meta = [
    ...vlq(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255,
    ...vlq(0), 0xff, 0x58, 0x04, meterNum & 255, 0x02, 0x18, 0x08,
    ...vlq(0), 0xff, 0x2f, 0x00,
  ];
  const tracks = [meta, trackBytes(byHand.R), trackBytes(byHand.L)];
  const size = 14 + tracks.reduce((s, t) => s + 8 + t.length, 0);
  const bytes = new Uint8Array(size);
  let o = 0;
  bytes.set([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(3), ...u16(TPQN)], o); o += 14; // MThd
  for (const t of tracks) {
    bytes.set([0x4d, 0x54, 0x72, 0x6b, ...u32(t.length)], o); o += 8; // MTrk
    bytes.set(t, o); o += t.length;
  }
  return bytes;
}
