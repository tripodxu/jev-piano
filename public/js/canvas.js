// canvas.js — canvas 可视化三件套 + 它们专用的绘制辅助（轮次 52 从 ui.js 拆出，ADR-0004 每文件 ≤800 行）。
// 下落音符（Fall）/ 张力对照带（TensionGraph）/ 动机卡（MotifCard）；三者都自带 ResizeObserver，
// 尺寸由 _resize 缓存、draw() 不读布局，静止画面只在数据变化时重绘（能耗契约见 AGENTS.md §2）。
// **本模块零 import**：只画，不决策、不取数、不碰 DOM 之外的东西。

export const LOW = 36, HIGH = 84; // C2..C6（音域边界：Fall 的键跨度与 ui.js 的键盘渲染共用）

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
    this.w = 0; this.h = 0; // 尺寸在 _resize 里缓存：draw 每 33ms 跑一次，不能再逐帧读 clientWidth
    // 移动端省 GPU：shadowBlur 是 canvas 最大的帧率杀手
    this.lite = globalThis.matchMedia?.('(max-width: 980px)')?.matches ?? false;
    // 用 ResizeObserver 保持位图与布局同步（缩放/窗口/布局变化都不怕）
    this._resize = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      this.w = w; this.h = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(canvas);
    this._resize();
  }
  push({ midi, t, dur, vel, hand, user }) {
    if (this.notes.length > 500) this.notes.splice(0, this.notes.length - 500);
    this.notes.push({ midi, t, dur, vel: vel ?? 0.7, hand, user: !!user });
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
    const { ctx2d: g } = this;
    const W = this.w, H = this.h;
    if (!W || !H) return;
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
      // 跟弹用户音符（轮次 56）：紫色独立于 AI 双手（琥珀/青绿），另加近白描边——
      // 颜色之外还有形状通道，色弱也能分辨「这个音是你弹的」
      const base = n.user ? [203, 186, 250] : n.hand === 'L' ? [147, 199, 189] : [235, 197, 116];
      const alpha = 0.34 + n.vel * 0.5;
      g.save();
      if (!this.lite) { g.shadowColor = `rgba(${base[0]},${base[1]},${base[2]},0.6)`; g.shadowBlur = 10; }
      g.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha})`;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, yBottom - hPx, wPx, hPx, 3); else g.rect(x, yBottom - hPx, wPx, hPx);
      g.fill();
      if (n.user) { g.strokeStyle = 'rgba(246,243,255,0.85)'; g.lineWidth = 1; g.stroke(); }
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

export function sectionLabel(sec) {
  return sec && sec.id != null ? String(sec.id) : '';
}

export function chorusView(actual, totalBars) {
  const bars = Number.isInteger(totalBars) && totalBars > 0 ? totalBars : 0;
  const list = Array.isArray(actual) ? actual : [];
  if (!bars || list.length <= bars) {
    return { past: [], current: list, base: 0, total: bars };
  }
  const base = Math.floor((list.length - 1) / bars) * bars;
  return { past: list.slice(0, bars), current: list.slice(base), base, total: bars };
}

export function hoverBarAt(px, width, n, padL = 26, padR = 6) {
  if (!Number.isFinite(px) || !Number.isFinite(width) || !Number.isInteger(n) || n < 1) return -1;
  const iw = width - padL - padR;
  if (iw <= 0 || px < padL - 4 || px > width - padR + 4) return -1;
  const t = (px - padL) / iw;
  return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
}

export class TensionGraph {
  constructor(canvas, { barsPerPhrase = 8 } = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.barsPerPhrase = barsPerPhrase;
    this.actual = [];    // 已演奏小节的张力
    this.target = [];    // 计划弧线
    this.sections = [];  // 段落（画竖线 + 段落名）
    this.meta = [];      // 每小节元数据 {chord, speed}（hover 读数；与 actual 同序）
    this.hoverX = null;  // 指针横坐标（null = 不在画布上）
    this.timer = null;
    this.w = 0; this.h = 0; // 尺寸在 _resize 里缓存
    canvas.addEventListener('pointermove', (e) => {
      this.hoverX = e.clientX - canvas.getBoundingClientRect().left;
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.draw(); });
    this._resize = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      this.w = w; this.h = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(canvas);
    this._resize();
  }

  /** 追加一个已演奏小节（tension 0..1） */
  push(tension) {
    if (Number.isFinite(tension)) this.actual.push(tension);
    this.draw();
  }

  /** 追加当前小节的读数元数据（与 push 同调）：{chord, speed} */
  pushMeta(m) {
    if (m && typeof m === 'object') this.meta.push(m);
  }

  /** 设定计划弧线（一次性，演奏开始前） */
  setTarget(series) {
    this.target = Array.isArray(series) ? series : [];
    this.draw();
  }

  /** 设定段落：竖线 + 段落名（文字通道，不依赖颜色） */
  setSections(sections) {
    this.sections = Array.isArray(sections) ? sections.filter((s) => Number.isFinite(s?.start)) : [];
    this.draw();
  }

  /** 设定遍长（轮次 42）：已知后进入双遍对照——上一遍曲线作为幽灵留在原地 */
  setTotalBars(n) {
    this.totalBars = Number.isInteger(n) && n > 0 ? n : 0;
    this.draw();
  }

  reset() { this.actual = []; this.meta = []; this.hoverX = null; this.draw(); }
  /** 张力带是**静止**画面：内容只在 push/setTarget/setSections/hover/resize 时变，且每个入口都自己调 draw()。
   *  曾经用 setInterval(draw, 120) 自我重绘——8fps 反复清一整块不动的画布，纯烧 CPU 与电池。 */
  start() { this.draw(); }
  stop() { this.draw(); }
  destroy() { this.stop(); this._ro.disconnect(); }

  draw() {
    const { ctx2d: g } = this;
    const W = this.w, H = this.h;
    if (!W || !H) return;
    g.clearRect(0, 0, W, H);
    // 空态（轮次 66）：没有实际/计划数据时整块留白——只有刻度的残影看起来像渲染失败
    if (!this.actual.length && !this.target.length) return;
    const padL = 26, padR = 6, padT = 6, padB = 12;
    const iw = Math.max(1, W - padL - padR), ih = Math.max(1, H - padT - padB);
    const yOf = (v) => padT + (1 - Math.min(1, Math.max(0, v))) * ih;
    // 双遍对照（轮次 42）：分遍后 x 轴是「遍内位置」——上一遍的形状与当前遍同轴叠加
    const cv = chorusView(this.actual, this.totalBars);
    const n = Math.max(this.target.length, cv.total || this.actual.length, 1);

    // 乐句分隔竖线：让"形状"有可读的乐句单位
    g.strokeStyle = 'rgba(214,178,110,0.10)';
    g.lineWidth = 1;
    for (let b = this.barsPerPhrase; b < n; b += this.barsPerPhrase) {
      const x = Math.round(padL + (b / n) * iw) + 0.5;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ih); g.stroke();
    }
    g.strokeStyle = 'rgba(214,178,110,0.16)';
    g.beginPath(); g.moveTo(padL, Math.round(yOf(0)) + 0.5); g.lineTo(padL + iw, Math.round(yOf(0)) + 0.5); g.stroke();

    const line = (series, color, width, dashed) => {
      if (!series.length || n < 1) return;
      g.save();
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
      if (dashed) g.setLineDash([3, 3]);
      g.beginPath();
      series.forEach((v, i) => {
        const x = padL + (n > 1 ? (i / (n - 1)) * iw : 0);
        const y = yOf(v);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
      g.restore();
    };

    // 计划弧线（幽灵）在下，上一遍（幽灵）其次，当前遍实线在上
    line(this.target, 'rgba(214,178,110,0.34)', 1.2, true);
    if (cv.past.length) line(cv.past, 'rgba(154,144,120,0.55)', 1.2, true);
    line(cv.current.length ? cv.current : this.actual, '#e8c57c', 1.8, false);

    // 段落竖线 + 段落名：虚线是**独立于颜色的形状线索**，段落名是文字线索，
    // 二者叠加满足「不依赖颜色」（ui-ux-pro-max chart 域）
    g.save();
    g.font = '9px monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    for (const s of this.sections) {
      const i = Math.round((s.start / Math.max(1, n)) * (n - 1));
      const x = padL + (n > 1 ? (i / (n - 1)) * iw : 0);
      g.strokeStyle = 'rgba(240,205,138,0.45)';
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ih); g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(240,205,138,0.8)';
      g.fillText(sectionLabel(s), x + 3, padT);
    }
    g.restore();

    g.save();
    g.font = '9px monospace';
    g.fillStyle = 'rgba(154,144,120,0.9)';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) g.fillText(v.toFixed(1), padL - 5, yOf(v));
    g.restore();

    // hover 读数：crosshair + 文字（第 N 小节 / 张力 / 计划 / 和弦 / 速度）。
    // 只在指针悬停时出现，读数全是文字——颜色不承载任何 hover 才能读到的信息。
    if (this.hoverX != null) {
      const i = hoverBarAt(this.hoverX, W, n, padL, padR);
      if (i >= 0) {
        const x = padL + (n > 1 ? (i / (n - 1)) * iw : 0);
        g.save();
        g.strokeStyle = 'rgba(240,205,138,0.45)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.round(x) + 0.5, padT); g.lineTo(Math.round(x) + 0.5, padT + ih); g.stroke();
        const av = this.actual[i];
        if (av != null && Number.isFinite(av)) {
          g.fillStyle = '#f6d695';
          g.beginPath(); g.arc(x, yOf(av), 2.5, 0, Math.PI * 2); g.fill();
        }
        const m = this.meta[Math.min(this.meta.length - 1, (cv.base || 0) + i)] ?? (this.meta[i] ?? {});
        g.font = '10px monospace';
        g.textAlign = 'right'; g.textBaseline = 'top';
        g.fillStyle = 'rgba(240,205,138,0.95)';
        g.fillText(`第 ${i + 1} 小节`, W - padR, padT);
        const tv = this.target[i];
        g.fillStyle = 'rgba(232,197,124,0.92)';
        g.fillText(`张力 ${av != null && Number.isFinite(av) ? av.toFixed(2) : '—'}${Number.isFinite(tv) ? ` · 计划 ${tv.toFixed(2)}` : ''}`, W - padR, padT + 13);
        const speed = Number.isFinite(m.speed) ? ` · 速度 ${m.speed}` : '';
        if (m.chord || speed) {
          g.fillStyle = 'rgba(200,188,160,0.9)';
          g.fillText(`${m.chord ?? ''}${speed}`, W - padR, padT + 26);
        }
        g.restore();
      }
    }
  }
}

export function motifShape(midis) {
  if (!Array.isArray(midis) || !midis.length) return [];
  const lo = Math.min(...midis), hi = Math.max(...midis);
  const flat = hi === lo;                 // 全同音：形状是一条平线，放中线而不是贴顶边
  const span = hi - lo || 1;
  const n = midis.length;
  return midis.map((m, i) => ({
    x: n > 1 ? i / (n - 1) : 0,
    y: flat || n < 2 ? 0.5 : 1 - (m - lo) / span,
  }));
}

/** 强调窗口时长（ms）与重绘节拍。原实现以 120ms 常驻重绘，节拍沿用，只是改成窗口内有限次。 */
export const MOTIF_PULSE_MS = 900;
const PULSE_TICK_MS = 120;

export function pulseActive(pulseAt, now = Date.now(), ms = MOTIF_PULSE_MS) {
  return pulseAt != null && now - pulseAt < ms;
}

export class MotifCard {
  constructor(canvas, { now = () => Date.now() } = {}) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.now = now;          // 时钟可注入：强调窗口的时长要能被测试断言，不靠 sleep
    this.midis = [];
    this.restatements = 0;
    this.pulseAt = null;     // null = 没有正在进行的强调（0 是合法时间戳，不能当哨兵）
    this.timer = null;       // 常驻定时器已废弃，字段保留只为 stop/destroy 的旧契约不炸
    this.pulseTimer = null;  // 强调窗口内的有限次自排程重绘
    this.running = false;
    this.w = 0; this.h = 0;
    this._resize = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      this.w = w; this.h = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    };
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(canvas);
    this._resize();
  }

  /** 第 2 小节：动机诞生 */
  setMotif(midis) {
    this.midis = Array.isArray(midis) ? midis.filter((m) => Number.isFinite(m)) : [];
    this.restatements = 0;
    this.pulseAt = null;
    this.draw();
    return this.midis.length;
  }

  /** 一次承袭：计数 +1，并触发一次**静默**强调（delight 的判据：只为真正有意义的瞬间庆祝，且只此一次） */
  markRestatement() {
    this.restatements++;
    this.pulseAt = this.now();
    this.draw();
    this._pulse();
  }

  reset() { this.midis = []; this.restatements = 0; this.pulseAt = null; this._clearPulse(); this.draw(); }
  /** 动机卡平时静止：start() 不再起常驻定时器，强调只在 markRestatement 后的窗口内自排程重绘。 */
  start() { this.running = true; this.draw(); this._pulse(); }
  stop() { this.running = false; this._clearPulse(); this.draw(); }
  destroy() { this.stop(); this._ro.disconnect(); }

  _clearPulse() { if (this.pulseTimer) clearTimeout(this.pulseTimer); this.pulseTimer = null; }

  /** 强调只活在 MOTIF_PULSE_MS 内：期间有限次重绘，窗口一关闭立刻停手并补一帧常态描边。
   *  「重复一百次还讨喜」的前提是不再有东西在背后持续画。 */
  _pulse() {
    this._clearPulse();
    if (!this.running) return;
    if (pulseActive(this.pulseAt, this.now())) {
      this.pulseTimer = setTimeout(() => { this.pulseTimer = null; this.draw(); this._pulse(); }, PULSE_TICK_MS);
    } else if (this.pulseAt != null) {
      this.pulseAt = null;
      this.draw(); // 收尾帧：描边从强调色回到常态
    }
  }

  draw() {
    const { ctx2d: g } = this;
    const W = this.w, H = this.h;
    if (!W || !H) return;
    g.clearRect(0, 0, W, H);
    g.save();
    // canvas 的 font 不解析 CSS 变量（var(--sans) 会被静默忽略）——字面字体栈，与 styles.css --sans 同族（有契约测试守）
    g.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = 'rgba(154,144,120,0.95)';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('动机', 0, 0);
    if (this.restatements) {
      g.textAlign = 'right';
      g.fillStyle = 'rgba(216,171,92,0.9)';
      g.fillText(`回来 ${this.restatements} 次`, W, 0);
    }
    g.restore();

    const pts = motifShape(this.midis);
    if (pts.length < 2) {
      g.save();
      g.fillStyle = 'rgba(154,144,120,0.7)';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(pts.length ? '' : '第 2 小节后出现', 0, H - 9);
      g.restore();
      return;
    }
    const padX = 6, top = 16, bot = 8;
    const w = Math.max(1, W - padX * 2), h = Math.max(1, H - top - bot);
    const X = (p) => padX + p.x * w;
    const Y = (p) => top + p.y * h;
    // 强调只在首次再现后约 900ms 内有效，之后回到常态——重复一百次还讨喜是 delight 的判据
    const fresh = pulseActive(this.pulseAt, this.now());
    g.save();
    g.strokeStyle = fresh ? 'rgba(240,205,138,0.98)' : 'rgba(216,171,92,0.72)';
    g.lineWidth = fresh ? 2 : 1.4;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))));
    g.stroke();
    g.fillStyle = fresh ? '#f6d695' : 'rgba(216,171,92,0.9)';
    for (const p of [pts[0], pts[pts.length - 1]]) g.fillRect(X(p) - 2, Y(p) - 2, 4, 4);
    g.restore();
  }
}
