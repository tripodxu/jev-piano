// studio-core.js — 工作室的纯函数层（轮次 38 从 studio.js 拆出，ADR-0004 每文件 ≤800 行）：
// 确定性编辑变换（量化/加密/稀疏/移调/力度）、自然语言→编辑命令、项目 JSON 校验、
// 时间轴分析（功能/张力）。全部与 DOM 无关、可单测；studio.js 只保留界面、卷帘与回放。
import { chordMidis, scaleMidis, nearest, functionOfPc } from './music.js';
import { barTension } from './tension.js';

export const P_LO = 36, P_HI = 95;
export const SNAP = 0.25;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const snap = (v) => Math.round(v / SNAP) * SNAP;
export const FN_COLOR = { T: '#d8ab5c', S: '#85b8ae', D: '#cf6a58', Tp: '#a8936f' };


/**
 * 把 onset 吸附到网格。strength ∈ [0,1] 支持**部分量化**（DAW 惯例：可以「收一半」而不是二选一）。
 * 只动 onset —— 时长与力度是另外两个独立的编辑维度，量化不该顺手改它们。返回被移动的音符数。
 */
export function quantizeNotes(piece, { grid = 0.25, strength = 1, hands = null } = {}) {
  if (!piece || !Array.isArray(piece.notes) || !piece.notes.length) return 0;
  const g = Math.max(1 / 64, Number(grid) || 0.25);
  const s = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
  if (s === 0) return 0;
  const only = Array.isArray(hands) && hands.length ? new Set(hands) : null;
  let moved = 0;
  for (const n of piece.notes) {
    if (only && !only.has(n.hand)) continue;
    const target = Math.max(0, Math.round(n.startBeats / g) * g);
    const next = Math.max(0, n.startBeats + (target - n.startBeats) * s);
    if (Math.abs(next - n.startBeats) > 1e-9) moved++;
    n.startBeats = next;
  }
  return moved;
}

/* ==================== 纯函数：确定性编辑变换（可单测，与 DOM 无关） ==================== */

/** 找到某拍所在小节的和弦 */
export function chordAt(barChords, beat) {
  let c = null;
  for (const b of barChords) { if (b.startBeat <= beat + 1e-9) c = b; else break; }
  return c;
}

/** 织体加密：先在 ≥1 拍的 onset 缝隙中点插和弦音；若无隙可插（织体已密）则对长音做八度加厚 */
export function densifyHand(piece, hand, limit = 10) {
  const list = piece.notes.filter((n) => n.hand === hand).sort((a, b) => a.startBeats - b.startBeats);
  const scaleP = scaleMidis(piece.plan.keyPc, piece.plan.melodyScale, 40, 92);
  let added = 0;
  for (let i = 1; i < list.length && added < limit; i++) {
    const a = list[i - 1], b = list[i];
    const gap = b.startBeats - a.startBeats;
    if (gap < 1) continue;
    const beat = snap(a.startBeats + gap / 2);
    const chord = chordAt(piece.barChords, beat);
    const pool = chord ? chordMidis(chord.rootPc, chord.shape, 40, 92) : scaleP;
    piece.notes.push({ id: piece.nid++, midi: nearest(a.midi, pool), startBeats: beat, durBeats: Math.min(gap / 2, 1), vel: clamp(a.vel * 0.9, 0.15, 1), hand });
    added++;
  }
  if (added === 0) {
    // 第二阶段：八度加厚——把长音叠一个高八度短音
    const chordPoolAt = (beat) => {
      const chord = chordAt(piece.barChords, beat);
      return chord ? chordMidis(chord.rootPc, chord.shape, 40, 92) : scaleP;
    };
    let doubled = 0;
    for (const n of list) {
      if (doubled >= 6) break;
      if (n.durBeats < 0.5) continue;
      const oct = nearest(n.midi + 12, chordPoolAt(n.startBeats));
      if (oct === n.midi || oct > P_HI) continue;
      piece.notes.push({ id: piece.nid++, midi: oct, startBeats: n.startBeats, durBeats: n.durBeats * 0.5, vel: clamp(n.vel * 0.8, 0.15, 1), hand });
      doubled++;
    }
    added = doubled;
  }
  return added;
}

/** 织体稀疏化：先删非整拍弱位，不够再删非强拍；每小节至少保留一个音 */
export function sparserHand(piece, hand, limit = 12) {
  const meter = piece.plan.meterNum;
  const perBar = new Map();
  for (const n of piece.notes) if (n.hand === hand) {
    const bar = Math.floor(n.startBeats / meter);
    perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
  }
  let removed = 0;
  for (const pass of [0, 1]) {
    for (let i = piece.notes.length - 1; i >= 0 && removed < limit; i--) {
      const n = piece.notes[i];
      if (n.hand !== hand) continue;
      const weak = pass === 0 ? n.startBeats % 1 !== 0 : n.startBeats % 2 !== 0;
      if (!weak) continue;
      const bar = Math.floor(n.startBeats / meter);
      if ((perBar.get(bar) ?? 0) <= 1) continue;
      piece.notes.splice(i, 1);
      perBar.set(bar, perBar.get(bar) - 1);
      removed++;
    }
    if (removed) break;
  }
  return removed;
}

/** 移调：±maxSemi 半音后吸附到调内音 */
export function transposeNotes(piece, hand, dir, maxSemi = 2) {
  const scaleP = scaleMidis(piece.plan.keyPc, piece.plan.melodyScale, P_LO, P_HI);
  for (const n of piece.notes) {
    if (hand && n.hand !== hand) continue;
    n.midi = clamp(nearest(n.midi + dir * maxSemi, scaleP), P_LO, P_HI);
  }
}

/** 力度缩放 */
export function scaleVel(piece, hand, factor) {
  for (const n of piece.notes) {
    if (hand && n.hand !== hand) continue;
    n.vel = clamp(n.vel * factor, 0.15, 1);
  }
}

/** 自然语言 → 编辑命令（fixture 渠道与真实请求失败的兜底） */
export function keywordAction(text) {
  const t = String(text ?? '');
  if (/左手.*(密|忙|多|busy)/i.test(t)) return 'lh_busier';
  if (/左手.*(疏|稀|少|简|sparse|less)/i.test(t)) return 'lh_sparser';
  if (/(右手|旋律).*(密|忙|多|busy)/i.test(t)) return 'rh_busier';
  if (/(右手|旋律).*(疏|稀|少|简|sparse)/i.test(t)) return 'rh_sparser';
  if (/升|高|上移|up\b/i.test(t)) return 'transpose_up';
  if (/降|低|下移|down\b/i.test(t)) return 'transpose_down';
  if (/轻|弱|渐弱|柔|soft/i.test(t)) return 'soften';
  if (/亮|强|响|bright/i.test(t)) return 'brighten';
  return 'none';
}

export const ACTIONS = {
  lh_busier: 'densify the left hand', lh_sparser: 'thin the left hand',
  rh_busier: 'densify the melody', rh_sparser: 'thin the melody',
  transpose_up: 'transpose up a step', transpose_down: 'transpose down a step',
  soften: 'soften velocities', brighten: 'brighten velocities', none: 'no change needed',
};
export const ACTIONS_ZH = {
  lh_busier: '左手加密', lh_sparser: '左手稀疏', rh_busier: '旋律加密', rh_sparser: '旋律稀疏',
  transpose_up: '整体上移', transpose_down: '整体下移', soften: '力度收柔', brighten: '力度提亮', none: '无需修改',
};

/** 应用一个编辑命令，返回变更的音符数 */
export function applyAction(piece, action) {
  switch (action) {
    case 'lh_busier': return densifyHand(piece, 'L');
    case 'lh_sparser': return sparserHand(piece, 'L');
    case 'rh_busier': return densifyHand(piece, 'R');
    case 'rh_sparser': return sparserHand(piece, 'R');
    case 'transpose_up': return transposeNotes(piece, null, 1);
    case 'transpose_down': return transposeNotes(piece, null, -1);
    case 'soften': return scaleVel(piece, null, 0.82);
    case 'brighten': return scaleVel(piece, null, 1.18);
    default: return 0;
  }
}

/** 项目 JSON 校验（jevthoven 的 validated JSON import） */
export function validatePiece(data) {
  if (!data || data.version !== 1 || !data.plan || !Array.isArray(data.notes) || !Array.isArray(data.barChords)) return null;
  if (!Number.isFinite(data.totalBars) || !Number.isFinite(data.plan.keyPc)) return null;
  const ok = data.notes.every((n) => n && Number.isFinite(n.midi) && Number.isFinite(n.startBeats)
    && Number.isFinite(n.durBeats) && Number.isFinite(n.vel) && (n.hand === 'R' || n.hand === 'L'));
  if (!ok) return null;
  data.nid = data.nid ?? Math.max(0, ...data.notes.map((n) => n.id ?? 0)) + 1;
  return data;
}

/* ==================== 纯函数：时间轴分析（与 DOM 无关，可单测） ==================== */

/** 拍点 → 小节序号（卷帘 hover 用）；越界/脏输入返回 -1，绝不抛错 */
export function barIndexAt(beat, meter, totalBars) {
  const b = Number(beat), m = Number(meter), n = Number(totalBars);
  if (!Number.isFinite(b) || !Number.isFinite(m) || m <= 0 || !Number.isInteger(n) || n < 1) return -1;
  const i = Math.floor(b / m);
  return i >= 0 && i < n ? i : -1;
}

/** 某小节的和声功能：优先用 composer 记下的决策归因，旧项目 JSON 没有则由根音回推 */
export function barFunction(bc, mode = 'major') {
  if (!bc) return 'T';
  if (bc.fn && FN_COLOR[bc.fn]) return bc.fn;
  return functionOfPc(bc.rootPc ?? 0, mode) ?? 'T';
}

/**
 * 整曲张力序列：把 piece 还原成一组"可交给 barTension 的小节"再逐小节计算。
 * note 按 startBeats 归入小节；旧项目 JSON 没有 intensity 时用 1.5 作为中性值。
 */
export function pieceTension(piece) {
  if (!piece || !Array.isArray(piece.barChords) || !piece.barChords.length) return [];
  const meter = piece.plan?.meterNum || 4;
  const mode = piece.plan?.mode || 'major';
  const byBar = piece.barChords.map(() => []);
  for (const n of (piece.notes ?? [])) {
    const i = Math.floor(n.startBeats / meter);
    if (i >= 0 && i < byBar.length) byBar[i].push(n);
  }
  return piece.barChords.map((bc, i) => barTension({
    chord: { rootPc: bc.rootPc ?? 0, shape: bc.shape ?? '' },
    intensity: Number.isFinite(bc.intensity) ? bc.intensity : 1.5,
    decision: { chordFn: barFunction(bc, mode) },
    notes: byBar[i],
  }));
}
