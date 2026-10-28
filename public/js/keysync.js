// keysync.js — 琴键视觉的**音频时钟**驱动（轮次 71）。
//
// 为什么需要它：此前琴键亮起走的是 setTimeout（main.js 算一个延迟、ui.js 的 flash 再挂一个
// 熄灭定时器，点击反馈还有第三个）。setTimeout 是**挂钟**定时器，与 AudioContext 是两套时间
// 基准——事件循环一拥塞、标签页一被节流，琴键就与声音错开；密集连奏时定时器队列积压，
// 误差还会累积。而同一个音的下落音符（canvas.js 的 Fall）用的是 `audio.ctx.currentTime`，
// 于是同一件事的两套视觉一个准一个不准。
//
// 纪律：**时间基准只能有一个**，就是注入进来的 clock()。构造函数强制要求它，
// 不给就抛错——"忘了接音频时钟"必须是立刻可见的红，而不是静默退化成挂钟。
//
// 定时器同样是注入的（测试用假时钟），并且**按需启停**：没有待触发/正在响的音时
// 不起定时器，符合本项目的能耗纪律（静止类不得起常驻定时器）。

export const KEY_TICK_MS = 30;
/** 唤醒上限：事件还很远时最多睡这么久再复查一次。
 *  定时器只负责"到点叫醒我"，**判定时刻一律用音频时钟**——
 *  所以哪怕定时器自己抖了，也不会把误差累积到下一个音上。 */
export const WAKE_MAX_MS = 200;

export class KeySync {
  /**
   * @param {object} opts
   *   - clock      () => number **必填**：音频时钟（AudioContext.currentTime）
   *   - tickMs     轮询间隔（默认 30ms；只用 setInterval，rAF 在标签页遮挡时会暂停）
   *   - setTimer / clearTimer  可注入（测试用假定时器）
   *   - latency    () => number 输出延迟（声音离耳朵的距离，视觉据此提前）
   *   - sustainSec 踏板延音附加量（默认 0；接踏板时只改这一个数）
   */
  constructor({ clock, tickMs = KEY_TICK_MS, setTimer, clearTimer, latency = () => 0, sustainSec = 0 } = {}) {
    if (typeof clock !== 'function') throw new Error('KeySync 必须注入 clock()——时间基准只能是音频时钟');
    this._clock = clock;
    this._tickMs = tickMs;
    this._setTimer = setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this._clearTimer = clearTimer ?? ((id) => clearInterval(id));
    this._latency = latency;
    this._sustain = sustainSec;
    this.pending = [];   // [{midi, onAt, offAt, vel}] 按 onAt 升序
    this.active = new Map(); // midi → { offAt, vel }
    this._timer = null;
    this._onChange = null;
  }

  /**
   * 排一个键的按下/抬起。onAt/offAt 是**音频时间轴**的秒；
   * 视觉时刻 = 音频时刻 - 输出延迟（声音到耳朵要 latency，视觉得提前同样多才与听觉对齐）。
   * @returns {boolean} 是否真的排上了（未来的音；已经过去的音不补亮，避免卡顿后"回放"一片残影）
   */
  schedule(midi, onAt, offAt, vel = 0.7) {
    const lag = Math.max(0, Number(this._latency?.()) || 0);
    const on = onAt - lag;
    const off = Math.max(on, offAt - lag) + this._sustain;
    if (!(off > on)) return false;
    const ev = { midi, onAt: on, offAt: off, vel };
    // 二分插入保持升序：连奏一次排十几个音也只做 O(n) 比较，不整表重排
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].onAt > ev.onAt) i--;
    this.pending.splice(i, 0, ev);
    this._scheduleWake();
    return true;
  }

  /**
   * 推进到时刻 now，返回这一刻发生变化的键：Map<midi, vel|null>（null = 该熄灭）。
   * **纯逻辑**——不碰 DOM、不读时钟，now 由调用方给，因而可在 node 里用假时钟逐毫秒验证。
   */
  advance(now) {
    const changes = new Map();
    while (this.pending.length && this.pending[0].onAt <= now) {
      const ev = this.pending.shift();
      // 整段都已经过去了（后台节流/长卡顿）：**不补亮**。
      // 补亮会让卡顿结束后键盘突然回放一串迟到的动画，看着像"抽风"；
      // 正确做法是让它安静地过去——音频那边早也早就播完了。
      if (ev.offAt <= now) continue;
      const cur = this.active.get(ev.midi);
      if (cur && cur.offAt > ev.offAt) {
        cur.vel = ev.vel; // 连奏重叠：保留更晚的熄灭时刻，只更新力度
      } else {
        this.active.set(ev.midi, { offAt: ev.offAt, vel: ev.vel });
      }
      changes.set(ev.midi, ev.vel);
    }
    for (const [midi, st] of [...this.active]) {
      if (st.offAt <= now) {
        this.active.delete(midi);
        changes.set(midi, null);
      }
    }
    return changes;
  }

  _tick() {
    const changes = this.advance(this._clock());
    if (changes.size && this._onChange) {
      try { this._onChange(changes); } catch { /* 展示层异常不得拖垮时钟循环 */ }
    }
    this._scheduleWake();
  }

  /** 下一个需要醒来的时刻（最早的点亮或熄灭）；没有则为 null */
  _nextEventAt() {
    let next = this.pending.length ? this.pending[0].onAt : Infinity;
    for (const st of this.active.values()) if (st.offAt < next) next = st.offAt;
    return Number.isFinite(next) ? next : null;
  }

  /**
   * 定时到**下一个事件本身**，而不是固定 30ms 空转轮询。
   * 固定轮询会让每个音最多晚一整个 tick（30ms）才亮——16 分音符连奏时肉眼可见。
   * 现在是"到点叫醒 + 用音频时钟判定"，定时器抖动只影响这一次的唤醒时刻。
   */
  _scheduleWake() {
    this._stopTimer();
    if (!this._onChange) return;
    const next = this._nextEventAt();
    if (next == null) return; // 静默即停机：没有待触发也没有在响的音，一个定时器都不留
    const waitMs = Math.max(0, Math.min(WAKE_MAX_MS, (next - this._clock()) * 1000));
    this._timer = this._setTimer(() => this._tick(), waitMs);
  }

  _stopTimer() {
    if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; }
  }

  /** 开始驱动。onChange(changes) 只收到**变化**的键——沿用 markDiff 的差集纪律。 */
  start(onChange) {
    this._onChange = onChange ?? null;
    this._scheduleWake();
  }

  /** 停止：熄灭一切并停机。返回需要熄灭的键，交给调用方同步一次 DOM。 */
  stop() {
    this._stopTimer();
    this._onChange = null;
    this.pending = [];
    const dying = new Map([...this.active.keys()].map((m) => [m, null]));
    this.active.clear();
    return dying;
  }

  /** 清空（换曲/重来）：与 stop 的区别是保持驱动状态，后续还能继续排。 */
  clear() {
    this.pending = [];
    const dying = new Map([...this.active.keys()].map((m) => [m, null]));
    this.active.clear();
    this._stopTimer();
    return dying;
  }
}
