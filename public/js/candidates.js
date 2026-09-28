// candidates.js — 候选集构造：**给模型的可选域**（ADR-0003 的发送侧）。
// 与 composer.js 的分工：本模块只回答"哪些选择合法、各自多大概率"，绝不渲染音符；
// 反重复的"候选侧"机制也住在这里（根音疲劳断路器、循环锁死断路器）——剔除即强制（ADR-0003）。
// 纯函数，无副作用，可直接单测。
import { LH_DEFS, RHYTHM_POOLS, parseRoman, chordLabel } from './music.js';

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

const ROMAN_BY_PC = { 0: 'I', 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV', 6: 'bV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };

/** 和谐循环检测（按根音）：最近 window 小节内 ≤maxDistinct 个不同根音即视为锁死，members = 循环根音集合。
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
      if (banned(p.rootPc)) continue; // 替换和弦不能把被断路器剔除的根音偷渡回来
      list.push({ ...s, ...p });
    }
    return list;
  };
  // 兜底判据是"候选够用"（≥3，与下面的回填阈值一致）而不是"非空"：
  // 断路器很凶时主池被剔光、只剩 1 个替换和弦幸存，若只看 !out.length 会误判为健康而跳过兜底。
  let out = build(true, true);
  if (out.length < 3) out = build(false, true);
  if (out.length < 3) out = build(false, false);
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
  return Math.min(3, Math.max(0, v - (isPhraseEnd ? 0.5 : 0)));
}

