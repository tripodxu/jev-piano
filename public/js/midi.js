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

/** 一串 (tick, 状态字节, 音高, 力度[, prio]) → delta 编码的音轨字节。
 *  prio 允许同 tick 自定义次序（踏板序列要排在音符之前）；不带 prio 时行为与旧版逐位一致 */
function trackBytes(events) {
  events.sort((a, b) => a.tick - b.tick || (a.prio ?? a.status) - (b.prio ?? b.status) || a.status - b.status || a.midi - b.midi);
  const out = [];
  let last = 0;
  for (const ev of events) {
    out.push(...vlq(ev.tick - last), ev.status, ev.midi & 127, ev.vel);
    last = ev.tick;
  }
  out.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  return out;
}

const clampMult = (m) => Math.min(2, Math.max(0.5, Number(m) || 1));

/**
 * exportMidi(records, { bpm, meterNum, tempoMults })
 * tempoMults：每小节一个速度乘数（来自 candidates.tempoMultAt 的速度弧线）。
 * 省略时与旧版字节逐位一致；给定时在 track0 按小节写 set_tempo（FF 51），
 * plateau（与上一小节同乘数）不重复写，文件更小。
 */
export function exportMidi(records, { bpm = 90, meterNum = 4, tempoMults = null, pedalBars = null } = {}) {
  const byHand = { R: [], L: [] };
  for (const r of records) {
    const hand = r.hand === 'L' ? 'L' : 'R';
    const onTick = Math.round(r.startBeats * TPQN);
    const offTick = Math.max(onTick + 1, Math.round((r.startBeats + r.durBeats) * TPQN));
    byHand[hand].push({ tick: onTick, status: 0x90, midi: r.midi, vel: Math.max(1, Math.min(127, Math.round(r.vel * 127))) });
    byHand[hand].push({ tick: offTick, status: 0x80, midi: r.midi, vel: 0 });
  }
  // sustain 踏板（轮次 39）：每个和声变化处松踏→立即重踏（钢琴家的标准换踏动作）。
  // prio 让同 tick 的次序为 off(0x80) < cc松 < cc踏 < on(0x90)——共鸣先释放再重建，音符最后进来。
  if (Array.isArray(pedalBars)) {
    byHand.R.push(...pedalBars.flatMap((bar, idx) => {
      const tick = bar * meterNum * TPQN;
      const ev = [{ tick, status: 0xB0, prio: 0x86, midi: 64, vel: 127 }];
      if (idx > 0) ev.unshift({ tick, status: 0xB0, prio: 0x85, midi: 64, vel: 0 });
      return ev;
    }));
  }
  const tempoBytes = (us) => [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  const m0 = Array.isArray(tempoMults) && Number.isFinite(tempoMults[0]) ? clampMult(tempoMults[0]) : 1;
  const meta = [
    { tick: 0, bytes: tempoBytes(Math.round(60000000 / (bpm * m0))) },
    { tick: 0, bytes: [0xff, 0x58, 0x04, meterNum & 255, 0x02, 0x18, 0x08] },
  ];
  if (Array.isArray(tempoMults)) {
    let prev = m0;
    for (let bar = 1; bar < tempoMults.length; bar++) {
      const m = clampMult(tempoMults[bar]);
      if (m !== prev) meta.push({ tick: bar * meterNum * TPQN, bytes: tempoBytes(Math.round(60000000 / (bpm * m))) });
      prev = m;
    }
  }
  meta.sort((a, b) => a.tick - b.tick);
  const metaBytes = [];
  let last = 0;
  for (const ev of meta) { metaBytes.push(...vlq(ev.tick - last), ...ev.bytes); last = ev.tick; }
  metaBytes.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  const tracks = [metaBytes, trackBytes(byHand.R), trackBytes(byHand.L)];
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
