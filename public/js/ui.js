// ui.js — 界面原语：键盘 DOM、和声功能轨、决策日志、计划卡、图例、台账、toast。
// canvas 可视化三件套自轮次 52 起住在 canvas.js（本模块只转出，对外契约不变）。
import { midiName, PREFERRED_NAME, chordRole } from './music.js';
import { tempoMultAt } from './candidates.js';
import { escapeHtml } from './dom.js';
import { getAudio } from './audio.js';
import { KeySync } from './keysync.js';
import { attachKeyboard, hintsFor } from './kbd.js';

import { LOW, HIGH, sectionLabel } from './canvas.js';

// **转出（re-export）**：这些符号此前定义在本模块；调用方（main.js / studio.js / 测试）的 import 路径不变。
export { Fall, TensionGraph, MotifCard, motifShape, pulseActive, MOTIF_PULSE_MS, sectionLabel, chorusView, hoverBarAt } from './canvas.js';

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_PCS = [1, 3, 6, 8, 10];

/** 和弦键集合（轮次 57）：midi 范围内、音级类落在 pcs 里的键。null/脏 pcs → 空集（= 熄灭全部）。 */
export function keyMarks(low, high, pcs) {
  const set = new Set();
  if (!Array.isArray(pcs)) return set;
  for (let m = low; m <= high; m++) if (pcs.includes(((m % 12) + 12) % 12)) set.add(m);
  return set;
}

/** 最小 DOM 写入的差集（轮次 57）：只返回要点亮/熄灭的键——逐小节全量重写 49 个键是浪费，diff 后通常只剩几个。 */
export function markDiff(prev, next) {
  const add = [], remove = [];
  for (const m of next) if (!prev.has(m)) add.push(m);
  for (const m of prev) if (!next.has(m)) remove.push(m);
  return { add, remove };
}

/** 渲染键盘。opts.onKey(midi) 提供时，点击琴键立即回调（试听）——事件委托到容器，49 键一个监听器。
 *  键帽仍是 aria-hidden 的视觉元素：指针试听是增强，完整键盘导航属独立无障碍工程。 */
export function renderKeyboard(container, { low = LOW, high = HIGH, onKey = null } = {}) {
  container.innerHTML = '';
  const whites = [];
  for (let m = low; m <= high; m++) if (WHITE_PCS.includes(((m % 12) + 12) % 12)) whites.push(m);
  const w = 100 / whites.length;
  const whiteIdx = new Map(whites.map((m, i) => [m, i]));
  const keyMap = new Map();
  for (const m of whites) {
    const el = document.createElement('div');
    el.className = 'wk';
    el.style.left = `${whiteIdx.get(m) * w}%`;
    el.style.width = `${w}%`;
    el.title = midiName(m);
    el.dataset.midi = m;
    container.appendChild(el);
    keyMap.set(m, el);
  }
  for (let m = low; m <= high; m++) {
    if (!BLACK_PCS.includes(((m % 12) + 12) % 12)) continue;
    const el = document.createElement('div');
    el.className = 'bk';
    el.style.left = `${whiteIdx.get(m + 1) * w - w * 0.31}%`;
    el.style.width = `${w * 0.62}%`;
    el.title = midiName(m);
    el.dataset.midi = m;
    container.appendChild(el);
    keyMap.set(m, el);
  }
  if (onKey) {
    container.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('[data-midi]');
      if (!key) return;
      // 不再在这里点亮/定时熄灭：琴键的按下与抬起由 KeySync 按音频时钟驱动，
      // 与发声同一时刻（此处若抢先点亮，视觉就比声音早了一个"等待音频初始化"的量）
      onKey(Number(key.dataset.midi));
    });
  }
  let marked = new Set();
  let hintEls = new Map(); // midi → 提示字母元素（轮次 65 电脑键盘弹奏的键位标注）
  return {
    /**
     * 按音频时钟同步按下状态：changes = Map<midi, vel|null>，null 表示熄灭。
     * 只动变化的键；力度写进 CSS 变量 --kvel，由样式表决定亮度——视觉的强弱与音量同源。
     */
    syncLit(changes) {
      for (const [midi, vel] of changes) {
        const el = keyMap.get(midi);
        if (!el) continue;
        if (vel == null) {
          el.classList.remove('on');
          el.style.removeProperty('--kvel');
        } else {
          el.classList.add('on');
          const v = String(Math.min(1, Math.max(0, Number(vel) || 0)));
          if (el.style.getPropertyValue('--kvel') !== v) el.style.setProperty('--kvel', v);
        }
      }
    },
    /** 和弦键亮起（轮次 57）：pcs = 当前和弦的音级类数组（null = 熄灭）。diff 更新，只动变化的键。 */
    mark(pcs) {
      const next = keyMarks(low, high, pcs);
      const { add, remove } = markDiff(marked, next);
      for (const m of add) keyMap.get(m)?.classList.add('mk');
      for (const m of remove) keyMap.get(m)?.classList.remove('mk');
      marked = next;
    },
    /** 键位字母提示（轮次 65）：pairs = [[midi, label], …]。diff 更新——八度切换只动 17 个键各一次，不重排键盘。 */
    setKeyHints(pairs) {
      const want = new Map((pairs ?? []).filter(([m]) => keyMap.has(m)));
      for (const [midi, el] of hintEls) {
        if (!want.has(midi)) { el.remove(); hintEls.delete(midi); }
      }
      for (const [midi, label] of want) {
        let el = hintEls.get(midi);
        if (!el) {
          el = document.createElement('i');
          el.className = 'khint';
          keyMap.get(midi).appendChild(el);
          hintEls.set(midi, el);
        }
        if (el.textContent !== label) el.textContent = label;
      }
    },
    clear() {
      for (const el of keyMap.values()) { el.classList.remove('on'); el.style.removeProperty('--kvel'); }
    },
  };
}

/**
 * 张力对照带：实线 = 已经演奏出来的实际张力，虚线幽灵 = 计划弧线。
 * 沿用 Fall 的骨架（canvas + ResizeObserver + setInterval 而非 rAF）：
 * 标签页被遮挡时 rAF 会被浏览器暂停，画面会就此冻结。
 * 纯展示层——只读已经生成的小节，不参与任何决策。
 */

/**
 * 段落标注：段落名（A / B / A' / Coda）。
 * 这是「不依赖颜色」的文字通道——ui-ux-pro-max 的 chart 域明确要求
 * "Mark ... with a distinct shape and text annotation as well as color. Do not rely on color alone."
 * 曲式是结构信息，必须在灰度/色觉障碍下同样可读。
 */

/** 某小节是否开启新段落；是则返回该段落，否则 null */
export function sectionMarkerAt(sections, bar) {
  if (!Array.isArray(sections) || !sections.length) return null;
  return sections.find((s) => s && s.start === bar) ?? null;
}

/** 计划卡的段落清单（纯文本）：「A 8 小节 · B 8 小节 · …」；无段落时返回空串（整行不输出） */
export function planLine(sections) {
  if (!Array.isArray(sections) || !sections.length) return '';
  return sections.map((s) => `${sectionLabel(s)} ${Number(s?.bars) || 0} 小节`).join(' · ');
}

/** 计划卡的速度行：「速度 92 BPM · 尾段渐慢至 74」（轮次 20 速度弧线的文字通道）。
 *  末小节乘数 ≈1（单小节尾声等无渐慢余地的情况）时只有前半；脏输入返回空串，调用方整段回退。 */
export function planTempoLine(plan) {
  const bpm = Number(plan?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return '';
  const total = Math.max(1, Number(plan?.totalBars) || 32);
  const lastMult = tempoMultAt(plan, total - 1);
  const end = Math.round(bpm * lastMult);
  const base = Math.round(bpm);
  return `速度 ${base} BPM` + (lastMult < 0.99 && end < base ? ` · 尾段渐慢至 ${end}` : '');
}

/** 唯一性读数（轮次 27）：反重复系统成功时没有事件，这个安静的数字就是它的可见形态。
 *  口径与 composer 的指纹一致（onset×4:midi 字面唯一小节数）。bars≤0 或脏输入返回空串（整行不输出）。 */
export function uniquenessLine(melSeen, lhSeen, bars) {
  const n = Number(bars);
  if (!Number.isFinite(n) || n < 1) return '';
  const m = Math.min(Number(melSeen) || 0, n), l = Math.min(Number(lhSeen) || 0, n);
  return `旋律唯一 ${m}/${n} · 左手唯一 ${l}/${n}`;
}

/** 舞台灯光（轮次 31）：张力 → 暖顶光/冷地光的不透明度。
 *  纯氛围层——不承载任何必须读到的信息（信息仍走文字/形状通道），上界 0.21 的克制
 *  来自 delight 判据（重复一百次还讨喜）。脏输入降级中性 0.5，绝不抛错。 */
export function stageLightFor(tension) {
  const t = Number(tension);
  const v = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
  return { warm: Math.round((0.05 + v * 0.16) * 1000) / 1000, cool: Math.round((0.16 - v * 0.10) * 1000) / 1000 };
}

/** 曲风 chip 的 tooltip（轮次 44）：领域描述与速度区间在选择的那一刻可见，而不是埋在代码里。 */
export function styleChipTitle(style) {
  if (!style || !style.desc) return '';
  const [lo, hi] = Array.isArray(style.bpm) ? style.bpm : [];
  return Number.isFinite(lo) && Number.isFinite(hi)
    ? `${style.desc} · ${lo}-${hi} BPM`
    : String(style.desc);
}

const fmtBias = (v, unit, plus = '+') => `${unit} ${v >= 0 ? plus : '−'}${Math.abs(v)}`;
/** 目标 select 的 tooltip（轮次 44）：把 GOAL_HINTS 的实际偏置说人话——选择会影响什么，当场可见。 */
export function goalTitle(hint) {
  if (!hint) return '每次随机生成，不偏置任何参数';
  const parts = [];
  if (hint.arc) parts.push(`弧线 ${hint.arc}`);
  if (hint.density) parts.push(fmtBias(hint.density, '密度'));
  if (hint.brightness) parts.push(fmtBias(hint.brightness, '亮度'));
  return parts.length ? `影响：${parts.join(' · ')}` : '每次随机生成，不偏置任何参数';
}

/** 双遍张力对照（轮次 42）：把已演奏序列按遍长切成「上一遍」与「当前遍」。
 *  再即兴的可视化——同一曲式，两条不同的形状。totalBars ≤ 0 表示未启用分遍（total=0，调用方回退旧行为）。 */

/** 遍次小结（轮次 37）：每遍末小节在决策日志插入的一行汇总。
 *  与曲终手势（轮次 36）配对——音乐收束了，界面也要说一声「这一遍完了，它长这样」。 */
export function chorusSummary(chorus, bars, chordKinds, melUnique, lhUnique, usd) {
  const n = Number(chorus), b = Number(bars);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(b) || b < 1) return '';
  const ck = Number(chordKinds) || 0, mu = Number(melUnique) || 0, lu = Number(lhUnique) || 0;
  const u = Number(usd);
  return `第 ${n} 遍完 · ${b} 小节 · 和弦 ${ck} 种 · 旋律唯一 ${mu}/${b} · $${(Number.isFinite(u) ? u : 0).toFixed(4)}`;
}

/** 张力带 hover：指针横坐标 px → 最近小节序号；绘图区外/脏输入/无数据返回 -1。
 *  hover 只是增强（ui-ux-pro-max："relying on hover only" 是反模式）——
 *  无 hover 的读法是 tensionStat 文本行与 aria-label，二者始终存在。 */

/** 发展手法：第 7 问的五种手法，中文全称（供 title 等需要完整语义的场合） */
export const DEV_ZH = { repeat: '承袭', sequence: '模进', inversion: '倒影', ornament: '装饰', new: '新句' };

/** 和声功能的短标签（功能轨填色、图例、日志徽章共用同一份） */
const FN_ZH = { T: '主', S: '下属', D: '属', Tp: '色彩' };

/**
 * 图例条目：界面上**每一个**标记的含义。
 * 数据驱动，保证与真实标记同源——标记改了而图例没改，比没有图例更糟。
 * 「?」抽屉是可选的（impeccable/onboard：别一上来倾倒信息），关闭状态被记住，
 * 但按钮永远在，随时可重开。
 */
export const LEGEND_ITEMS = [
  { group: '和声功能（功能轨的填色）', label: FN_ZH.T, swatch: 'fn-T', desc: '主和弦——稳定的「家」，段落开头常回到这里' },
  { group: '和声功能（功能轨的填色）', label: FN_ZH.S, swatch: 'fn-S', desc: '下属功能——向外打开，为进行做准备' },
  { group: '和声功能（功能轨的填色）', label: FN_ZH.D, swatch: 'fn-D', desc: '属功能——制造张力并拉回主和弦' },
  { group: '和声功能（功能轨的填色）', label: FN_ZH.Tp, swatch: 'fn-Tp', desc: '色彩功能——离调、借用来的颜色' },
  { group: '发展手法（功能轨上的字）', label: '承', swatch: 'theme', desc: '承袭：动机在新的和声里重新出现（带顶部括线）' },
  { group: '发展手法（功能轨上的字）', label: '模', swatch: '', desc: '模进：把刚才那句移一个音级' },
  { group: '发展手法（功能轨上的字）', label: '倒', swatch: '', desc: '倒影：把刚才那句的音程镜像' },
  { group: '发展手法（功能轨上的字）', label: '装', swatch: '', desc: '装饰：给刚才那句加经过音' },
  { group: '发展手法（功能轨上的字）', label: '新句', swatch: '', desc: '全新想法——唯一不使用动机的手法，所以没有标记' },
  { group: '乐句语气（功能轨上的字）', label: '问', swatch: 'qa', desc: '问句·半终止——和声停在属功能和弦上悬而未决，等下一句来回答' },
  { group: '乐句语气（功能轨上的字）', label: '答', swatch: '', desc: '答句·全终止——乐句在此收束、回到主和弦' },
  { group: '断路器与守卫（功能轨上的形状）', label: '断路', swatch: 'lock', desc: '循环锁死断路器触发：这一小节把在绕圈的根音剔出了候选' },
  { group: '断路器与守卫（功能轨上的形状）', label: '驳回', swatch: 'rej', desc: '模型答了候选集之外的和弦，已按候选集强制回落' },
  { group: '断路器与守卫（功能轨上的形状）', label: '复读', swatch: '', desc: '这一小节与远处小节字面相同——全曲指纹记忆尽力变形后仍无出路，如实标记' },
  { group: '断路器与守卫（功能轨上的形状）', label: '超预算', swatch: 'slow', desc: '渠道跟不上演奏速度：决策超过本小节的音频预算，由离线随机顶替保住节奏，下一小节重试真实渠道' },
  { group: '结构（各处的虚线与名字）', label: '段落', swatch: 'sec', desc: 'A 陈述 / B 对比 / A′ 再现 / Coda 收束，虚线竖线是段落边界' },
  { group: '结构（各处的虚线与名字）', label: '动机', swatch: 'motif', desc: '曲子主题的旋律轮廓，右侧计数是它回来的次数' },
  { group: '分析读数（张力带与卷帘）', label: '张力', swatch: 'ten', desc: '这一小节有多紧：实线是实际，虚线是计划弧线' },
  { group: '分析读数（张力带与卷帘）', label: '契合度', swatch: 'fit', desc: '旋律里有多少音属于当前和弦——越高越「在调上」' },
  { group: '分析读数（张力带与卷帘）', label: '非和弦', swatch: 'nct', desc: '带亮边的旋律音：不属于当前和弦，但正是调式的呼吸' },
  { group: '跟弹（下落音符与琴键，轮次 56/57）', label: '你的音符', swatch: 'you', desc: '演奏中你点下琴键的音：紫色亮边块在击键线上原地亮起（键盘下方一行字会说明它在当前和弦里的角色）' },
  { group: '跟弹（下落音符与琴键，轮次 56/57）', label: 'AI 右手', swatch: 'fallR', desc: 'Jev 右手旋律的下落块（琥珀色）' },
  { group: '跟弹（下落音符与琴键，轮次 56/57）', label: 'AI 左手', swatch: 'fallL', desc: 'Jev 左手织体的下落块（青绿色）' },
  { group: '跟弹（下落音符与琴键，轮次 56/57）', label: '和弦键', swatch: 'mk', desc: '当前小节和弦里的琴键底部亮一道金线——跟着亮键弹，就在和声里' },
];

/** 渲染图例 HTML（label/desc 一律转义——图例是纯文本通道，不是注入面） */
export function renderLegend(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const groups = new Map();
  for (const it of items) {
    const g = it.group ?? '其它';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  let out = '';
  for (const [g, list] of groups) {
    out += `<section class="lg-group"><h3>${escapeHtml(g)}</h3><ul>`;
    for (const it of list) {
      const sw = it.swatch ? `<i class="lg-sw ${escapeHtml(it.swatch)}"></i>` : '<i class="lg-sw lg-blank"></i>';
      out += `<li>${sw}<b>${escapeHtml(it.label)}</b><span>${escapeHtml(it.desc)}</span></li>`;
    }
    out += '</ul></section>';
  }
  return out;
}

/** 功能轨某一格的可读描述（纯函数，便于单测；无障碍与 title 共用） */
export function fnLabel(fn) {
  return FN_ZH[fn] ?? fn ?? '';
}

/** 功能轨一格的类名：颜色与断路器标记都挂在 data 属性上，样式全在 CSS。
 *  qa-q/qa-a = 乐句语气（轮次 23 的 phraseRole）：问=半终止悬而未决，答=全终止收束。 */
export function fnSegClass(bar) {
  const fn = bar?.decision?.chordFn ?? 'T';
  const qa = bar?.decision?.phraseRole === 'question' ? 'qa-q' : bar?.decision?.phraseRole === 'answer' ? 'qa-a' : '';
  return ['fnseg', `fn-${FN_ZH[fn] ? fn : 'T'}`, qa, bar?.decision?.loopLocked ? 'lock' : '', bar?.decision?.rejected ? 'rej' : '']
    .filter(Boolean).join(' ');
}

/** 乐句语气的短字（功能轨第三槽）与完整说法（title/日志共用一份，别处禁止再写中文字面量） */
export const PHRASE_ROLE_ZH = { question: '问', answer: '答' };
const PHRASE_ROLE_FULL = { question: '问句·半终止（悬而未决）', answer: '答句·全终止（收束回家）' };

/** 决策概率条（轮次 33）：把 Jev 对某个 choice 问题的概率分布画成微型条形。
 *  「每个音符可溯源」的延伸——溯源不止「它选了什么」，还有「它在什么之间犹豫」。
 *  脏输入/缺省返回空串（整行不输出）；sym 一律转义；取概率最高的前 max 个。 */
export function probabilityStrip(probabilities, picked, { max = 3 } = {}) {
  if (!probabilities || typeof probabilities !== 'object') return '';
  const entries = Object.entries(probabilities)
    .filter(([, p]) => Number.isFinite(p))
    .map(([sym, p]) => ({ sym: String(sym), p: Math.min(1, Math.max(0, p)) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, Math.max(1, max));
  if (!entries.length) return '';
  return entries.map(({ sym, p }) => {
    const pct = Math.round(p * 100);
    const pick = sym === picked ? ' prob-pick' : '';
    return `<span class="pb${pick}" title="${escapeHtml(sym)} ${pct}%"><i style="width:${pct}%"></i><b>${escapeHtml(sym)}</b><small>${pct}%</small></span>`;
  }).join('');
}

/** 决策归因标记（ADR-0003 的"剔除即强制"在人眼前的账本）。
 *  四类，全是「内核做了一个用户看不见的决定」：循环锁死断路器、候选集强制驳回、
 *  软层复读、**决策超预算**（轮次 48：渠道跟不上演奏速度时主动顶替保住节奏）。
 *  纯函数便于单测；返回描述符而非 HTML——文字通道（label）与形状通道（cls）分离。
 *  脏输入降级为空数组（渲染层整段不输出，与 probabilityStrip 同一纪律）。 */
export function decisionGuards(d) {
  if (!d || typeof d !== 'object') return [];
  const out = [];
  if (d.loopLocked) out.push({ cls: 'lock', label: '断路', title: '循环锁死断路器触发：循环根音已从本小节候选中剔除' });
  if (d.rejected) out.push({ cls: 'rej', label: '驳回', title: '模型答案不在候选集内，已按候选集强制回落' });
  if (d.farRepeat || d.lhFarRepeat) out.push({ cls: '', label: '复读', title: '这一小节与远处小节字面相同——全曲指纹记忆尽力变形后仍无出路，如实标记' });
  if (d.deadlineMiss) out.push({ cls: 'slow', label: '超预算', title: '渠道跟不上演奏速度：这一小节的决策超过了音频预算，已由离线随机顶替——播放不中断，下一小节重试真实渠道' });
  return out;
}

export function addDecision(ul, bar) {
  const d = bar.decision;
  ul.querySelectorAll('.fresh').forEach((el) => el.classList.remove('fresh'));
  const li = document.createElement('li');
  li.className = 'fresh';
  const stats = d.fixture
    ? `<span class="fixture">离线随机</span>`
    : `<span>${d.ms}ms</span><span>${d.inputTokens}tok</span><span>$${d.usd.toFixed(6)}</span>${d.confidence != null ? `<span>置信 ${Number(d.confidence).toFixed(2)}</span>` : ''}`;
  // 断路器/候选集强制的归因标记：把 ADR-0003 的"剔除即强制"从代码搬到人眼前。
  // 「复读」是轮次 26 软层的诚实账本：远距离字面重复、变形空间耗尽后如实保留并标记。
  // 「超预算」是轮次 48 的诚实账本：渠道跟不上演奏速度时，内核主动用离线随机顶替保住节奏。
  const guards = decisionGuards(d)
    .map((g) => `<span class="guard${g.cls ? ' ' + g.cls : ''}" title="${escapeHtml(g.title)}">${escapeHtml(g.label)}</span>`)
    .join('');
  // 概率条：真渠道返回分布时展示「模型在什么之间犹豫」；离线随机渠道没有分布，整行不输出
  const strip = probabilityStrip(d.answers?.chord?.probabilities, d.answers?.chord?.value);
  li.innerHTML =
    `<span class="log-no">${bar.index + 1}<small>${bar.label}</small></span>` +
    `<span class="log-chord">${escapeHtml(bar.chord.symbol)}</span>` +
    `<span class="fn-chip fn-${d.chordFn && FN_ZH[d.chordFn] ? d.chordFn : 'T'}" title="和声功能：${escapeHtml(fnLabel(d.chordFn))}">${escapeHtml(fnLabel(d.chordFn))}</span>` +
    `<span class="log-detail">` +
    `<span>左手 <b>${escapeHtml(d.lh)}</b></span>` +
    `<span>走向 <span class="q">${escapeHtml(d.contour)}</span></span>` +
    `<span>手法 <span class="q">${DEV_ZH[d.develop] ?? escapeHtml(d.develop ?? '')}</span></span>` +
    `${d.phraseRole ? `<span class="q">${PHRASE_ROLE_FULL[d.phraseRole]}</span>` : ''}` +
    `<span>密度 ${d.tier}</span>` +
    `<span>强度 <b>${bar.intensity.toFixed(1)}</b></span>` +
    `${d.breathe ? '<span class="q">呼吸</span>' : ''}` +
    `${guards}` +
    `</span>` +
    `<span class="log-stats">${stats}</span>` +
    (strip ? `<div class="prob-strip">${strip}</div>` : ''); // 单次赋值；靠 li 的 flex-wrap 换行
  ul.prepend(li);
  ul.scrollTop = 0; // 最新一条始终在顶部可见（抵消浏览器滚动锚定）
  while (ul.children.length > 60) ul.lastChild.remove();
}

/** 发展手法的短标签——功能轨上的**文字通道**（与颜色无关，灰度/色觉障碍下同样可读）。
 *  颜色归和声功能，形态归发展手法，两个维度各用一套通道，互不干扰。 */
export const DEVELOP_ZH = { repeat: '承', sequence: '模', inversion: '倒', ornament: '装', new: '' };

/**
 * 音高序列 → 归一化轮廓 [{x,y}]，x/y 都在 0..1。
 * 整体移调不改变形状——同一动机换个八度仍是同一形状，这让"主题回来了"可以只比形状。
 */

/**
 * 动机卡：把曲子的主题画成一条「形状」，并累计它回来了几次。
 *  骨架沿用 Fall / TensionGraph（canvas + ResizeObserver，不用 rAF——标签页遮挡时 rAF 会被暂停）。
 *  只在数据变化与强调窗口内重绘：静止的卡片不该在背后持续画。
 *  这是这个产品独有的东西：别的 AI 音乐生成器给音频，这里给可溯源的结构。
 */

/** 强调窗口是否仍然有效——「还要不要再画一帧」的判据，做成纯函数才好测。
 *  用注入的时钟判定，因此窗口行为可以单测，不必 sleep 900ms。 */

/**
 * 和声功能轨：每个已演奏小节一格，按功能着色，标记断路器触发与候选集驳回。
 * 保留最近 RIBBON_MAX 格；最早的一格是"正在响"的那一小节，用 aria-current 标出。
 * DOM 而非 canvas：一屏十几段，DOM 免费换来可访问性、hover 提示与 CSS 变量配色。
 */
export const RIBBON_MAX = 18;

export function pushFnSegment(ribbon, bar, sections) {
  if (!ribbon) return;
  // 段落边界：竖线 + 段落名（文字通道，不依赖颜色）
  const mark = sectionMarkerAt(sections, bar.index);
  if (mark) {
    const el = document.createElement('span');
    el.className = 'fnsec';
    el.innerHTML = `<i></i><b>${escapeHtml(sectionLabel(mark))}</b>`;
    el.title = `段落 ${sectionLabel(mark)} 从第 ${bar.index + 1} 小节开始`;
    ribbon.prepend(el);
  }
  const seg = document.createElement('span');
  const dev = bar.decision.develop;
  const isTheme = dev === 'repeat';           // 「主题回来了」用形状+文字，不靠颜色
  seg.className = fnSegClass(bar) + ' fresh' + (isTheme ? ' theme' : '');
  const fn = bar.decision.chordFn ?? 'T';
  const qa = PHRASE_ROLE_ZH[bar.decision.phraseRole] ?? '';
  seg.innerHTML = `<i></i><b>${escapeHtml(fnLabel(fn))}</b><em>${escapeHtml(DEVELOP_ZH[dev] ?? '')}</em><span class="qa">${escapeHtml(qa)}</span>`;
  seg.title = `第 ${bar.index + 1} 小节 ${bar.label} · ${bar.chord.symbol} · ${fnLabel(fn)}功能 · ${DEV_ZH[dev] ?? dev}${bar.decision.phraseRole ? ` · ${PHRASE_ROLE_FULL[bar.decision.phraseRole]}` : ''}`;
  ribbon.prepend(seg);
  while (ribbon.children.length > RIBBON_MAX + sectionsAt(sections)) ribbon.lastChild.remove();
  ribbon.querySelectorAll('[aria-current]').forEach((el) => el.removeAttribute('aria-current'));
  ribbon.firstElementChild?.querySelector('b')?.parentElement?.setAttribute?.('aria-current', 'true');
}

// 段落标记会占用额外格子，避免它们把功能段挤出上限
function sectionsAt(sections) {
  return Array.isArray(sections) ? Math.min(8, sections.length) : 0;
}

/** 计划卡 */
export function renderPlan(el, plan) {
  const srcBadge = plan.source === 'llm' ? '<span class="badge">LLM 扩写</span>' : '<span class="badge">关键词理解</span>';
  const form = planLine(plan.sections);
  const tempo = planTempoLine(plan) || `${Number(plan.bpm) || '?'} BPM`;
  el.innerHTML =
    `<h3>${escapeHtml(plan.title)}${srcBadge}</h3>` +
    `<div class="meta">${escapeHtml(plan.styleName)}　${'CDEFGAB'[plan.keyPc]} ${plan.mode}　${escapeHtml(tempo)}　${plan.meterNum}/4　弧线 ${plan.arc}　${plan.totalBars} 小节</div>` +
    (form ? `<div class="meta form-line" title="曲式：段落划分">曲式 ${escapeHtml(form)}</div>` : '') +
    `<div class="meta" style="margin-top:2px">情绪 ${escapeHtml(plan.mood.join(' / '))}</div>` +
    (plan.notes ? `<div class="notes">${escapeHtml(plan.notes)}</div>` : '');
}

/**
 * 计费台账（轮次 50）：tokens / 费用 / 延迟的**唯一记账口径**，两个界面共用。
 *
 * 为什么要抽出来：三个 pill（`stTokens`/`stCost`/`stLatency`）挂在顶栏、两个视图共用同一份 DOM，
 * 但计数器原先只住在 `main.js` 里、只在实时演奏的 `onBar` 累加 —— **工作室整条生成循环从不读
 * `bar.decision` 的计费字段**。结果是进了工作室那三个数字一动不动，用户完全无法知道一次 32 小节的
 * 生成花了多少钱。**共用的显示 + 各写各的账 = 一半界面永远在说谎。**
 */
export const CHANNEL_LABEL = { fixture: '离线随机', proxy: '同源代理', typesafe: 'TypeSafe', openrouter: 'OpenRouter' };

/**
 * 每个渠道**真正会读取**的 Key 字段 —— 设置面板据此把不参与的输入框置灰。
 *
 * 为什么需要它：`jev.js` 只在非 proxy 渠道才发 `Authorization`（`jev.js:105-111`），
 * 而 proxy 恰好是探测成功后的默认渠道。于是两个 Key 输入框在默认配置下是**死值**：
 * 用户填什么都一样，界面却毫无表示——"我瞎写 key 也能用"的困惑正出于此。
 * 规则表与 `jev.js` 的读取逻辑是一对，改渠道必须两边同时改（`style-contract.test.mjs` 守着）。
 */
export const KEY_FIELD_RULES = {
  fixture: { typesafe: false, openrouter: false, note: '离线随机不联网，两个 Key 都不需要。' },
  proxy: { typesafe: false, openrouter: false, note: '同源代理由服务端持有密钥，浏览器不需要填 Key。' },
  typesafe: { typesafe: true, openrouter: false, note: '当前渠道只读取 TypeSafe Key，OpenRouter Key 不参与。' },
  openrouter: { typesafe: false, openrouter: true, note: '当前渠道只读取 OpenRouter Key，TypeSafe Key 不参与。' },
};

export function emptyLedger() {
  return { tokens: 0, usd: 0, latencySum: 0, latencyN: 0 };
}

/** 累加一次决策。**fixture 不记账**——离线随机无网络请求、无费用，写进去等于虚报。
 *  脏输入一律按 0 处理：台账宁可少记，绝不能把 NaN 渲染到顶栏。 */
export function accumulateLedger(ledger, decision) {
  const l = Number.isFinite(ledger?.tokens) ? { ...ledger } : emptyLedger();
  const d = decision && typeof decision === 'object' ? decision : null;
  if (!d || d.fixture) return l;                       // 离线渠道不计费
  const tok = Number(d.inputTokens), usd = Number(d.usd), ms = Number(d.ms);
  if (Number.isFinite(tok) && tok > 0) l.tokens += tok;
  if (Number.isFinite(usd) && usd > 0) l.usd += usd;
  if (Number.isFinite(ms) && ms > 0) { l.latencySum += ms; l.latencyN++; }
  return l;
}

/** 台账 → 三个 pill 的文案。`latency` 为 null 表示无有效样本，由 setStatus 渲染成「— ms」。 */
export function ledgerPills(ledger) {
  const l = ledger && typeof ledger === 'object' ? ledger : {};
  const tokens = Number.isFinite(l.tokens) && l.tokens > 0 ? l.tokens : 0;
  const usd = Number.isFinite(l.usd) && l.usd > 0 ? l.usd : 0;
  const n = Number.isFinite(l.latencyN) && l.latencyN > 0 ? l.latencyN : 0;
  const sum = Number.isFinite(l.latencySum) && l.latencySum > 0 ? l.latencySum : 0;
  return {
    tokens: `${Math.round(tokens).toLocaleString()} tok`,
    cost: `$${usd.toFixed(6)}`,
    latency: n ? Math.round(sum / n) : null,
  };
}

/**
 * 写顶栏 pill。
 *
 * ⚠️ tokens/cost **接受两种形态**：裸数值，或 `ledgerPills()` 已格式化的字符串。
 * `ledgerPills` 存在的意义就是「一套口径两处复用」；若它返回数值、本函数再格式化一次，
 * 格式化规则就有两份、迟早漂移。**格式化只做一遍**，字符串直接透传。
 * （轮次 50 教训：第一版对字符串调了 `.toFixed()`，真实浏览器立刻报
 * `cost.toFixed is not a function`——单测只断言了 `ledgerPills` 的输出、没走本函数，所以没拦住。）
 */
export function setStatus(pills, { channel, tokens, cost, latency }) {
  if (channel != null) pills.channel.textContent = channel;
  if (tokens != null) pills.tokens.textContent = typeof tokens === 'string' ? tokens : `${Math.round(tokens).toLocaleString()} tok`;
  if (cost != null) pills.cost.textContent = typeof cost === 'string' ? cost : `$${cost.toFixed(6)}`;
  // `undefined` = 本次没有延迟信息（别动）；`null` = **确实没有样本**（写成「— ms」）。
  // 两者必须分开：若把 null 也当"别动"，从真实渠道切到离线渠道后，pill 会一直挂着上一次的旧值。
  if (latency !== undefined) {
    pills.latency.textContent = latency === null || latency === '' ? '— ms' : `${Math.round(latency)} ms`;
  }
}

export function toast(el, msg, ms = 4000) {
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

/**
 * 顶栏台账 pill 的一次性刷新（轮次 50 的口径，轮次 69 抽成共享实现）。
 *
 * 为什么要有它：`ledgerPills()` + `setStatus()` 这对调用此前在 main.js 与 studio.js
 * 里各写了一遍——**共用的显示 + 各写各的账 = 一半界面永远在说谎**（工作室此前整条生成
 * 循环从不记账）。口径必须只有一个地方，两个界面都从这里取。
 *
 * @param {{channel:Element,tokens:Element,cost:Element,latency:Element}} pills
 * @param {{channel:string, ledger:object, suffix?:string}} opts  suffix 用于兜底告知（' ·兜底' / ' ·跟不上'）
 */
export function refreshStatusPills(pills, { channel, ledger, suffix = '' }) {
  if (!pills?.channel) return;
  const p = ledgerPills(ledger);
  setStatus(pills, {
    channel: `${channel ?? ''}${suffix}`,
    tokens: p.tokens,
    cost: p.cost,
    latency: p.latency,
  });
}

/**
 * 接好一面「可弹奏的键盘」（轮次 65 的键位 + 轮次 55 的跟弹回声 + 轮次 57 的和弦键）。
 *
 * 为什么抽出来：两个界面此前各写一份，而两份里的 `enabled` 守卫是**同一个 bug 的两半**
 * （轮次 68：两边监听器都常驻 window，不查视图会让实时页每次按键双触发、双发声）。
 * 把守卫变成一个必须显式传入的参数，就不会再有人漏写。
 *
 * @param {Element} container 键盘容器
 * @param {object} opts
 *   - echoEl   回声行元素（可选）
 *   - chordOf  () => 当前和声上下文（用于 keyEchoText 的角色读数）
 *   - onNote   (midi) => void 额外副作用（实时页：把用户音符推进下落可视化）
 *   - enabled  () => boolean **必填**：该界面是否响应电脑键盘（防双触发）
 * @returns 键盘句柄 { syncLit, mark, setKeyHints, clear }
 */
export function attachPlayableKeyboard(container, { echoEl = null, chordOf = () => null, onNote = null, enabled = null } = {}) {
  const audio = getAudio();
  // 琴键视觉的时钟（轮次 71）：与发声共用 AudioContext.currentTime，
  // 按下/抬起/力度全部由它驱动——用户手弹的音与 AI 弹的音走同一条时间轴。
  const keySync = new KeySync({
    clock: () => audio.ctx?.currentTime ?? 0,
    latency: () => audio.outputLatencySec(),
  });
  const kb = renderKeyboard(container, { onKey: pressKey });
  keySync.start((changes) => kb.syncLit(changes));
  // 弹一个音的共用路径：琴键点击与电脑键盘从这里进——回声、发声、跟弹一条路，不各有各的账
  function pressKey(midi) {
    if (echoEl) echoEl.textContent = keyEchoText(midi, chordOf());
    onNote?.(midi);
    audio.ensure()
      .then(() => {
        const v = audio.play(midi, audio.ctx.currentTime + 0.01, 0.9, 0.7);
        if (v) keySync.schedule(v.midi, v.t0, v.offAt, v.vel);
      })
      .catch(() => { /* 音频不可用时静默——试听是增强 */ });
  }
  kb.setKeyHints(hintsFor(60));
  attachKeyboard({
    onKey: pressKey,
    onOctave: (base) => {
      kb.setKeyHints(hintsFor(base));
      if (echoEl) echoEl.textContent = `八度 → ${midiName(base)} 起（Z/X 切换）`;
    },
    enabled,
  });
  // keySync 一并返回：**AI 演奏的音与用户手弹的音共用同一个状态机**——
  // 各自建一个会互相抢同一个键的熄灭时刻（一个刚灭另一个还亮着）。
  kb.keySync = keySync;
  return kb;
}

/** 键盘试听回声（轮次 55）：点击的琴键在当前和弦里的角色——「C4 · Cm的根音（和弦音）」。
 *  把键盘从试听变成跟弹学习乐器：每个音立刻告诉你它在当前和声里站哪。
 *  无和弦上下文只报音名；脏输入降级（空串/音名），绝不抛。 */
export function keyEchoText(midi, chord) {
  if (!Number.isFinite(midi)) return '';
  const name = midiName(midi);
  const role = chord ? chordRole(((midi % 12) + 12) % 12, chord.rootPc, chord.shape) : null;
  if (!role) return name;
  return `${name} · ${chord.symbol ?? ''}的${role.label}（${role.inChord ? '和弦音' : '和弦外音'}）`;
}
