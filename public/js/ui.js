// ui.js — 可视化：键盘 DOM、下落音符 canvas、决策日志、计划卡、状态条。
import { midiName } from './music.js';

const LOW = 36, HIGH = 84; // C2..C6
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_PCS = [1, 3, 6, 8, 10];

export function renderKeyboard(container, low = LOW, high = HIGH) {
  container.innerHTML = '';
  const whites = [];
  for (let m = low; m <= high; m++) if (WHITE_PCS.includes(((m % 12) + 12) % 12)) whites.push(m);
  const w = 100 / whites.length;
  const whiteIdx = new Map(whites.map((m, i) => [m, i]));
  const keyMap = new Map();
  const timeouts = new Set();
  for (const m of whites) {
    const el = document.createElement('div');
    el.className = 'wk';
    el.style.left = `${whiteIdx.get(m) * w}%`;
    el.style.width = `${w}%`;
    el.title = midiName(m);
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
    container.appendChild(el);
    keyMap.set(m, el);
  }
  return {
    flash(midi, durSec) {
      const el = keyMap.get(midi);
      if (!el) return;
      el.classList.add('on');
      const t = setTimeout(() => { el.classList.remove('on'); timeouts.delete(t); }, Math.max(80, durSec * 1000));
      timeouts.add(t);
    },
    clear() {
      for (const t of timeouts) clearTimeout(t);
      timeouts.clear();
      for (const el of keyMap.values()) el.classList.remove('on');
    },
  };
}

/** 下落音符：音符在其发声时刻落到键盘线，块高与时长成正比 */
export class Fall {
  constructor(canvas, nowFn, { approach = 1.9, low = LOW, high = HIGH + 1 } = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.now = nowFn;
    this.approach = approach;
    this.low = low;
    this.span = high - low;
    this.notes = [];
    this.timer = null;
    // 移动端省 GPU：shadowBlur 是 canvas 最大的帧率杀手
    this.lite = globalThis.matchMedia?.('(max-width: 980px)')?.matches ?? false;
    // 用 ResizeObserver 保持位图与布局同步（缩放/窗口/布局变化都不怕）
    this._resize = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(canvas);
    this._resize();
  }
  push({ midi, t, dur, vel, hand }) {
    if (this.notes.length > 500) this.notes.splice(0, this.notes.length - 500);
    this.notes.push({ midi, t, dur, vel: vel ?? 0.7, hand });
  }
  /** 用 setInterval 而非 rAF：标签页被遮挡时 rAF 会被浏览器暂停，画面就此冻结 */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.draw(), 33);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.notes = [];
    this.draw();
  }
  draw() {
    const { ctx2d: g, canvas } = this;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    g.clearRect(0, 0, W, H);
    const now = this.now();
    const colW = W / this.span;
    const alive = [];
    for (const n of this.notes) {
      const end = n.t + Math.max(n.dur, 0.12);
      if (end < now - 0.4) continue;
      alive.push(n);
      const yBottom = H - ((n.t - now) / this.approach) * H;
      if (yBottom < -20 || yBottom - 4 > H + 40) continue;
      const hPx = Math.max(5, (n.dur / this.approach) * H);
      const x = (n.midi - this.low) * colW + colW * 0.12;
      const wPx = colW * 0.76;
      const base = n.hand === 'L' ? [147, 199, 189] : [235, 197, 116];
      const alpha = 0.34 + n.vel * 0.5;
      g.save();
      if (!this.lite) { g.shadowColor = `rgba(${base[0]},${base[1]},${base[2]},0.6)`; g.shadowBlur = 10; }
      g.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha})`;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, yBottom - hPx, wPx, hPx, 3); else g.rect(x, yBottom - hPx, wPx, hPx);
      g.fill();
      g.restore();
      // 命中瞬间：键床上的光斑
      if (n.t <= now && end >= now) {
        g.save();
        if (!this.lite) { g.shadowColor = `rgba(${base[0]},${base[1]},${base[2]},0.9)`; g.shadowBlur = 14; }
        g.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${0.35 + n.vel * 0.3})`;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, Math.min(yBottom, H - 5) - 4, wPx, 4.5, 2); else g.rect(x, Math.min(yBottom, H - 5) - 4, wPx, 4.5);
        g.fill();
        g.restore();
      }
    }
    this.notes = alive;
  }
  destroy() { this.stop(); this._ro.disconnect(); }
}

/** 决策日志：节目单式，一行一个小节 */
const DEV_ZH = { repeat: '承袭', sequence: '模进', inversion: '倒影', ornament: '装饰', new: '新句' };
const FN_ZH = { T: '主', S: '下属', D: '属', Tp: '色彩' };

/** 功能轨某一格的可读描述（纯函数，便于单测；无障碍与 title 共用） */
export function fnLabel(fn) {
  return FN_ZH[fn] ?? fn ?? '';
}

/** 功能轨一格的类名：颜色与断路器标记都挂在 data 属性上，样式全在 CSS */
export function fnSegClass(bar) {
  const fn = bar?.decision?.chordFn ?? 'T';
  return ['fnseg', `fn-${FN_ZH[fn] ? fn : 'T'}`, bar?.decision?.loopLocked ? 'lock' : '', bar?.decision?.rejected ? 'rej' : '']
    .filter(Boolean).join(' ');
}

export function addDecision(ul, bar) {
  const d = bar.decision;
  ul.querySelectorAll('.fresh').forEach((el) => el.classList.remove('fresh'));
  const li = document.createElement('li');
  li.className = 'fresh';
  const stats = d.fixture
    ? `<span class="fixture">离线随机</span>`
    : `<span>${d.ms}ms</span><span>${d.inputTokens}tok</span><span>$${d.usd.toFixed(6)}</span>${d.confidence != null ? `<span>置信 ${Number(d.confidence).toFixed(2)}</span>` : ''}`;
  // 断路器/候选集强制的归因标记：把 ADR-0003 的"剔除即强制"从代码搬到人眼前
  const guards = [
    d.loopLocked ? '<span class="guard lock" title="循环锁死断路器触发：循环根音已从本小节候选中剔除">断路</span>' : '',
    d.rejected ? '<span class="guard rej" title="模型答案不在候选集内，已按候选集强制回落">驳回</span>' : '',
  ].join('');
  li.innerHTML =
    `<span class="log-no">${bar.index + 1}<small>${bar.label}</small></span>` +
    `<span class="log-chord">${escapeHtml(bar.chord.symbol)}</span>` +
    `<span class="fn-chip fn-${d.chordFn && FN_ZH[d.chordFn] ? d.chordFn : 'T'}" title="和声功能：${escapeHtml(fnLabel(d.chordFn))}">${escapeHtml(fnLabel(d.chordFn))}</span>` +
    `<span class="log-detail">` +
    `<span>左手 <b>${escapeHtml(d.lh)}</b></span>` +
    `<span>走向 <span class="q">${escapeHtml(d.contour)}</span></span>` +
    `<span>手法 <span class="q">${DEV_ZH[d.develop] ?? escapeHtml(d.develop ?? '')}</span></span>` +
    `<span>密度 ${d.tier}</span>` +
    `<span>强度 <b>${bar.intensity.toFixed(1)}</b></span>` +
    `${d.breathe ? '<span class="q">呼吸</span>' : ''}` +
    `${guards}` +
    `</span>` +
    `<span class="log-stats">${stats}</span>`;
  ul.prepend(li);
  ul.scrollTop = 0; // 最新一条始终在顶部可见（抵消浏览器滚动锚定）
  while (ul.children.length > 60) ul.lastChild.remove();
}

/**
 * 和声功能轨：每个已演奏小节一格，按功能着色，标记断路器触发与候选集驳回。
 * 保留最近 RIBBON_MAX 格；最早的一格是"正在响"的那一小节，用 aria-current 标出。
 * DOM 而非 canvas：一屏十几段，DOM 免费换来可访问性、hover 提示与 CSS 变量配色。
 */
export const RIBBON_MAX = 18;

export function pushFnSegment(ribbon, bar) {
  if (!ribbon) return;
  const seg = document.createElement('span');
  seg.className = fnSegClass(bar) + ' fresh';
  const fn = bar.decision.chordFn ?? 'T';
  seg.innerHTML = `<i></i><b>${escapeHtml(fnLabel(fn))}</b>`;
  seg.title = `第 ${bar.index + 1} 小节 ${bar.label} · ${bar.chord.symbol} · ${fnLabel(fn)}功能`;
  ribbon.prepend(seg);
  while (ribbon.children.length > RIBBON_MAX) ribbon.lastChild.remove();
  ribbon.querySelectorAll('[aria-current]').forEach((el) => el.removeAttribute('aria-current'));
  ribbon.firstElementChild?.setAttribute('aria-current', 'true');
}

/** 计划卡 */
export function renderPlan(el, plan) {
  const srcBadge = plan.source === 'llm' ? '<span class="badge">LLM 扩写</span>' : '<span class="badge">关键词理解</span>';
  el.innerHTML =
    `<h3>${escapeHtml(plan.title)}${srcBadge}</h3>` +
    `<div class="meta">${escapeHtml(plan.styleName)}　${'CDEFGAB'[plan.keyPc]} ${plan.mode}　${plan.bpm} BPM　${plan.meterNum}/4　弧线 ${plan.arc}　${plan.totalBars} 小节</div>` +
    `<div class="meta" style="margin-top:2px">情绪 ${escapeHtml(plan.mood.join(' / '))}</div>` +
    (plan.notes ? `<div class="notes">${escapeHtml(plan.notes)}</div>` : '');
}

export function setStatus(pills, { channel, tokens, cost, latency }) {
  if (channel != null) pills.channel.textContent = channel;
  if (tokens != null) pills.tokens.textContent = `${Math.round(tokens).toLocaleString()} tok`;
  if (cost != null) pills.cost.textContent = `$${cost.toFixed(6)}`;
  if (latency != null) pills.latency.textContent = latency == null ? '— ms' : `${Math.round(latency)} ms`;
}

export function toast(el, msg, ms = 4000) {
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
