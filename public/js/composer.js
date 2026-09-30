// composer.js — 编曲决策器：Jev 每小节一次请求（七问并行），代码把选择渲染成音符。
// 真实 Jev 不可用时（无 key/CORS/断网），fixture 采样器用同一候选集与权重同构兜底，播放永不中断。
import {
  STYLE_BY_ID, NOTE_NAMES,
  chordLabel, chordMidis, scaleMidis, nearest, lhVoicing, midiName, keywordPlan, functionOf,
} from './music.js';
import { askJev, fixtureAnswer, expandPlan } from './jev.js';
import { detectLoop, chordCandidates, lhCandidates, rhythmCandidates, contourWeights, intensityTarget, functionCandidates, deriveSections, sectionAt, developCandidates } from './candidates.js';
import {
  CONTOUR_STEPS as CONTOURS, DEVELOP_OPS, sigOf, snapLastToChord, insertPassing, mutateMelody, melodyIntervals,
  buildFromPrev, buildFromMotif, breatheDelay, varyPattern, renderMelody, renderLH,
} from './render.js';

/**
 * 校验 LLM 给的段落：数量 2..5、arc 合法、level ∈ [0,3]，长度不超剩余。
 * 任一项不合格返回 null —— 调用方回退到 `deriveSections` 的模板。
 * LLM 不必给 bars：缺省会均分到剩余长度，因此提示词可以只要求 id/arc/level。
 */
export function sanitizeSections(raw, totalBars) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 5) return null;
  const total = Math.max(1, Number(totalBars) || 32);
  const out = [];
  let start = 0;
  for (let i = 0; i < raw.length && start < total; i++) {
    const s = raw[i];
    if (!s || !['flat', 'rise', 'arch', 'fall'].includes(s.arc)) return null;
    const level = Number(s.level);
    if (!Number.isFinite(level) || level < 0 || level > 3) return null;
    const rest = total - start;
    const left = raw.length - i;
    const n = Math.max(1, Math.min(rest - (left - 1), Math.round(Number(s.bars) || rest / left) || 1));
    const swing = Number(s.swing);
    out.push({ id: String(s.id ?? i + 1).slice(0, 8), arc: s.arc, level, swing: Number.isFinite(swing) ? clamp(swing, 0, 1) : 0.4, bars: n, start });
    start += n;
  }
  return out.length >= 2 ? out : null;
}

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

/** 强度的连续化参数。Jev 的 score 问按 API 契约只能答整数 0-3，但音乐需要连续动态：
 *  实测直接渲染整数会让相邻小节平均跳 1.03 档、26.9% 的跳变 ≥2 档、6.2% 跳满 3 档
 *  （力度 2.4 倍落差 + 左手织体分支同时翻转）。
 *  dev  = 模型保留「相对计划弧线」偏移的比例（0.5 = 仍有一半发言权，不架空模型）
 *  slew = 每小节允许的最大强度变化档数（速率限制，与压缩器 attack/release、MIDI CC 平滑同思路） */
export const INTENSITY_DEV = 0.5;
export const INTENSITY_SLEW = 1.0;

/** 目标（goal）对计划参数的偏置 */
export const GOAL_HINTS = {
  '放松助眠': { arc: 'flat', density: -0.15, brightness: -0.15 },
  '专注陪伴': { arc: 'flat' },
  '情绪宣泄': { arc: 'arch', density: 0.15 },
  '欢快庆典': { arc: 'rise', brightness: 0.15 },
  '随机冒险': {},
};


/** 由关键词/LLM 产出装配出完整合法的 Plan；keyPc 为用户指定的移调（0..11，null = 自动） */
export async function buildPlan({ prompt = '', goal = '随机冒险', styleId = 'random', seed = 1, bars = 32, keyPc = null } = {}, cfg = {}) {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const style = styleId !== 'random' && STYLE_BY_ID[styleId] ? STYLE_BY_ID[styleId] : null;
  const hint = { style: style?.name, goal };

  let base = null;
  let llmSections = null;
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
        llmSections = raw.sections ?? null;   // 系统二：让 LLM 规划曲式（可选字段，非法则回退模板）
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
  const barsPerPhrase = 8;
  const totalBars = clamp(bars, 8, 128);
  return {
    ...base,
    title: base.title || `${prompt.slice(0, 12) || '无名'} · 即兴`,
    prompt: String(prompt).slice(0, 200),
    goal, seed,
    keyPc: base.keyPc ?? 0,
    meterNum: meterNum || 4, meterDen: meterDen || 4,
    barsPerPhrase,
    totalBars,
    // 曲式（系统二）：LLM 给了就采纳它的，否则按弧线模板派生 A–B–A'–Coda
    sections: sanitizeSections(llmSections, totalBars) ?? deriveSections(base.arc, totalBars, barsPerPhrase),
    melodyScale: base.mode === 'pentatonic' ? (st.id === 'oriental' ? 'pentatonicMinor' : 'pentatonicMajor') : base.mode,
    styleName: st.name,
  };
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
    this.lastIntensity = null;    // 上一小节实际渲染的强度（速率限制的参考点）
    this.directorNote = '';        // 用户自然语言演奏指示，实时生效
    this.pitchCenter = 72;         // 音区中心缓慢漂移，避免旋律总绕着同一个音域打转
    this.lastSigs = [];            // 最近两小节旋律指纹（反重复护栏）
    this.lastLhSigs = [];          // 最近两小节左手指纹（renderLH 变体不足时的兜底）
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

    const recentRoots = this.history.slice(-6).map((b) => b.chord.relPc);
    const loopLocked = detectLoop(recentRoots).locked;
    // 段落边界标志：曲式在和声与动机上的语义（段落比乐句更强）
    const secHere = sectionAt(plan.sections, this.index);
    const sectionStart = !!secHere && secHere.start === this.index;
    const sectionEnd = !!secHere && secHere.start + secHere.bars - 1 === this.index;
    // 乐句问答（轮次 23，古典 period 结构）：每个 8 小节乐句 = **前四小节问 + 后四小节答**。
    // barInPhrase===3 是问句尾（半终止：偏属开放、「停在看家的路上」）；barInPhrase===7 是答句尾
    // （全终止：V/I 收束，原行为）。段落语义与之分层：段落末（乐句尾）收束更强，段落首照常立足。
    // 32 小节的曲式是 4 段 × 1 乐句，问句只可能住在乐句内部——这正是把它放在 bar 3 而不是
    // 「奇数乐句尾」的原因：那样它与段落收束在每一段都撞车（首轮实现被自己的测试抓住）。
    const isQuestionEnd = pos.barInPhrase === plan.barsPerPhrase / 2 - 1;
    const openEnd = isQuestionEnd;
    const cands = chordCandidates(this.style, plan, this.currentSymRoman, pos.barInPhrase, pos.isPhraseEnd, this.lastPhraseFirst, recentRoots, this.rootFatigue, { sectionStart, sectionEnd, openEnd });
    // 第 7 问「和声功能」：模型先说下一小节要往哪个功能走（语义先于音名），
    // 和弦仍在候选集内选——功能**不做硬过滤**（同一请求里无法先问功能再问和弦，
    // 硬过滤会让模型自己的合法作答被前置问题判死）。它的三个用途：语义语境、
    // 非法作答时的族内回落、UI 可读维度。
    const curFn = this.currentSymRoman ? (functionOf(this.currentSymRoman, plan.mode) ?? 'T') : 'T';
    const fnCands = functionCandidates(plan, curFn, pos.isPhraseEnd, pos.barInPhrase, { openEnd });

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
    const devW = developCandidates(plan, { barInPhrase: pos.barInPhrase, isPhraseEnd: pos.isPhraseEnd, lastDevelop: this.developHistory.at(-1) ?? null, sectionStart, sectionEnd });

    const state = {
      piece: {
        style: `${this.style.id} solo piano improvisation`, mood: plan.mood, goal: plan.goal,
        arc: plan.arc, key: `${NOTE_NAMES[plan.keyPc]} ${plan.mode}`, meter: `${plan.meterNum}/4`, bpm: plan.bpm,
      },
      position: {
        bar: pos.bar, bar_in_phrase: pos.barInPhrase + 1, phrase: pos.phrase + 1,
        is_phrase_end: pos.isPhraseEnd, progress: Number(pos.progress.toFixed(2)),
        section: secHere?.id ?? null, is_section_start: sectionStart, is_section_end: sectionEnd,
      },
      // 曲式全貌：模型需要看到 A→B→A' 的整体才谈得上「呼应」，
      // 孤立告知当前段落 id 等于没告知（它不知道下一个段落是再现还是对比）
      form: (plan.sections ?? []).map((s) => `${s.id}:${s.arc}@${s.level}`).join(' '),
      harmony: { current: this.currentChord?.symbol ?? null, current_roman: this.currentSymRoman, current_function: curFn, recent: this.history.slice(-4).map((b) => b.chord.symbol), loop_locked: loopLocked },
      last_bar: this.history.length ? {
        lh: this.history.at(-1).decision.lh, contour: this.history.at(-1).decision.contour,
        tier: this.history.at(-1).decision.tier, ended_on: this.lastEndMidi ? midiName(this.lastEndMidi) : null,
        melody: this.prevMelody ? { first: midiName(this.prevMelody.startMidi), notes: this.prevMelody.onsets.length, intervals: this.prevMelody.intervals } : null,
        dev: this.developHistory.at(-1) ?? null,
      } : null,
      intensity_so_far: Number(this.intensitySoFar.toFixed(2)),
      motif: this.motif?.midis?.length
        ? `piece motif: ${this.motif.midis.length} notes, intervals [${melodyIntervals(this.motif.midis).join(',')}], rhythm ${this.motif.rhythmId}, contour ${this.motif.contourId} (reuse "repeat"/"sequence"/"inversion"/"ornament" to develop it, or "new" to start fresh)`
        : 'the piece motif is being born',
      recent_developments: this.developHistory.slice(-3),
      director_note: this.directorNote || undefined,
      user_prompt: plan.prompt,
    };
    const honorNote = ' Honor `director_note` in state when present.';
    const questions = {
      function: {
        type: 'choice',
        instructions: `You are the harmony planner. \`harmony.current_function\` is where the music is now. Choose the harmonic FUNCTION the NEXT bar should move toward; the chord in the parallel "chord" question will belong to this function.${honorNote} Answer ONLY with the Choice question "function".`,
        criteria: Object.fromEntries(Object.entries(fnCands).map(([k, v]) => [k, v.desc])),
        _fixture: { weights: Object.fromEntries(Object.entries(fnCands).map(([k, v]) => [k, v.w])) },
      },
      chord: {
        type: 'choice',
        instructions: `You are the harmony planner of a live piano improvisation. Choose the chord for the NEXT bar, honouring the "function" you just chose. Keep voice leading smooth from \`harmony.current\`, serve the style and mood, and respect phrase endings (prefer V or I at phrase ends, I at phrase starts). Answer ONLY with the Choice question "chord".`,
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
        instructions: `You are shaping melodic variety. \`motif\` describes the piece's opening idea; \`last_bar.melody\` is what was just played. Choose how the NEXT bar relates to the motif: "repeat" restates it in the new harmony, "sequence" transposes it a step, "inversion" mirrors it, "ornament" adds passing tones, "new" starts a fresh idea (the only one that ignores the motif).${honorNote} Answer ONLY with the Choice question "develop".`,
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
    // 模型声明的功能（非法作答则取转移权重最高的那个功能）
    const fnAnswer = String(ans.function?.value ?? '');
    const declaredFn = fnCands[fnAnswer] ? fnAnswer : (Object.entries(fnCands).sort((a, b) => b[1].w - a[1].w)[0]?.[0] ?? 'T');
    // 非法作答 → 先回落到「模型声明的功能族」内权重最高的候选，再退到全局最高权重。
    // 这比单纯取 cands[0] 更聪明：模型已经用一句话告诉了我们要往哪走。
    const inFamily = cands.filter((c) => (c.fn ?? functionOf(c.sym, plan.mode)) === declaredFn);
    const chordP = picked ?? inFamily.sort((a, b) => b.weight - a.weight)[0] ?? cands[0];
    const chordSymRaw = picked ? picked.sym : chordP.sym;
    // 素材化：候选集里的 rootPc 是「相对主音的度数」（I=0），在这里加上调中心变成**绝对音高类**。
    // 修复（轮次 22）：此前这里直接把相对度数当绝对值用——keyPc 只移了旋律音阶，和声永远在 C 体系，
    // 选调/LLM 给调后旋律与和弦可以处于不同调。决策层（疲劳/锁死/功能表/roman）全部锚在 relPc，
    // 渲染层（声位/锚定/分析/工作室）用绝对 rootPc——两层各取所需，互不越界。
    const absPc = (chordP.rootPc + plan.keyPc) % 12;
    const chord = { ...chordP, rootPc: absPc, relPc: chordP.rootPc, symbol: chordLabel(absPc, chordP.shape) };
    if (pos.barInPhrase === 0) this.lastPhraseFirst = chordSymRaw;
    this.currentSymRoman = chordSymRaw;
    for (const k of Object.keys(this.rootFatigue)) this.rootFatigue[k] *= 0.93; // 全体衰减：休整约 2 小节后可回归
    this.rootFatigue[chord.relPc] = (this.rootFatigue[chord.relPc] ?? 0) + 1;
    const lh = lhs[ans.lh?.value] ? ans.lh.value : this.style.lh[0];
    const rhythmEntry = rhythms[ans.rhythm?.value] ?? rhythms.r0;
    const contour = CONTOURS[ans.contour?.value] ? ans.contour.value : 'wave';
    // score 问只能答整数 0-3；直接渲染会跳档。两步连续化：
    // ① 把整数解释为「相对计划弧线的偏移」，保留 dev 比例——模型仍决定往哪走；
    // ② 对变化率设上限——模型仍决定去哪里，只是不能一小节跳三档。
    const rawIntensity = Number(ans.intensity?.value);
    const target = Number.isFinite(rawIntensity) ? clamp(rawIntensity, 0, 3) : intensityCurve;
    const want = clamp(intensityCurve + (target - intensityCurve) * INTENSITY_DEV, 0, 3);
    const intensity = this.lastIntensity == null
      ? want
      : clamp(this.lastIntensity + clamp(want - this.lastIntensity, -INTENSITY_SLEW, INTENSITY_SLEW), 0, 3);
    this.lastIntensity = intensity;
    const breathe = ans.breathe?.value == null ? (this.rng() < breatheP) : !!ans.breathe.value;
    const dev = DEVELOP_OPS[ans.develop?.value] ? ans.develop.value : 'new';
    this.developHistory.push(dev);
    if (this.developHistory.length > 8) this.developHistory.shift();

    // 旋律：按发展手法渲染（呼吸小节一律用新素材，避免从上一句继承开头）
    const scale = scaleMidis(plan.keyPc, plan.melodyScale, 58, 86);
    const chordPool = chordMidis(chord.rootPc, chord.shape, 58, 86);
    const startHint = pos.barInPhrase === 0 ? nearest(this.pitchCenter, chordPool) : this.lastEndMidi;
    const varied = varyPattern(rhythmEntry.pat, this.rng, plan.meterNum);
    const fresh = () => renderMelody({ plan, chord, contourId: contour, pattern: varied, breathe, intensity, isPhraseEnd: pos.isPhraseEnd, startHint, rng: this.rng });
    // 发展手法的素材来源是有分工的（隔离实验：全部作用于动机会让 32 小节的旋律种类数从 ~32 掉到 23.7）：
    //  repeat（承袭）必须作用在**动机**上——它承载主题身份；此前它走的是 renderMelody（与 new 同一条路），等于什么都没承袭。
    //  sequence（模进）/ inversion（倒影）字面意思就是「对**刚才那句**做模进/倒影」，作用在 prevMelody 上。
    //  ornament（装饰）同理：作曲里的装饰是装饰**当前乐句**（颤音、邻音围绕），不是把整首主题装饰一遍。
    //  呼吸是**时值指令**（延后进入），不是**否决指令**（不许用素材）：这里不再用 !breathe 挡门，
    //  而是让每条素材路径在末尾各自施加延后量。两者都被兑现，而不是挑一个赢。
    const motifReady = !!this.motif?.midis?.length;
    const usePrev = !!this.prevMelody && (dev === 'sequence' || dev === 'inversion' || dev === 'ornament');
    let rh = null;
    let effectiveDev = dev;
    if (motifReady && dev === 'repeat') {
      rh = buildFromMotif(this.motif, {
        chord, scale, meterNum: plan.meterNum, intensity, isPhraseEnd: pos.isPhraseEnd, rng: this.rng, breathe,
      });
    } else if (usePrev) {
      rh = buildFromPrev(this.prevMelody, { dir: dev === 'sequence' ? (this.rng() < 0.5 ? 1 : -1) : 0, invert: dev === 'inversion', chord, scale, meterNum: plan.meterNum, intensity, isPhraseEnd: pos.isPhraseEnd, rng: this.rng });
      if (dev === 'ornament') rh = insertPassing(rh, scale, this.rng);
      if (breathe && rh.length) { const d = breatheDelay(rh); rh = rh.map((n) => ({ ...n, startBeats: n.startBeats + d })); }
    }
    if (!rh || !rh.length) {
      rh = fresh();
      // 兜底走了全新渲染 → 归因必须说真话。本应使用素材的四种手法
      // （承袭/模进/倒影/装饰）若真的没拿到素材，一律改记为「新句」——
      // 日志/功能轨/动机卡都读这一个字段，说谎的代价是整个溯源承诺失效。
      if (dev === 'repeat' || dev === 'sequence' || dev === 'inversion' || dev === 'ornament') {
        effectiveDev = 'new';
        this.developHistory[this.developHistory.length - 1] = 'new';
      }
    }

    // 反重复护栏 + 乐句尾锚定。post 交给护栏内部执行：护栏在「锚定之后」的最终形态上判定碰撞，
    // 锚定不再发生在护栏之外——否则会「逃出去又被锚定改回撞车」（词句尾相邻重复的真实根因）。
    const post = pos.isPhraseEnd ? (ns) => snapLastToChord(ns, chord) : (ns) => ns;
    rh = post(rh);
    if (this.lastSigs.includes(sigOf(rh))) {
      rh = mutateMelody(rh, { scale, rng: this.rng, avoid: this.lastSigs, post });
    }
    this.lastSigs = [sigOf(rh), ...this.lastSigs].slice(0, 2);

    // 记录本小节旋律素材（供下一小节模进/倒影）
    this.prevMelody = {
      startMidi: rh[0]?.midi ?? this.lastEndMidi,
      onsets: rh.map((n) => n.startBeats),
      intervals: rh.map((n, i, a) => (i ? n.midi - a[i - 1].midi : 0)).slice(1),
    };

    // 左手指纹护栏：renderLH 内部靠随机变体（空拍/旋转/换序）避重，但没有硬保证。
    // 兜底分两级：① 重渲染换一个变体（rng 继续推进，同 seed 仍可复现）；
    // ② 重试仍撞车时**去掉末音**——必然改变签名，且只削掉一个收尾音，代价极小。
    // 旧实现只重试 3 次就用尽、然后直接返回撞车的那一份，等于没有护栏：
    // 本轮把 motif 路径修好、旋律序列一变，就把它顶了出来（seed 7 出现相邻复读）。
    let lhNotes = renderLH({ plan, chord, patternId: lh, intensity, rng: this.rng });
    for (let k = 0; k < 6 && this.lastLhSigs.includes(sigOf(lhNotes)); k++) {
      lhNotes = renderLH({ plan, chord, patternId: lh, intensity, rng: this.rng });
    }
    if (lhNotes.length > 1 && this.lastLhSigs.includes(sigOf(lhNotes))) {
      lhNotes = lhNotes.slice(0, -1);
    }
    this.lastLhSigs = [sigOf(lhNotes), ...this.lastLhSigs].slice(0, 2);

    const notes = [...lhNotes, ...rh];
    this.lastEndMidi = rh.length ? rh.at(-1).midi : this.lastEndMidi;
    this.intensitySoFar = this.intensitySoFar * 0.7 + intensity * 0.3;
    this.currentChord = chord;

    if (!this.motif && pos.bar === 1) {
      this.motif = {
        rhythmId: ans.rhythm?.value ?? 'r0', contourId: contour, pattern: rhythmEntry.pat,
        midis: rh.map((n) => n.midi),        // 旋律素材：承袭/模进/倒影/装饰的原料
        onsets: rh.map((n) => n.startBeats), // 节奏素材
      };
    }

    const bar = {
      index: pos.bar, loop: pos.loop,
      label: `${'ABCDEFGHIJKLMNOP'[Math.floor(pos.bar / plan.barsPerPhrase) % 16]}${pos.barInPhrase + 1}`,
      chord, notes,
      intensity,
      decision: {
        provider: dec.provider, fixture: !!dec.fixture, ms: dec.ms ?? 0,
        inputTokens: dec.inputTokens ?? 0, usd: dec.usd ?? 0,
        lh, contour, tier: rhythmEntry.tier ?? 1, breathe, develop: effectiveDev, roman: chordSymRaw,
        confidence: ans.chord?.confidence ?? ans.chord?.probability ?? null,
        // 归因字段（ADR-0003）：断路器是否锁死、模型答案是否被候选集强制拒绝、功能层结果
        loopLocked, rejected: !picked,
        fn: declaredFn,
        phraseRole: isQuestionEnd ? 'question' : pos.isPhraseEnd ? 'answer' : null,
        chordFn: chordP.fn ?? functionOf(chordSymRaw, plan.mode),
        answers: ans, candidates: Object.keys(questions.chord.criteria),
      },
    };
    this.history.push(bar);
    if (this.history.length > 8) this.history.shift();
    this.index++;
    return bar;
  }
}


