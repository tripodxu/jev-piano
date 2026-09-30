// render.js — 渲染内核：把「一个已确定的选择」（和弦/织体/节奏/轮廓/手法）变成音符。
// 从 composer.js 拆出（轮次 25，ADR-0004 每文件 ≤800 行）——决策（七问/候选集/归因）留在 composer.js，
// 这里只有「给定计划、和弦、rng，产出音符」的纯函数：旋律渲染、左手织体、动机发展、反重复护栏。
// rng 一律由调用方注入，同 seed 可复现。
import {
  chordMidis, scaleMidis, nearest, lhVoicing,
} from './music.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 轮廓步进表（供决策器校验 contour 答案与渲染共用同一份）
export const CONTOUR_STEPS = {
  stay: [0, 0, 1, 0, -1],
  rise: [1, 1, 2, 1],
  fall: [-1, -1, -2, -1],
  arch: [1, 2, 1, -1, -2],
  wave: [1, -1, 1, -1],
};


/** 旋律发展手法（jevthoven 式动机发展）：Jev 每小节与其它问题并行选择，内核负责执行 */
export const DEVELOP_OPS = {
  repeat: 'restate the idea against the new harmony; details may drift',
  sequence: 'transpose the previous idea up or down a scale step',
  inversion: 'mirror the previous melodic intervals around its first note',
  ornament: 'keep the idea but add passing/neighbor tones for a busier surface',
  new: 'start a fresh contrasting idea',
};

function velFor(onsetGrid, intensity, rng) {
  return clamp(0.35 + (intensity / 3) * 0.5 + (onsetGrid % 4 === 0 ? 0.08 : 0) + (rng() * 0.08 - 0.04), 0.2, 1);
}

/** 音阶内上/下一个音 */
function scaleNext(midi, dir, scale) {
  if (dir > 0) { for (const m of scale) if (m > midi) return m; return midi; }
  for (let i = scale.length - 1; i >= 0; i--) if (scale[i] < midi) return scale[i];
  return midi;
}

/** 旋律指纹：16 分格 + 绝对音高。连续小节指纹相同 = 字面重复，被护栏禁止 */
export function sigOf(rh) {
  return rh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(',');
}

/** 曲终末音（轮次 36）：锚定到**调性主三和弦**（根/三/五，三音随调式）——
 *  比乐句尾的「锚当前和弦」更强的收束：曲终要落在「家」上，而不是停在路过的地方。 */
export function snapLastToTonic(notes, plan) {
  const last = notes.at(-1);
  if (!last) return notes;
  const tonic = ((plan.keyPc % 12) + 12) % 12;
  const minorish = ['minor', 'dorian', 'pentatonicMinor', 'harmonicMinor'].includes(plan.melodyScale);
  const third = minorish ? 3 : 4;
  const pool = [];
  for (let m = 58; m <= 86; m++) {
    const rel = ((m - tonic) % 12 + 12) % 12;
    if (rel === 0 || rel === third || rel === 7) pool.push(m);
  }
  last.midi = nearest(last.midi, pool);
  return notes;
}

/** 乐句尾末音锚定到根音/五音 */
export function snapLastToChord(notes, chord) {
  const last = notes.at(-1);
  if (!last) return notes;
  const pool = chordMidis(chord.rootPc, chord.shape, 58, 86);
  const root = nearest(chord.rootPc + (chord.rootPc + 60 > 84 ? 48 : 60), pool);
  last.midi = nearest(last.midi, [root, nearest(root + 7, pool)]);
  return notes;
}

/** 经过音/邻音装饰：在 ≥0.45 拍且音程 ≥3 半音的缝隙插音，最多 3 个 */
export function insertPassing(notes, scale, rng) {
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    out.push(notes[i]);
    const a = notes[i], b = notes[i + 1];
    if (!b) continue;
    const gap = b.startBeats - a.startBeats;
    if (gap >= 0.45 && Math.abs(b.midi - a.midi) >= 3 && out.length - notes.length < 3 && rng() < 0.8) {
      out.push({
        midi: clamp(nearest(Math.round((a.midi + b.midi) / 2), scale), 60, 84),
        startBeats: a.startBeats + gap / 2, durBeats: gap * 0.4,
        vel: Math.max(0.2, a.vel - 0.12), hand: 'R',
      });
    }
  }
  return out.sort((x, y) => x.startBeats - y.startBeats);
}

/** 保底脱困：整体压缩节奏位置。签名 = onset:midi 序列，所以改变 onset 必然改变签名；
 *  4 个互不相同的压缩比里，必然有 ≥2 个与已存的 2 个指纹都不同 → 存在性可证，不靠碰运气。 */
function compressRhythm(notes, k) {
  return notes.map((n) => ({ ...n, startBeats: n.startBeats * k }));
}

/** 反重复护栏：与最近两小节指纹撞车时，依次尝试整句上移/下移/加装饰/倒影/节奏压缩/音高扫掠，
 *  直到避开全部已存指纹。**任何情况下都不得原样返回撞车的旋律**——那会让"绝不逐字重复"变成谎话。
 *  post：候选的最终形态改写（乐句尾的末端锚定）。护栏必须在 post 之后的形态上判定，
 *  否则会出现"逃出去了又被锚定改回撞车"——比对的是未锚定 vs 已锚定两种形态，语义不一致。 */
export function mutateMelody(rh, { scale, rng, avoid = [], post = (x) => x }) {
  const blocked = (cand) => avoid.some((s) => s === sigOf(cand));
  // 试一个候选：先做最终形态改写，再判定；不撞车就把改写后的结果交出去
  const attempt = (make) => {
    const fin = post(make(rh));
    return blocked(fin) ? null : fin;
  };
  if (!blocked(post(rh))) return post(rh);
  const m0 = rh[0]?.midi ?? 60;
  const tries = [
    (ns) => ns.map((n) => ({ ...n, midi: clamp(scaleNext(n.midi, 1, scale), 60, 84) })),
    (ns) => ns.map((n) => ({ ...n, midi: clamp(scaleNext(n.midi, -1, scale), 60, 84) })),
    (ns) => insertPassing(ns, scale, rng),
    (ns) => ns.map((n) => ({ ...n, midi: clamp(m0 - (n.midi - m0), 60, 84) })), // 围绕首音倒影
    (ns) => compressRhythm(ns, 0.9),
    (ns) => compressRhythm(ns, 0.8),
    (ns) => compressRhythm(ns, 0.7),
    (ns) => compressRhythm(ns, 0.6),
  ];
  for (const f of tries) {
    const out = attempt(f);
    if (out) return out;
  }
  // 节奏压缩对"所有音同一 onset"无效（乘任何系数都不变），改用音高绝对扫掠
  for (const d of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
    const out = attempt((ns) => ns.map((n) => ({ ...n, midi: clamp(n.midi + d, 60, 84) })));
    if (out) return out;
  }
  // 极端兜底（2026-09-30 实地测试修正）：变形空间被全曲指纹耗尽时——
  // 旧实现固定「删末音」，但那个形式可能早已存档（真渠道连续承袭 6 小节后，
  // 4 个相邻小节都返回了同一个已存档的删末音形式）。现在逐音枚举删除，
  // 取第一个不撞已存指纹的；全部撞车则诚实返回原样（由 farRepeat 归因标记）。
  for (let i = rh.length - 1; i > 0; i--) {
    const cand = post(rh.slice(0, i).concat(rh.slice(i + 1)));
    if (!blocked(cand)) return cand;
  }
  return post(rh);
}

/** 音高序列 → 相邻音程序列（给模型看的动机描述） */
export function melodyIntervals(midis) {
  return midis.map((m, k, a) => (k ? m - a[k - 1] : 0)).slice(1);
}

/** 模进/倒影：以上一小节旋律素材为本，重锚定到当前和弦（jevthoven 的 motif development） */
export function buildFromPrev(prev, { dir, invert, chord, scale, meterNum, intensity, isPhraseEnd, rng }) {
  const chordPool = chordMidis(chord.rootPc, chord.shape, 58, 86);
  const steps = meterNum * 4;
  const onsets = prev.onsets;
  let start = prev.startMidi ?? nearest(72, chordPool);
  if (dir) start = scaleNext(start, dir, scale);
  start = nearest(start, chordPool);
  const sgn = invert ? -1 : 1;
  let acc = 0;
  const notes = onsets.map((o, k) => {
    if (k > 0) acc += (prev.intervals[k - 1] ?? 0) * sgn;
    let midi = clamp(start + acc, 60, 84);
    if (o % 4 === 0 || k === onsets.length - 1) midi = nearest(midi, chordPool);
    return { midi, startBeats: o, durBeats: 0, vel: velFor(Math.round(o * 4), intensity, rng), hand: 'R' };
  });
  notes.forEach((n, k) => {
    const nextO = k < notes.length - 1 ? onsets[k + 1] : steps;
    let d = ((nextO - onsets[k]) / 4) * 0.9;
    if (k === notes.length - 1 && isPhraseEnd) d *= 2;
    n.durBeats = d;
  });
  return notes;
}

/**
 * 从**动机素材**出发构建旋律（承袭/模进/倒影/装饰都走这里）。
 * 关键区别：素材是「整首曲子的动机」而不是「上一小节」——模进与倒影作用于动机才有意义。
 *  transpose: 整体移调（音级数，正=上移）；invert: 音程取反；ornament: 加经过音。
 *  强拍与末音仍锚定到当前和弦——「同一想法，新的和声」正是这样成立的。
 */
/**
 * 呼吸的延后量：取这组音自己的最小节奏间距，夹在 [0.125, 0.5] 拍。
 * 「呼吸」是**时值指令**（延后进入），不是**否决指令**（不许用素材）。
 * 第 16 轮只把 repeat 挪出 `!breathe` 这道门，sequence/inversion/ornament 仍被挡在外面，
 * 于是它们在有呼吸的小节里被静默取消，而日志照旧写着「模进/倒影/装饰」。
 */
export function breatheDelay(notes) {
  const ons = (notes ?? []).map((n) => n.startBeats).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const gaps = ons.slice(1).map((o, i) => o - ons[i]).filter((d) => d > 1e-9);
  return Math.max(0.125, Math.min(0.5, ...(gaps.length ? gaps : [0.5])));
}

export function buildFromMotif(motif, { chord, scale, meterNum, intensity, isPhraseEnd, rng, transpose = 0, invert = false, ornament = false, breathe = false }) {
  const midis = motif?.midis ?? [];
  if (!midis.length) return null;
  const steps = meterNum * 4;
  const base = motif.onsets?.length === midis.length
    ? motif.onsets
    : midis.map((_, i) => Math.round((i * steps) / midis.length));
  // 主题延迟进入是真实手法，而丢掉首音会破坏动机身份
  const shift = breathe ? breatheDelay(base.map((o, i) => ({ startBeats: o }))) : 0;
  const onsets = base.map((o) => o + shift);
  const pool = chordMidis(chord.rootPc, chord.shape, 58, 86);
  const sgn = invert ? -1 : 1;
  let start = midis[0];
  for (let i = 0; i < Math.abs(transpose); i++) start = scaleNext(start, Math.sign(transpose), scale);
  let acc = 0;                       // 标量累加器：逐音级累积相对起点的位移
  const notes = midis.map((m, k) => {
    if (k > 0) acc += (m - midis[k - 1]) * sgn;
    let midi = clamp(start + acc, 60, 84);
    // 强拍锚到和弦音，但**本来就在和弦里的音不动**——没必要为了"合规"改掉动机的轮廓。
    // 末音只在**乐句尾**锚定（第 1 轮的设计如此）：每小节都锚会把动机的最后一个音拽走 7 个半音，
    // 「呼吸」延后之后尤其明显——那正是"承袭却不像动机"的元凶。
    // 首音锚定（2026-09-30 实地测试补的第三种锚点）：动机无任何强拍时（如带呼吸延后的短句），
    // 承袭会逐小节原样输出同一旋律——「同一想法，新的和声」退化成「同一想法，句号」。
    // 延后进入的第一音就是重述的落点，锚到当前和弦让承袭真正跟随和声。
    const anchor = onsets[k] % 4 === 0 || k === 0 || (isPhraseEnd && k === midis.length - 1);
    if (anchor && !pool.includes(midi)) midi = nearest(midi, pool);
    return { midi, startBeats: onsets[k], durBeats: 0, vel: velFor(Math.round(onsets[k] * 4), intensity, rng), hand: 'R' };
  });
  notes.forEach((n, k) => {
    const nextO = k < notes.length - 1 ? onsets[k + 1] : steps;
    let d = ((nextO - onsets[k]) / 4) * 0.9;
    if (k === notes.length - 1 && isPhraseEnd) d *= 2;
    n.durBeats = d;
  });
  return ornament ? insertPassing(notes, scale, rng) : notes;
}

/** 节奏变奏：在基础音型上位移/补弱位/删音，每小节现场变化（jevthoven 的 complete-bar candidates） */
export function varyPattern(pat, rng, meterNum) {
  const steps = meterNum * 4;
  const on = [...pat.on];
  if (rng() < 0.5 && on.length > 1) {
    const idx = 1 + Math.floor(rng() * (on.length - 1));
    const moved = on[idx] + (rng() < 0.5 ? -1 : 1);
    if (moved > 0 && moved < steps && !on.includes(moved)) { on[idx] = moved; on.sort((a, b) => a - b); }
  }
  if (rng() < 0.35 && on.length < steps / 2) {
    const cand = [];
    for (let g = 1; g < steps; g += 2) if (!on.includes(g)) cand.push(g);
    if (cand.length) { on.push(cand[Math.floor(rng() * cand.length)]); on.sort((a, b) => a - b); }
  }
  if (rng() < 0.25 && on.length > 2) on.splice(1 + Math.floor(rng() * (on.length - 1)), 1);
  if (rng() < 0.25 && on.length >= 3) {
    const shifted = on.map((g) => (g + 2) % steps).sort((a, b) => a - b); // 整体位移两格：切分感
    on.splice(0, on.length, ...shifted);
  }
  return { on, tier: pat.tier };
}



const CONTOURS = CONTOUR_STEPS;

/** 右手旋律：轮廓驱动（随机相位）+ 强拍和弦音锚定 + 摇摆与人味；乐句尾锚定与反重复由调用方统一处理 */
export function renderMelody({ plan, chord, contourId, pattern, breathe, intensity, isPhraseEnd, startHint, rng }) {
  const steps = plan.meterNum * 4;
  let onsets = breathe ? pattern.on.slice(1) : [...pattern.on];
  if (!onsets.length) onsets = [plan.meterNum === 3 ? 6 : 8];
  const scale = scaleMidis(plan.keyPc, plan.melodyScale, 58, 86);
  const chordPool = chordMidis(chord.rootPc, chord.shape, 58, 86);
  let cur = startHint ?? nearest(72, chordPool);
  const seq = CONTOURS[contourId] ?? CONTOURS.wave;
  const off = Math.floor(rng() * seq.length); // 轮廓步进随机相位：同一轮廓也能走出不同的句子
  const notes = [];
  const n = onsets.length;
  for (let k = 0; k < n; k++) {
    const i = onsets[k];
    const strong = i % 4 === 0 || k === n - 1;
    let step = seq[(off + k) % seq.length];
    if (!strong && rng() < 0.25) step = (rng() < 0.5 ? 1 : -1) * (3 + Math.floor(rng() * 4)); // 真跳进（±6~12 半音），跳后由轮廓自然收回
    let target = cur + step * 2;
    target = nearest(target, strong ? chordPool : scale);
    target = clamp(target, 60, 84);
    let startBeats = i / 4;
    if (i % 4 === 2) startBeats += plan.swing * 1.0;
    else if (i % 2 === 1) startBeats += plan.swing * 0.5;
    const nextOnset = k < n - 1 ? onsets[k + 1] : steps;
    let durBeats = ((nextOnset - i) / 4) * (0.7 + rng() * 0.35); // 时长人味：不再等长机械
    if (k === n - 1 && isPhraseEnd) durBeats *= 2;
    notes.push({ midi: target, startBeats, durBeats, vel: velFor(i, intensity, rng), hand: 'R' });
    cur = target;
  }
  return notes;
}

/** 左手织体：11 种模式 × 逐小节变体（重击/呼吸空拍/方向翻转/色彩换位/经过音/音区抬升），同一和弦不再弹出同一个小节 */
export function renderLH({ plan, chord, patternId, intensity, rng }) {
  const { bass, upper } = lhVoicing(chord.rootPc, chord.shape);
  const pool = chordMidis(chord.rootPc, chord.shape, 36, 64);
  const notes = [];
  const push = (midi, startBeats, durBeats, vel, extra = 0) => {
    if (midi == null) return;
    notes.push({
      midi: clamp(midi, 36, 64), startBeats, durBeats,
      vel: clamp(vel * (intensity < 1 ? 0.85 : intensity > 2 ? 1.15 : 1) + (rng() * 0.06 - 0.03) + extra, 0.15, 1),
      hand: 'L',
    });
  };
  const chordHit = (start, dur, vel) => upper.forEach((m, j) => push(m, start, dur, vel - j * 0.03));
  const light = intensity < 1.2 && rng() < 0.3;  // 轻乐句：低音上移八度，更透明
  const bassNote = light ? bass + 12 : bass;
  const restSlot = rng() < 0.25 ? Math.floor(rng() * plan.meterNum * 2) : -1; // 织体呼吸：随机空一个八分位

  switch (patternId) {
    case 'block': {
      const rehit = intensity >= 1.5 && rng() < 0.4;
      const half = plan.meterNum / 2;
      // 织体变体（轮次 26）：三声部 35% 概率抽掉顶部一声——同和弦的 block 此前只有 rehit 两种
      // 字面形态，全曲指纹记忆下变体空间必然穷尽（实测 seed 2026 撞车后裁无可裁）
      const voiced = rng() < 0.35 && upper.length > 2 ? upper.slice(0, upper.length - 1) : upper;
      push(bassNote, 0, rehit ? half : plan.meterNum, 0.5);
      voiced.forEach((m, j) => push(m, 0, rehit ? half : plan.meterNum, 0.4 - j * 0.03));
      if (rehit) { push(bassNote, half, half, 0.46); voiced.forEach((m, j) => push(m, half, half, 0.36 - j * 0.03)); }
      break;
    }
    case 'ballad': {
      const off = plan.meterNum >= 4 && rng() < 0.4 ? 1 : 2; // 和弦落在第二拍或第三拍
      // 同款抽稀变体：ballad 此前也只有 off 两种字面形态
      const voiced = rng() < 0.35 && upper.length > 2 ? upper.slice(0, upper.length - 1) : upper;
      push(bassNote, 0, off, 0.5);
      voiced.forEach((m, j) => push(m, 0, off, 0.35 - j * 0.03));
      voiced.forEach((m, j) => push(m, off, plan.meterNum - off, 0.4 - j * 0.03));
      break;
    }
    case 'alberti': {
      const variants = [[bass, upper[0], upper[1], upper[0]], [bass, upper[1], upper[0], upper[1]], [upper[0], bass, upper[1], upper[0]]];
      const seq = variants[Math.floor(rng() * variants.length)];
      for (let s2 = 0; s2 < plan.meterNum * 2; s2++) {
        if (s2 === restSlot) continue;
        push(seq[s2 % seq.length], s2 * 0.5, 0.45, 0.32 + (s2 % 4 === 0 ? 0.06 : 0));
      }
      break;
    }
    case 'arp': {
      const base = rng() < 0.3 ? [upper[2], upper[1], upper[0], bass] : [bass, upper[0], upper[1], upper[2]];
      const rot = Math.floor(rng() * 4);
      for (let s2 = 0; s2 < plan.meterNum * 2; s2++) {
        if (s2 === restSlot) continue;
        push(base[(s2 + rot) % 4], s2 * 0.5, 0.48, 0.34 + (s2 % 4 === 0 ? 0.05 : 0));
      }
      break;
    }
    case 'broken': {
      const seq = [bass, upper[0], upper[1], upper[2], upper[1], upper[0], upper[1], upper[2]];
      const rot = Math.floor(rng() * 8);
      for (let s2 = 0; s2 < plan.meterNum * 4; s2++) {
        if (s2 === restSlot) continue;
        push(seq[(s2 + rot) % 8], s2 * 0.25, 0.24, 0.28);
      }
      break;
    }
    case 'waltz': {
      push(bassNote, 0, 1, 0.55);
      const alt = rng();
      if (alt < 0.25) { push(nearest(bass + 7, pool), 2, 1, 0.32); chordHit(1, 1, 0.4); }
      else if (alt < 0.45) { push(nearest(bass + 7, pool), 1.5, 0.5, 0.28); chordHit(1, 1, 0.4); chordHit(2, 1, 0.35); }
      else { chordHit(1, 1, 0.4); chordHit(2, 1, 0.35); }
      break;
    }
    case 'shell': {
      const color = nearest(bass + (rng() < 0.5 ? 10 : 4), pool.filter((m) => m >= 40)); // 七音或三音换色
      const rehit = rng() < 0.5;
      push(bassNote, 0, rehit ? 2 : 3, 0.45); push(color, 0, rehit ? 2 : 3, 0.4);
      if (rehit) { push(bassNote, 2, 2, 0.4); push(color, 2, 2, 0.36); }
      break;
    }
    case 'stride': {
      const fifth = nearest(bass + 7, pool), third = nearest(bass + 5, pool);
      push(bassNote, 0, 0.5, 0.5); push(fifth, 1, 0.5, 0.42); chordHit(1, 0.5, 0.38);
      if (rng() < 0.3) { push(fifth, 2, 0.5, 0.48); push(bassNote, 3, 0.5, 0.4); }
      else { push(bassNote, 2, 0.5, 0.48); push(third, 3, 0.5, 0.4); }
      chordHit(3, 0.5, 0.36);
      break;
    }
    case 'walk': {
      const approach = rng() < 0.35 ? bassNote + (rng() < 0.5 ? -1 : 1) : nearest(bassNote + 10, pool); // 半音经过音导入下一小节
      const line = [bassNote, nearest(bassNote + 4, pool), nearest(bassNote + 7, pool), approach];
      line.forEach((m, k) => push(m, k, 0.9, 0.45));
      break;
    }
    case 'octave': {
      for (let s2 = 0; s2 < plan.meterNum * 2; s2++) {
        if (s2 === restSlot) continue;
        push(bass, s2 * 0.5, 0.48, 0.4 + (intensity / 3) * 0.15);
        push(bass + 12, s2 * 0.5, 0.48, 0.36 + (intensity / 3) * 0.12);
      }
      break;
    }
    case 'pad':
    default: {
      push(bassNote, 0, plan.meterNum, 0.35); chordHit(0, plan.meterNum, 0.33);
      if (rng() < 0.4 && upper.length) { // pad 内声部半程移动到邻音
        push(nearest(upper[upper.length - 1] + (rng() < 0.5 ? 2 : -2), pool), plan.meterNum / 2, plan.meterNum / 2, 0.3);
      }
      break;
    }
  }
  return notes;
}

