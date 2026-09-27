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
  constructor(canvas, nowFn, { approach = 2.2, low = LOW, high = HIGH + 1 } = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.now = nowFn;
    this.approach = approach;
    this.low = low;
    this.span = high - low;
    this.notes = [];
    this.raf = null;
    this._resize = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    globalThis.addEventListener('resize', this._resize);
    this._resize();
  }
  push({ midi, t, dur, vel, hand }) {
    this.notes.push({ midi, t, dur, vel: vel ?? 0.7, hand });
  }
  start() {
    if (this.raf) return;
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
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
      g.fillStyle = n.hand === 'L' ? `rgba(92,200,200,${0.25 + n.vel * 0.5})` : `rgba(240,180,41,${0.25 + n.vel * 0.55})`;
      g.beginPath();
      g.roundRect?.(x, yBottom - hPx, wPx, hPx, 3);
      if (!g.roundRect) g.rect(x, yBottom - hPx, wPx, hPx);
      g.fill();
      // 命中线上的高亮描边
      if (n.t <= now && end >= now) {
        g.strokeStyle = n.hand === 'L' ? '#9fe8e8' : '#ffd977';
        g.strokeRect(x, yBottom - hPx, wPx, hPx);
      }
    }
    this.notes = alive;
  }
  destroy() { this.stop(); globalThis.removeEventListener('resize', this._resize); }
}

/** 决策日志：每小节一条，前置插入 */
export function addDecision(ul, bar) {
  const d = bar.decision;
  const li = document.createElement('li');
  const conf = d.confidence != null ? ` · 置信 <span class="q">${Number(d.confidence).toFixed(2)}</span>` : '';
  const cost = d.fixture ? `<span class="dim">离线随机</span>` : `${d.ms}ms · ${d.inputTokens}tok · $${d.usd.toFixed(6)}${conf}`;
  li.innerHTML =
    `第 ${bar.index + 1} 小节 <span class="dim">[${bar.label}]</span> · ` +
    `<span class="ch">${bar.chord.symbol}</span> · 左手 <span class="q">${d.lh}</span> · ` +
    `<span class="q">${d.contour}</span> · 密度${d.tier} · 强度 ${bar.intensity.toFixed(1)}` +
    `${d.breathe ? ' · 呼吸' : ''} <span class="dim">｜ ${cost}</span>`;
  ul.prepend(li);
  while (ul.children.length > 60) ul.lastChild.remove();
}

/** 计划卡 */
export function renderPlan(el, plan) {
  const srcBadge = plan.source === 'llm' ? '<span class="badge">LLM 扩写</span>' : '<span class="badge">关键词理解</span>';
  el.innerHTML =
    `<h3>${escapeHtml(plan.title)}${srcBadge}</h3>` +
    `<div class="meta">${escapeHtml(plan.styleName)} · ${'CDEFGAB'[plan.keyPc]} ${plan.mode} · ${plan.bpm} BPM · ` +
    `${plan.meterNum}/4 · 弧线 ${plan.arc} · ${plan.totalBars} 小节 · 情绪 ${plan.mood.join(' / ')}</div>` +
    (plan.notes ? `<div class="notes">🎼 ${escapeHtml(plan.notes)}</div>` : '');
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
