// candidates.js — 候选集构造：**给模型的可选域**（ADR-0003 的发送侧）。
// 与 composer.js 的分工：本模块只回答"哪些选择合法、各自多大概率"，绝不渲染音符；
// 反重复的"候选侧"机制也住在这里（根音疲劳断路器、循环锁死断路器）——剔除即强制（ADR-0003）。
// 纯函数，无副作用，可直接单测。
import { LH_DEFS, RHYTHM_POOLS, parseRoman, chordLabel, chordPcs, modePalette, functionOf, HARMONIC_FUNCTIONS, ROMAN_BY_PC } from './music.js';

/** 根音的和谐角色（写进 criteria，让模型知道每个候选"意味着什么"） */
const ROOT_ROLE = {
  0: '主和弦，稳定归宿', 7: '属和弦，张力推动解决', 5: '下属色彩，铺垫',
  9: '中音/相对调色彩', 2: '上主音，过渡', 11: '导音，强烈倾向主',
  3: '三度借用，柔和', 8: '下中音，深沉', 4: '三音级，明亮', 10: '下主音，混合色彩',
  6: '减和弦，戏剧性', 1: '变化音，意外感',
};

/** 强度曲线（fixture score 的期望位置） */
const ARC_CURVES = {
  flat: (p) => 0.9 + 0.3 * Math.sin(Math.PI * p),
  rise: (p) => 0.6 + 1.8 * p,
  arch: (p) => 0.7 + 1.8 * Math.sin(Math.PI * p),
  fall: (p) => 2.4 - 1.8 * p,
};

/** 共同音数：两和弦的音级交集大小——声部进行平滑度的核心指标（0..4） */
export function commonTones(shapeA, rootA, shapeB, rootB) {
  const a = new Set(chordPcs(rootA, shapeA));
  return chordPcs(rootB, shapeB).filter((pc) => a.has(pc)).length;
}

/** 根音在五度圈上的环形距离（0..6）：C→G=1、C→F=1、C→C#=2 */
export function fifthsDist(rootA, rootB) {
  const d = Math.abs((((rootA * 7) % 12) + 12) % 12 - (((rootB * 7) % 12) + 12) % 12);
  return Math.min(d, 12 - d);
}

/** 声部进行平滑度：共音越多越平滑，五度圈上越近越平滑 */
export function smoothness(cur, cand) {
  if (!cur) return 0;
  return commonTones(cur.shape, cur.rootPc, cand.shape, cand.rootPc) * 1.0 - fifthsDist(cur.rootPc, cand.rootPc) * 0.25;
}

// 功能转移矩阵：T→S/D，S→D/Tp，D→T，Tp→D/T（经典功能和声：大写=稳定/下属/属三区）
const FN_NEXT = {
  T: { S: 1.0, D: 1.0, T: 0.3, Tp: 0.5 },
  S: { D: 1.2, Tp: 1.0, T: 0.4, S: 0.2 },
  D: { T: 1.6, Tp: 0.9, S: 0.3, D: 0.2 },
  Tp: { D: 1.0, T: 0.9, S: 0.5, Tp: 0.3 },
};

// 声部进行权重与功能转移权重的系数（两者相加，量纲 ≈ 共同音数与功能边权）
// 声部进行权重与功能转移权重的系数（两者相加，量纲 ≈ 共同音数与功能边权）。
// W_SMOOTH 实测锁在 0.5：调到 0.35 能把音程熵抬到 2.57，但会让旋律指纹护栏在 12 种子中失败 3 次
// （相邻字面重复 >0）。硬不变量优先于软指标——见 docs/memory/2026-09-28-harmonic-function-layer.md。
const W_SMOOTH = 0.5;
const W_FN = 0.8;
// 色板条目的基础权重：低于进行池的 1.0（保住曲风身份），但高到能凭平滑度/功能加分挤进候选
const W_PALETTE = 0.8;

/** 第 7 问的候选：下一小节该选哪个和声功能（不硬过滤和弦，只作语义提示与回落依据） */
export function functionCandidates(plan, curFn, isPhraseEnd, barInPhrase) {
  const base = { ...(FN_NEXT[curFn] ?? FN_NEXT.T) };
  if (isPhraseEnd) { base.T += 1.0; base.D += 0.5; base.S *= 0.4; base.Tp *= 0.4; }
  if (barInPhrase === 0) base.T += 0.6;
  const out = {};
  for (const [k, v] of Object.entries(base)) if (v > 0) out[k] = { w: v, desc: HARMONIC_FUNCTIONS[k] };
  return out;
}

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
 *  recentRoots 用于循环锁死断路器：最近若干根音绕成环时，循环成员直接从候选中剔除（代码策划候选集）。
 *  与根音疲劳互补——疲劳是"用得太多"（阈值 2.0，衰减 0.93，攒得慢），锁死是"结构上正在绕圈"（当小节即生效）。 */
export function chordCandidates(style, plan, currentSym, barInPhrase, isPhraseEnd, lastPhraseFirst = null, recentRoots = [], fatigue = {}, opts = {}) {
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
  // 候选全集 = 风格进行池 ∪ 调式全调内色板。
  // 色板是关键扩充：只有池时，每条 pool 4 个和弦 → 候选词汇有天花板（romantic 小调仅 6 个根音）；
  // 并入色板后词汇随调式自动增长，且池内符号的既有权重/音色（七和弦等）原样保留。
  for (const c of modePalette(plan.mode)) {
    if (cand.has(c.sym)) continue; // 池里已有（如 V7），不被色板的三和弦条目覆盖
    cand.set(c.sym, { w: W_PALETTE, cont: false, pools: 0, palette: true });
  }
  // 替换候选：让 Jev 有进行池之外的和声选择，打破 4 和弦循环
  const curSym = currentSym ? parseRoman(currentSym) : null;
  const curFn = curSym ? (functionOf(currentSym, plan.mode) ?? 'T') : null;
  const fnNext = FN_NEXT[curFn] ?? {};
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
  const loop = detectLoop(recentRoots);
  const loopMembers = loop.locked ? loop.members : new Set();
  // 两条断路器的取舍顺序：疲劳是自衰减的软约束（等得起），锁死是当小节正在发生的硬事实（等不得），
  // 所以优先放掉疲劳、保留锁死；三段构建保证候选集永不为空。
  const build = (respectFatigue, respectLoop) => {
    const banned = (rootPc) =>
      (respectFatigue && fatigued(rootPc)) || (respectLoop && loopMembers.has(rootPc));
    const list = [];
    for (const [sym, { w, cont, pools }] of cand) {
      const p = parseRoman(sym);
      if (!p) continue;
      if (banned(p.rootPc)) continue; // 根音疲劳 / 循环锁死：近期用滥或在环上的根音不可表示
      let weight = w;
      if (barInPhrase === 0 && p.rootPc === 0) weight += 0.6;
      if (isPhraseEnd && (p.rootPc === 7 || p.rootPc === 0)) weight += 1.0;
      // 段落边界比乐句边界更强：新段落重新立足（T），段落收束用更确定的终止式
      if (opts.sectionStart && p.rootPc === 0) weight += 1.0;
      if (opts.sectionEnd && (p.rootPc === 7 || p.rootPc === 0)) weight += 0.8;
      if (currentSym && norm(currentSym) === sym) weight -= 1.2 * pools; // 连续同和弦：按池数放大罚分
      if (barInPhrase === 0 && lastPhraseFirst && sym !== norm(lastPhraseFirst) && [0, 5, 9].includes(p.rootPc)) {
        weight += 0.5; // 乐句开头换进行：换个起点，别每段都一样开场
      }
      const role = ROOT_ROLE[p.rootPc] ?? '色彩和弦';
      const fn = functionOf(sym, plan.mode) ?? 'Tp';
      // 声部进行 + 功能转移：可解释的加权取代"纯池计数"启发式
      weight += smoothness(curSym, p) * W_SMOOTH;
      weight += (fnNext[fn] ?? 0.25) * W_FN;
      const fnMark = { T: '·主功能', S: '·下属功能', D: '·属功能', Tp: '·色彩功能' }[fn];
      const desc = `${role}${fnMark}${p.shape.includes('7') || p.shape.includes('9') ? '（延伸音色）' : ''}${cont ? '；进行计划的延续' : ''}`;
      list.push({ sym, weight, desc, label: chordLabel(p.rootPc, p.shape), fn, ...p });
    }
    for (const s of subs) {
      const p = parseRoman(s.sym);
      if (!p || list.some((c) => c.sym === s.sym)) continue;
      if (banned(p.rootPc)) continue; // 替换和弦不能把被断路器剔除的根音偷渡回来
      const fn = functionOf(s.sym, plan.mode) ?? 'Tp';
      const w = s.weight + smoothness(curSym, p) * W_SMOOTH + (fnNext[fn] ?? 0.25) * W_FN;
      list.push({ ...s, weight: w, fn, desc: `${s.desc}（${fn} 功能）`, ...p });
    }
    return list;
  };
  // 兜底判据是"候选够用"（≥3，与下面的回填阈值一致）而不是"非空"：
  // 断路器很凶时主池被剔光、只剩 1 个替换和弦幸存，若只看 !out.length 会误判为健康而跳过兜底。
  let out = build(true, true);
  if (out.length < 3) out = build(false, true);
  if (out.length < 3) out = build(false, false);
  out.sort((a, b) => b.weight - a.weight);
  // 名额从 6+2 放宽到 7+2：色板扩充若没有名额就是死代码（池和弦会占满前 6）
  const poolTop = out.filter((c) => !c.sub).slice(0, 7);
  const subTop = out.filter((c) => c.sub).slice(0, 2);
  const merged = [...poolTop, ...subTop].sort((a, b) => b.weight - a.weight).slice(0, 9);
  if (merged.length < 3) { // 安全兜底：排除过度时按权重回填
    const rest = out.filter((c) => !merged.includes(c)).slice(0, 3 - merged.length);
    return [...merged, ...rest];
  }
  return merged;
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

/** 曲式模板：段落 id / 内部弧线 / 基准强度 / 内部起伏幅度。这是经典的 A–B–A'–Coda 四段式。
 *  level 决定该段"响到什么程度"，arc 决定该段"内部怎么走"，swing 是起伏的比例。
 *  **Coda 的 level 是相对该曲式的，不是绝对安静**——上升曲式的尾声仍应比开场响
 *  （"庆典"收得比开场更轻是反直觉的）；Coda 的任务是收束，不是归零。 */
const FORM_TEMPLATES = {
  arch: [['A', 'flat', 1.4, 0.3], ['B', 'arch', 2.2, 0.6], ["A'", 'flat', 1.6, 0.35], ['Coda', 'fall', 0.8, 0.25]],
  rise: [['A', 'flat', 1.2, 0.25], ['B', 'rise', 1.9, 0.5], ["A'", 'rise', 2.1, 0.45], ['Coda', 'fall', 1.9, 0.2]],
  fall: [['A', 'flat', 1.9, 0.35], ['B', 'fall', 1.5, 0.45], ["A'", 'fall', 1.1, 0.4], ['Coda', 'fall', 0.6, 0.2]],
  flat: [['A', 'flat', 1.4, 0.25], ['B', 'arch', 2.1, 0.55], ["A'", 'flat', 1.5, 0.3], ['Coda', 'flat', 1.0, 0.2]],
};

/** 段落数：短曲 2 段，正常长度 4 段。每段长度取乐句长度的整数倍，段落边界与乐句边界天然对齐。 */
export function deriveSections(arc, totalBars, barsPerPhrase = 8) {
  const bars = Math.max(1, Math.round(Number(totalBars) || 32));
  const n = bars >= barsPerPhrase * 3 ? 4 : 2;
  const tpl = FORM_TEMPLATES[arc] ?? FORM_TEMPLATES.arch;
  // 模板比段数长时取前三段 + 收束段（rise 的 5 段模板在 4 段曲里丢掉 Climax，保留 Coda）
  const picks = n === 4 && tpl.length > 4 ? [tpl[0], tpl[1], tpl[2], tpl.at(-1)] : tpl.slice(0, n);
  const per = Math.floor(bars / picks.length);
  const out = [];
  for (let i = 0; i < picks.length; i++) {
    const [id, a, level, swing] = picks[i];
    const count = i === picks.length - 1 ? bars - per * (picks.length - 1) : per;
    if (count > 0) out.push({ id, arc: a, level, swing, bars: count, start: per * i });
  }
  return out;
}

/** 某小节属于哪个段落；越界取首/末段，非法输入返回 null */
export function sectionAt(sections, bar) {
  if (!Array.isArray(sections) || !sections.length) return null;
  const b = Number(bar) || 0;
  for (const s of sections) if (b >= s.start && b < s.start + s.bars) return s;
  return b < 0 ? sections[0] : sections.at(-1);
}

/** 强度曲线值：段落感知——每段用自己的 arc 与基准值，段内再走局部弧线。
 *  没有 sections 时退化为全局弧线（旧项目 JSON / 无段落计划时的兼容路径）。 */
export function intensityTarget(plan, progress, isPhraseEnd, barsPerPhrase = 8) {
  const total = Math.max(1, Number(plan?.totalBars) || 32);
  const bar = Math.min(total - 1, Math.max(0, Math.floor(progress * total)));
  const sec = sectionAt(plan?.sections, bar);
  let v;
  if (sec) {
    const local = sec.bars > 1 ? (bar - sec.start) / (sec.bars - 1) : 0;
    v = sec.level + ((ARC_CURVES[sec.arc] ?? ARC_CURVES.arch)(local) - 1.3) * (sec.swing ?? 0.4);
  } else {
    v = (ARC_CURVES[plan?.arc] ?? ARC_CURVES.arch)(progress);
  }
  return Math.min(3, Math.max(0, v - (isPhraseEnd ? 0.5 : 0)));
}

/** 速度乘数的边界：推进感 +4%，rit. 最低 −20%（真人尾声常见 −15%~−25% 的保守取值） */
const TEMPO_PUSH = 1.04, TEMPO_RIT_FLOOR = 0.8;

/**
 * 速度弧线（每小节一个乘数，小节内恒速）：曲式的「时间形状」。
 * 最后一段线性 rit.（1.0 → 0.8，曲尾渐慢是真人演奏最基本的呼吸）；
 * 非尾段的 arch/rise 段轻微推进（+4%，对比段与攀升段自带「往前赶」的体感）；其余恒速。
 * 与 intensityTarget 同层、同约定：描述**计划**而非已生成音乐，脏输入降级、绝不抛错；
 * 消费方是 player（实时排程）与 midi（set_tempo 事件）——渲染层，不参与任何决策。
 */
export function tempoMultAt(plan, bar) {
  const clampMult = (v) => Math.min(TEMPO_PUSH, Math.max(TEMPO_RIT_FLOOR, v));
  const total = Math.max(1, Number(plan?.totalBars) || 32);
  const b = Math.min(total - 1, Math.max(0, Math.floor(Number(bar) || 0)));
  const secs = Array.isArray(plan?.sections) ? plan.sections : [];
  const sec = sectionAt(secs, b);
  if (!sec || secs.length < 2) {
    // 旧计划兼容（无 sections）：最后 1/4 曲长从 1.0 缓降到 0.85
    const tailStart = total * 0.75;
    if (b <= tailStart) return 1;
    return clampMult(1 - 0.15 * ((b - tailStart) / Math.max(1, total * 0.25)));
  }
  const isLast = sec === secs.at(-1);
  if (isLast) {
    if (sec.bars <= 1) return 1; // 单小节的"尾声"没有滑动的余地，硬渐慢只会突兀
    const p = (b - sec.start) / (sec.bars - 1);
    return clampMult(1 - 0.2 * p);
  }
  if (sec.arc === 'arch' || sec.arc === 'rise') return TEMPO_PUSH;
  return 1;
}

/**
 * 发展手法（第 7 问）权重。**段落边界有特殊语义**：
 *  段落首大幅偏向 repeat（承袭）——A→A' 的听觉关联正是靠「同一动机在新段落里再出现一次」建立的；
 *  没有这一步，两段只是并置而不是呼应。同时压制 new——新段落不是「另起新句」，是「重述」。
 */
export function developCandidates(plan, { barInPhrase = 0, isPhraseEnd = false, lastDevelop = null, sectionStart = false, sectionEnd = false } = {}) {
  const w = { repeat: 0.5, sequence: 1.1, inversion: 0.5, ornament: 0.9, new: 0.9 };
  if (barInPhrase <= 1) w.new += 0.5;
  if (isPhraseEnd) w.repeat += 0.4;
  if (lastDevelop === 'repeat') w.repeat *= 0.3;
  if ((plan?.density ?? 0.5) > 0.6) w.ornament += 0.2;
  if (sectionStart) { w.repeat += 1.6; w.new *= 0.3; }
  if (sectionEnd) { w.repeat += 0.8; w.inversion += 0.4; }
  return w;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** 计划张力序列：把 intensityTarget 归一到 0..1，供张力对照带的「计划弧线」幽灵线使用。
 *  放在本模块而不是 tension.js —— 它由 intensityTarget 派生、描述的是**计划**而非已生成的音乐；
 *  放进分析层会造成「分析依赖决策」的反向耦合。 */
export function planTargetSeries(plan, barsPerPhrase = 8) {
  const total = Math.max(1, Number(plan?.totalBars) || 32);
  const out = [];
  for (let i = 0; i < total; i++) {
    const isPhraseEnd = (i % barsPerPhrase) === barsPerPhrase - 1;
    out.push(clamp01(intensityTarget(plan, i / total, isPhraseEnd, barsPerPhrase) / 3));
  }
  return out;
}

