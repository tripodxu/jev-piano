// composer.js — 编曲决策器：Jev 每小节一次请求（6 问并行），代码把选择渲染成音符。
// 真实 Jev 不可用时（无 key/CORS/断网），fixture 采样器用同一候选集与权重同构兜底，播放永不中断。
import {
  STYLES, STYLE_BY_ID, LH_DEFS, RHYTHM_POOLS, NOTE_NAMES,
  parseRoman, chordLabel, chordPcs, chordMidis, scaleMidis, nearest, lhVoicing, midiName, keywordPlan,
} from './music.js';
import { askJev, fixtureAnswer, expandPlan } from './jev.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MODES = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic'];

/** 目标（goal）对计划参数的偏置 */
export const GOAL_HINTS = {
  '放松助眠': { arc: 'flat', density: -0.15, brightness: -0.15 },
  '专注陪伴': { arc: 'flat' },
  '情绪宣泄': { arc: 'arch', density: 0.15 },
  '欢快庆典': { arc: 'rise', brightness: 0.15 },
  '随机冒险': {},
};

const ARC_CURVES = {
  flat: (p) => 0.9 + 0.3 * Math.sin(Math.PI * p),
  rise: (p) => 0.6 + 1.8 * p,
  arch: (p) => 0.7 + 1.8 * Math.sin(Math.PI * p),
  fall: (p) => 2.4 - 1.8 * p,
};

const CONTOUR_STEPS = {
  stay: [0, 0, 1, 0, -1],
  rise: [1, 1, 2, 1],
  fall: [-1, -1, -2, -1],
  arch: [1, 2, 1, -1, -2],
  wave: [1, -1, 1, -1],
};

const ROOT_ROLE = {
  0: '主和弦，稳定归宿', 7: '属和弦，张力推动解决', 5: '下属色彩，铺垫',
  9: '中音/相对调色彩', 2: '上主音，过渡', 11: '导音，强烈倾向主',
  3: '三度借用，柔和', 8: '下中音，深沉', 4: '三音级，明亮', 10: '下主音，混合色彩',
  6: '减和弦，戏剧性', 1: '变化音，意外感',
};

/** 由关键词/LLM 产出装配出完整合法的 Plan；keyPc 为用户指定的移调（0..11，null = 自动） */
export async function buildPlan({ prompt = '', goal = '随机冒险', styleId = 'random', seed = 1, bars = 32, keyPc = null } = {}, cfg = {}) {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const style = styleId !== 'random' && STYLE_BY_ID[styleId] ? STYLE_BY_ID[styleId] : null;
  const hint = { style: style?.name, goal };

  let base = null;
  if (cfg.llm?.enabled && prompt.trim()) {
    const raw = await expandPlan(prompt, hint, cfg.llm);
    if (raw) {
      const sid = style ? style.id : (STYLE_BY_ID[raw.style] ? raw.style : null);
      if (sid) {
        const st = STYLE_BY_ID[sid];
        let mode = MODES.includes(raw.mode) ? raw.mode : st.modes[0];
        if (!st.progs[mode]) mode = Object.keys(st.progs)[0];
        base = {
          title: String(raw.title ?? '').slice(0, 24) || undefined,
          styleId: sid, mode,
          keyPc: clamp(Math.round(Number(raw.keyPc) || 0), 0, 11),
          bpm: clamp(Math.round(Number(raw.bpm) || st.bpm[0]), 50, 140),
          arc: ['flat', 'rise', 'arch', 'fall'].includes(raw.arc) ? raw.arc : 'arch',
          swing: clamp(Number(raw.swing) ?? st.swing, 0, 0.35),
          density: clamp(Number(raw.density) ?? st.density, 0, 1),
          brightness: clamp(Number(raw.brightness) ?? st.brightness, 0, 1),
          mood: Array.isArray(raw.mood) ? raw.mood.map(String).slice(0, 3) : ['improvised'],
          notes: String(raw.notes ?? '').slice(0, 80),
          source: 'llm',
        };
      }
    }
  }
  if (!base) {
    const kw = keywordPlan(prompt, rng);
    const sid = style ? style.id : kw.styleId;
    const st = STYLE_BY_ID[sid];
    let mode = style ? (st.progs[kw.mode] ? kw.mode : Object.keys(st.progs)[0]) : kw.mode;
    if (!st.progs[mode]) mode = Object.keys(st.progs)[0];
    base = { ...kw, styleId: sid, mode, source: style ? 'keyword' : kw.source };
  }

  // 目标偏置
  const gh = GOAL_HINTS[goal] ?? {};
  base.arc = gh.arc ?? base.arc;
  base.density = clamp(base.density + (gh.density ?? 0), 0.05, 1);
  base.brightness = clamp(base.brightness + (gh.brightness ?? 0), 0, 1);
  // 用户移调（jevthoven 的 transpose 命令）：覆盖 LLM/关键词给出的调
  if (Number.isInteger(keyPc) && keyPc >= 0 && keyPc <= 11) base.keyPc = keyPc;

  const st = STYLE_BY_ID[base.styleId];
  const [meterNum, meterDen] = st.meters[0].split('/').map(Number);
  return {
    ...base,
    title: base.title || `${prompt.slice(0, 12) || '无名'} · 即兴`,
    prompt: String(prompt).slice(0, 200),
    goal, seed,
    keyPc: base.keyPc ?? 0,
    meterNum: meterNum || 4, meterDen: meterDen || 4,
    barsPerPhrase: 8,
    totalBars: clamp(bars, 8, 128),
    melodyScale: base.mode === 'pentatonic' ? (st.id === 'oriental' ? 'pentatonicMinor' : 'pentatonicMajor') : base.mode,
    styleName: st.name,
  };
}

/* ---------------------------- 候选集构造 ---------------------------- */

const ROMAN_BY_PC = { 0: 'I', 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV', 6: 'bV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };

/** 和声循环检测（按根音）：最近 window 小节内 ≤maxDistinct 个不同根音即视为锁死，members = 循环根音集合。
 *  按根音而非罗马数字匹配：G / V7sus4 / G7 是同一功能，防止换后缀绕过断路器 */
export function detectLoop(recentRoots, window = 6, maxDistinct = 3) {
  const recent = recentRoots.slice(-window);
  if (recent.length < window) return { locked: false, members: new Set() };
  const counts = {};
  for (const r of recent) counts[r] = (counts[r] ?? 0) + 1;
  const members = new Set(Object.keys(counts).filter((k) => counts[k] >= 2).map(Number));
  return { locked: new Set(recent).size <= maxDistinct, members };
}

/** 下一和弦候选：风格进行池全集 + 进行延续/乐句位置加权 + 替换和弦（副属/借用/悬挂）
 *  recentRomans 用于循环检测：循环锁死时循环成员直接从候选中剔除（jevthoven：代码策划候选集） */
export function chordCandidates(style, plan, currentSym, barInPhrase, isPhraseEnd, lastPhraseFirst = null, recentRoots = [], fatigue = {}) {
  const pools = style.progs[plan.mode] ?? Object.values(style.progs)[0];
  const norm = (s) => String(s).replace(/\s+/g, '');
  const cand = new Map();
  let poolNext = null;
  for (const pool of pools) {
    const nexts = new Set();
    let matched = false;
    for (let k = 0; k < pool.length; k++) {
      if (currentSym && norm(pool[k]) === norm(currentSym)) {
        matched = true;
        nexts.add(norm(pool[(k + 1) % pool.length]));
      }
    }
    for (const sym of pool) {
      const s = norm(sym);
      const prev = cand.get(s) ?? { w: 0, cont: false, pools: 0 };
      cand.set(s, { w: prev.w + 1.0 + (matched && nexts.has(s) ? 1.2 : 0), cont: prev.cont || (matched && nexts.has(s)), pools: prev.pools + 1 });
    }
    if (matched) poolNext = [...nexts][0] ?? null;
  }
  // 替换候选：让 Jev 有进行池之外的和声选择，打破 4 和弦循环
  const curSym = currentSym ? parseRoman(currentSym) : null;
  const subs = [];
  if (curSym) {
    if (poolNext) {
      const p2 = parseRoman(poolNext);
      if (p2 && p2.rootPc !== curSym.rootPc && p2.rootPc !== 0) {
        const sec = (p2.rootPc + 7) % 12;
        subs.push({ sym: ROMAN_BY_PC[sec] + '7', weight: 1.3, sub: true, desc: `secondary dominant driving into ${poolNext}` });
      }
    }
    if (plan.mode === 'major' && curSym.rootPc === 5 && curSym.shape === '') {
      subs.push({ sym: 'iv', weight: 1.1, sub: true, desc: 'borrowed minor subdominant, poignant color' });
    }
    if (!isPhraseEnd && (curSym.shape === '' || curSym.shape === 'm')) {
      subs.push({ sym: ROMAN_BY_PC[curSym.rootPc] + '7sus4', weight: 1.0, sub: true, desc: 'suspend the current harmony, floating tension' });
    }
    if (barInPhrase <= 1 && plan.mode === 'major') {
      subs.push({ sym: 'VIIø', weight: 0.9, sub: true, desc: 'leading-tone half-diminished, pulling to the tonic' });
    }
  }
  const fatigued = (rootPc) => (fatigue?.[rootPc] ?? 0) > 2.0;
  // 两段构建：先剔除疲劳根音；若全部被剔（长曲常见）则忽略疲劳重建，保证候选非空
  const build = (respectFatigue) => {
    const list = [];
    for (const [sym, { w, cont, pools }] of cand) {
      const p = parseRoman(sym);
      if (!p) continue;
      if (respectFatigue && fatigued(p.rootPc)) continue; // 根音疲劳：近期用滥的根音不可表示
      let weight = w;
      if (barInPhrase === 0 && p.rootPc === 0) weight += 0.6;
      if (isPhraseEnd && (p.rootPc === 7 || p.rootPc === 0)) weight += 1.0;
      if (currentSym && norm(currentSym) === sym) weight -= 1.2 * pools; // 连续同和弦：按池数放大罚分
      if (barInPhrase === 0 && lastPhraseFirst && sym !== norm(lastPhraseFirst) && [0, 5, 9].includes(p.rootPc)) {
        weight += 0.5; // 乐句开头换进行：换个起点，别每段都一样开场
      }
      const role = ROOT_ROLE[p.rootPc] ?? '色彩和弦';
      const desc = `${role}${p.shape.includes('7') || p.shape.includes('9') ? '（延伸音色）' : ''}${cont ? '；进行计划的延续' : ''}`;
      list.push({ sym, weight, desc, label: chordLabel(p.rootPc, p.shape), ...p });
    }
    for (const s of subs) {
      const p = parseRoman(s.sym);
      if (!p || list.some((c) => c.sym === s.sym)) continue;
      if (respectFatigue && fatigued(p.rootPc)) continue;
      list.push({ ...s, ...p });
    }
    return list;
  };
  let out = build(true);
  if (!out.length) out = build(false);
  out.sort((a, b) => b.weight - a.weight);
  const poolTop = out.filter((c) => !c.sub).slice(0, 6);
  const subTop = out.filter((c) => c.sub).slice(0, 2);
  const merged = [...poolTop, ...subTop].sort((a, b) => b.weight - a.weight).slice(0, 8);
  if (merged.length < 3) { // 安全兜底：排除过度时按权重回填
    const rest = out.filter((c) => !merged.includes(c)).slice(0, 3 - merged.length);
    return [...merged, ...rest];
  }
  return merged;
}

/** 和弦音功能描述（Jev criteria / fixture 共用） */
export function chordCriteria(cands) {
  return Object.fromEntries(cands.map((c) => [c.sym, c.desc]));
}

/** 左手织体候选（按强度微调权重；连续同织体 ≥2 小节后衰减，避免伴奏原地踏步） */
export function lhCandidates(style, intensity, prevId = null, repeatCount = 0) {
  const out = {};
  for (const id of style.lh) {
    let w = 1.0;
    if (intensity >= 2 && ['octave', 'stride', 'walk'].includes(id)) w += 0.3;
    if (intensity < 1 && ['pad', 'ballad'].includes(id)) w += 0.3;
    if (prevId && id === prevId && repeatCount >= 2) w *= 0.5;
    out[id] = { w, desc: LH_DEFS[id] };
  }
  return out;
}

/** 右手节奏候选：与目标密度档最近的 3 个 + 动机重现项 */
export function rhythmCandidates(plan, motif, phraseNo) {
  const pool = RHYTHM_POOLS[plan.meterNum] ?? RHYTHM_POOLS[4];
  const targetTier = Math.round(plan.density * 2);
  const all = Object.values(pool).flat();
  const scored = all.map((pat) => ({ pat, w: 0.55 + 1 / (1 + Math.abs(pat.tier - targetTier)) }))
    .sort((a, b) => b.w - a.w).slice(0, 3);
  const out = {};
  scored.forEach(({ pat, w }, i) => { out[`r${i}`] = { w, pat, tier: pat.tier }; });
  if (motif && phraseNo > 0) out.motif = { w: (scored[0]?.w ?? 1) + 0.8, pat: motif.pattern, tier: motif.pattern.tier };
  return out;
}

/** 旋律走向权重表（乐句位置 + 全曲弧线） */
export function contourWeights(plan, barInPhrase) {
  let w;
  if (barInPhrase <= 1) w = { stay: 0.9, rise: 0.9, wave: 0.7, arch: 0.6, fall: 0.5 };
  else if (barInPhrase <= 5) w = { arch: 1.1, wave: 0.9, rise: 0.7, fall: 0.7, stay: 0.6 };
  else w = { fall: 1.1, stay: 0.7, arch: 0.6, wave: 0.6, rise: 0.5 };
  if (plan.arc === 'rise') w.rise += 0.3;
  if (plan.arc === 'fall') w.fall += 0.3;
  return w;
}

/** 强度曲线值（fixture score 的期望位置） */
export function intensityTarget(plan, progress, isPhraseEnd) {
  const v = (ARC_CURVES[plan.arc] ?? ARC_CURVES.arch)(progress);
  return clamp(v - (isPhraseEnd ? 0.5 : 0), 0, 3);
}

/* ------------------------ 发展手法与反重复 ------------------------ */

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
function sigOf(rh) {
  return rh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(',');
}

/** 乐句尾末音锚定到根音/五音 */
function snapLastToChord(notes, chord) {
  const last = notes.at(-1);
  if (!last) return notes;
  const pool = chordMidis(chord.rootPc, chord.shape, 58, 86);
  const root = nearest(chord.rootPc + (chord.rootPc + 60 > 84 ? 48 : 60), pool);
  last.midi = nearest(last.midi, [root, nearest(root + 7, pool)]);
  return notes;
}

/** 经过音/邻音装饰：在 ≥0.45 拍且音程 ≥3 半音的缝隙插音，最多 3 个 */
function insertPassing(notes, scale, rng) {
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

/** 反重复护栏：与最近两小节指纹撞车时，依次尝试整句上移/下移/加装饰/倒影，直到避开全部已存指纹 */
function mutateMelody(rh, { scale, rng, avoid = [] }) {
  const blocked = (cand) => avoid.some((s) => s === sigOf(cand));
  if (!blocked(rh)) return rh;
  const m0 = rh[0]?.midi ?? 60;
  const tries = [
    (ns) => ns.map((n) => ({ ...n, midi: clamp(scaleNext(n.midi, 1, scale), 60, 84) })),
    (ns) => ns.map((n) => ({ ...n, midi: clamp(scaleNext(n.midi, -1, scale), 60, 84) })),
    (ns) => insertPassing(ns, scale, rng),
    (ns) => ns.map((n) => ({ ...n, midi: clamp(m0 - (n.midi - m0), 60, 84) })), // 围绕首音倒影
  ];
  for (const f of tries) {
    const cand = f(rh);
    if (!blocked(cand)) return cand;
  }
  return rh;
}

/** 模进/倒影：以上一小节旋律素材为本，重锚定到当前和弦（jevthoven 的 motif development） */
function buildFromPrev(prev, { dir, invert, chord, scale, meterNum, intensity, isPhraseEnd, rng }) {
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

/** 节奏变奏：在基础音型上位移/补弱位/删音，每小节现场变化（jevthoven 的 complete-bar candidates） */
function varyPattern(pat, rng, meterNum) {
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

/* ---------------------------- 音符渲染 ---------------------------- */

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
      push(bassNote, 0, rehit ? half : plan.meterNum, 0.5);
      chordHit(0, rehit ? half : plan.meterNum, 0.4);
      if (rehit) { push(bassNote, half, half, 0.46); chordHit(half, half, 0.36); }
      break;
    }
    case 'ballad': {
      const off = plan.meterNum >= 4 && rng() < 0.4 ? 1 : 2; // 和弦落在第二拍或第三拍
      push(bassNote, 0, off, 0.5); chordHit(0, off, 0.35);
      chordHit(off, plan.meterNum - off, 0.4);
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

/* ---------------------------- 决策器 ---------------------------- */

export class Composer {
  /** cfg = { channel, apiKey?, signal?, llm? }；rng 供 fixture 采样与人味抖动共用 */
  constructor(plan, cfg = {}, rng = mulberry32(plan.seed)) {
    this.plan = plan;
    this.cfg = cfg;
    this.rng = rng;
    this.style = STYLE_BY_ID[plan.styleId];
    this.index = 0;
    this.history = [];
    this.motif = null;
    this.currentChord = null;
    this.lastEndMidi = null;
    this.intensitySoFar = 1;
    this.directorNote = '';        // 用户自然语言演奏指示，实时生效
    this.pitchCenter = 72;         // 音区中心缓慢漂移，避免旋律总绕着同一个音域打转
    this.lastSigs = [];            // 最近两小节旋律指纹（反重复护栏）
    this.prevMelody = null;        // 上一小节旋律素材（供模进/倒影）
    this.developHistory = [];      // 发展手法历史
    this.lastPhraseFirst = null;   // 上一乐句开场的和弦（用于乐句间换进行）
    this.currentSymRoman = null;   // 当前和弦的罗马数字（候选集延续/惩罚匹配用）
    this.rootFatigue = {};         // 根音疲劳表：用多衰减少，>2.2 的根音暂时不可选
  }

  _position() {
    const barInPhrase = this.index % this.plan.barsPerPhrase;
    return {
      bar: this.index,
      loop: Math.floor(this.index / this.plan.totalBars),
      phrase: Math.floor(this.index / this.plan.barsPerPhrase),
      barInPhrase,
      isPhraseEnd: barInPhrase === this.plan.barsPerPhrase - 1,
      progress: (this.index % this.plan.totalBars) / this.plan.totalBars,
    };
  }

  /** 一次真实请求；失败返回 fixture 同构决策（fixture=true）。
   *  实时约束：attempts=2 / 8s 超时 → 最坏 ~19s 兜底，避免长静默；下一次小节仍会重试真实渠道（自愈）。 */
  async _decide(state, questions) {
    try {
      const out = await askJev({ state, questions }, {
        channel: this.cfg.channel, apiKey: this.cfg.apiKey, signal: this.cfg.signal, rng: this.rng,
        attempts: 2, timeoutMs: 8000,
      });
      return { ...out, provider: this.cfg.channel };
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      return { answers: fixtureAnswer(questions, this.rng), inputTokens: 0, usd: 0, ms: 0, fixture: true, provider: 'fixture', error: String(e?.message ?? e) };
    }
  }

  async nextBar() {
    const plan = this.plan;
    const pos = this._position();
    this.pitchCenter = clamp(this.pitchCenter + (this.rng() * 2 - 1) * 3 + (72 - this.pitchCenter) * 0.08, 62, 80);
    if (pos.barInPhrase === 0 && this.rng() < 0.25) this.pitchCenter = Math.min(80, this.pitchCenter + 10); // 1/4 的乐句整体换音区
    const intensityCurve = clamp(
      intensityTarget(plan, pos.progress, pos.isPhraseEnd)
      + (/强|响|climax|louder|爆发/i.test(this.directorNote) ? 0.7 : 0)
      - (/弱|轻|渐弱|softer|收/i.test(this.directorNote) ? 0.7 : 0),
      0, 3,
    );

    const recentRoots = this.history.slice(-6).map((b) => b.chord.rootPc);
    const loopLocked = detectLoop(recentRoots).locked;
    const cands = chordCandidates(this.style, plan, this.currentSymRoman, pos.barInPhrase, pos.isPhraseEnd, this.lastPhraseFirst, recentRoots, this.rootFatigue);

    // 左手：连续同织体衰减 + 导演指示偏置
    const lastLh = this.history.at(-1)?.decision.lh ?? null;
    let lhRepeat = 0;
    for (const b of [...this.history].reverse()) { if (b.decision.lh === lastLh) lhRepeat++; else break; }
    const lhs = lhCandidates(this.style, intensityCurve, lastLh, lhRepeat);
    if (/左手.*(密|忙|多|busy)|bass.*busy/i.test(this.directorNote)) {
      for (const id of ['broken', 'stride', 'walk', 'octave']) if (lhs[id]) lhs[id].w += 0.6;
    }
    if (/左手.*(疏|少|简|sparse|less)/i.test(this.directorNote)) {
      for (const id of ['pad', 'ballad', 'block']) if (lhs[id]) lhs[id].w += 0.6;
    }

    const rhythms = rhythmCandidates(plan, this.motif, pos.phrase);
    if (/主题|动机|motif|再现/i.test(this.directorNote) && rhythms.motif) rhythms.motif.w += 0.8;
    const contours = contourWeights(plan, pos.barInPhrase);
    if (/主题|动机|motif|再现/i.test(this.directorNote)) contours.stay += 0.3;

    // fixture score 权重：距离期望位置越近权重越高
    const scoreW = {};
    for (let l = 0; l < 4; l++) scoreW[String(l)] = 1 / (0.5 + Math.abs(l - intensityCurve));
    const breatheP = pos.isPhraseEnd ? 0.65 : (plan.density < 0.4 ? 0.3 : 0.12);

    // 发展手法 fixture 权重：刚"承袭"过就抑制承袭；乐句头鼓励新句；高密度鼓励装饰
    const devW = { repeat: 0.5, sequence: 1.1, inversion: 0.5, ornament: 0.9, new: 0.9 };
    if (pos.barInPhrase <= 1) devW.new += 0.5;
    if (pos.isPhraseEnd) devW.repeat += 0.4;
    if (this.developHistory.at(-1) === 'repeat') devW.repeat *= 0.3;
    if (plan.density > 0.6) devW.ornament += 0.2;

    const state = {
      piece: {
        style: `${this.style.id} solo piano improvisation`, mood: plan.mood, goal: plan.goal,
        arc: plan.arc, key: `${NOTE_NAMES[plan.keyPc]} ${plan.mode}`, meter: `${plan.meterNum}/4`, bpm: plan.bpm,
      },
      position: {
        bar: pos.bar, bar_in_phrase: pos.barInPhrase + 1, phrase: pos.phrase + 1,
        is_phrase_end: pos.isPhraseEnd, progress: Number(pos.progress.toFixed(2)),
      },
      harmony: { current: this.currentChord?.symbol ?? null, current_roman: this.currentSymRoman, recent: this.history.slice(-4).map((b) => b.chord.symbol), loop_locked: loopLocked },
      last_bar: this.history.length ? {
        lh: this.history.at(-1).decision.lh, contour: this.history.at(-1).decision.contour,
        tier: this.history.at(-1).decision.tier, ended_on: this.lastEndMidi ? midiName(this.lastEndMidi) : null,
        melody: this.prevMelody ? { first: midiName(this.prevMelody.startMidi), notes: this.prevMelody.onsets.length, intervals: this.prevMelody.intervals } : null,
        dev: this.developHistory.at(-1) ?? null,
      } : null,
      intensity_so_far: Number(this.intensitySoFar.toFixed(2)),
      motif: this.motif ? `phrase-1 motif: rhythm ${this.motif.rhythmId}, contour ${this.motif.contourId} (reuse or vary it)` : 'the first phrase is being born',
      recent_developments: this.developHistory.slice(-3),
      director_note: this.directorNote || undefined,
      user_prompt: plan.prompt,
    };
    const honorNote = ' Honor `director_note` in state when present.';
    const questions = {
      chord: {
        type: 'choice',
        instructions: `You are the harmony planner of a live piano improvisation. Choose the chord for the NEXT bar. Keep voice leading smooth from \`harmony.current\`, serve the style and mood, and respect phrase endings (prefer V or I at phrase ends, I at phrase starts). Answer ONLY with the Choice question "chord".`,
        criteria: Object.fromEntries(cands.map((c) => [c.sym, c.desc])),
        _fixture: { weights: Object.fromEntries(cands.map((c) => [c.sym, c.weight])) },
      },
      lh: {
        type: 'choice',
        instructions: `Choose the left-hand accompaniment pattern for the NEXT bar, fitting the chord, intensity and style.${honorNote} Answer ONLY with the Choice question "lh".`,
        criteria: Object.fromEntries(Object.entries(lhs).map(([id, v]) => [id, v.desc])),
        _fixture: { weights: Object.fromEntries(Object.entries(lhs).map(([id, v]) => [id, v.w])) },
      },
      rhythm: {
        type: 'choice',
        instructions: `Choose the right-hand rhythm pattern for the NEXT bar (tier 0=sparse 1=medium 2=dense). It will be varied by the kernel, so choose the character, not the literal grid.${honorNote} Answer ONLY with the Choice question "rhythm".`,
        criteria: Object.fromEntries(Object.entries(rhythms).map(([id, v]) => [id, id === 'motif' ? 'reuse the opening motif' : `tier ${v.tier} pattern`])),
        _fixture: { weights: Object.fromEntries(Object.entries(rhythms).map(([id, v]) => [id, v.w])) },
      },
      contour: {
        type: 'choice',
        instructions: `Choose the melodic contour of the NEXT bar. Answer ONLY with the Choice question "contour".`,
        criteria: { rise: 'climbing', fall: 'descending', arch: 'up then down', wave: 'undulating', stay: 'repeat around one tone' },
        _fixture: { weights: contours },
      },
      intensity: {
        type: 'score',
        instructions: `Musical intensity for the NEXT bar on 0-3, given arc, phrase position and history.${honorNote}`,
        criteria: ['very soft, airy', 'gentle', 'confident, fuller texture', 'climactic, full sound'],
        _fixture: { weights: scoreW },
      },
      breathe: {
        type: 'noul',
        instructions: 'Should the melody breathe (start after a rest) in the NEXT bar?',
        criteria: { true: 'yes, leave space', false: 'no, keep singing' },
        _fixture: { weights: { true: breatheP, false: 1 - breatheP } },
      },
      develop: {
        type: 'choice',
        instructions: `You are shaping melodic variety. \`last_bar.melody\` describes what was just played; a literal repeat of it would be boring. Choose how the NEXT bar's melody develops.${honorNote} Answer ONLY with the Choice question "develop".`,
        criteria: { ...DEVELOP_OPS },
        _fixture: { weights: devW },
      },
    };

    const dec = await this._decide(state, questions);


    // 解析答案（越界/非法一律回退到本地期望值）
    const ans = dec.answers ?? {};
    // jevthoven 铁律：候选集之外的答案一律拒绝（否则真实模型会用标签报出被排除的循环和弦）
    const chordSymRawRaw = String(ans.chord?.value ?? '');
    const picked = cands.find((c) => c.sym === chordSymRawRaw || c.label === chordSymRawRaw);
    const chordSymRaw = picked ? picked.sym : cands[0].sym; // 非法作答 → 最高权重候选
    const chordP = picked ?? cands[0];
    const chord = { symbol: chordLabel(chordP.rootPc, chordP.shape), ...chordP };
    if (pos.barInPhrase === 0) this.lastPhraseFirst = chordSymRaw;
    this.currentSymRoman = chordSymRaw;
    for (const k of Object.keys(this.rootFatigue)) this.rootFatigue[k] *= 0.93; // 全体衰减：休整约 2 小节后可回归
    this.rootFatigue[chord.rootPc] = (this.rootFatigue[chord.rootPc] ?? 0) + 1;
    const lh = lhs[ans.lh?.value] ? ans.lh.value : this.style.lh[0];
    const rhythmEntry = rhythms[ans.rhythm?.value] ?? rhythms.r0;
    const contour = CONTOURS[ans.contour?.value] ? ans.contour.value : 'wave';
    const intensity = clamp(Number.isFinite(Number(ans.intensity?.value)) ? Number(ans.intensity.value) : intensityCurve, 0, 3);
    const breathe = ans.breathe?.value == null ? (this.rng() < breatheP) : !!ans.breathe.value;
    const dev = DEVELOP_OPS[ans.develop?.value] ? ans.develop.value : 'new';
    this.developHistory.push(dev);
    if (this.developHistory.length > 8) this.developHistory.shift();

    // 旋律：按发展手法渲染（呼吸小节一律用新素材，避免从上一句继承开头）
    const scale = scaleMidis(plan.keyPc, plan.melodyScale, 58, 86);
    const chordPool = chordMidis(chord.rootPc, chord.shape, 58, 86);
    const startHint = pos.barInPhrase === 0 ? nearest(this.pitchCenter, chordPool) : this.lastEndMidi;
    const varied = varyPattern(rhythmEntry.pat, this.rng, plan.meterNum);
    const usePrev = !breathe && !!this.prevMelody && (dev === 'sequence' || dev === 'inversion');

    let rh = usePrev
      ? buildFromPrev(this.prevMelody, { dir: dev === 'sequence' ? (this.rng() < 0.5 ? 1 : -1) : 0, invert: dev === 'inversion', chord, scale, meterNum: plan.meterNum, intensity, isPhraseEnd: pos.isPhraseEnd, rng: this.rng })
      : renderMelody({ plan, chord, contourId: contour, pattern: varied, breathe, intensity, isPhraseEnd: pos.isPhraseEnd, startHint, rng: this.rng });
    if (!usePrev && dev === 'ornament') rh = insertPassing(rh, scale, this.rng);

    // 反重复护栏 + 乐句尾锚定
    if (pos.isPhraseEnd) snapLastToChord(rh, chord);
    if (this.lastSigs.includes(sigOf(rh))) {
      rh = mutateMelody(rh, { scale, rng: this.rng, avoid: this.lastSigs });
      if (pos.isPhraseEnd) snapLastToChord(rh, chord);
    }
    this.lastSigs = [sigOf(rh), ...this.lastSigs].slice(0, 2);

    // 记录本小节旋律素材（供下一小节模进/倒影）
    this.prevMelody = {
      startMidi: rh[0]?.midi ?? this.lastEndMidi,
      onsets: rh.map((n) => n.startBeats),
      intervals: rh.map((n, i, a) => (i ? n.midi - a[i - 1].midi : 0)).slice(1),
    };

    const notes = [
      ...renderLH({ plan, chord, patternId: lh, intensity, rng: this.rng }),
      ...rh,
    ];
    this.lastEndMidi = rh.length ? rh.at(-1).midi : this.lastEndMidi;
    this.intensitySoFar = this.intensitySoFar * 0.7 + intensity * 0.3;
    this.currentChord = chord;

    if (!this.motif && pos.bar === 1) this.motif = { rhythmId: ans.rhythm?.value ?? 'r0', contourId: contour, pattern: rhythmEntry.pat };

    const bar = {
      index: pos.bar, loop: pos.loop,
      label: `${'ABCDEFGHIJKLMNOP'[Math.floor(pos.bar / plan.barsPerPhrase) % 16]}${pos.barInPhrase + 1}`,
      chord, notes,
      intensity,
      decision: {
        provider: dec.provider, fixture: !!dec.fixture, ms: dec.ms ?? 0,
        inputTokens: dec.inputTokens ?? 0, usd: dec.usd ?? 0,
        lh, contour, tier: rhythmEntry.tier ?? 1, breathe, develop: dev, roman: chordSymRaw,
        confidence: ans.chord?.confidence ?? ans.chord?.probability ?? null,
        answers: ans, candidates: Object.keys(questions.chord.criteria),
      },
    };
    this.history.push(bar);
    if (this.history.length > 8) this.history.shift();
    this.index++;
    return bar;
  }
}
