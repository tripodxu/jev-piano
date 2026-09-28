// player.js — 实时调度器：Web Audio 时钟 + lookahead（"A Tale of Two Clocks"模式）。
// 决策管线与播放并行：始终提前 ≥ AHEAD_BARS 个小节向 composer 要下一小节，
// Jev 的 100~500ms 延迟被完全藏在小节时长里。now/setTimer/clearTimer 可注入（测试用假时钟）。

export const LOOKAHEAD = 0.15;  // 秒：提前交给 AudioContext 精确排程的窗口
export const TICK_MS = 30;
export const AHEAD_BARS = 2;    // 决策管线深度

export class Player {
  constructor({ audio, composer, bpm, onBar, onNote, onError, now, setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (id) => clearInterval(id) }) {
    this.audio = audio;
    this.composer = composer;
    this.secPerBeat = 60 / (bpm || composer.plan.bpm);
    this.meterNum = composer.plan.meterNum;
    this.onBarCb = onBar ?? (() => {});
    this.onNoteCb = onNote ?? (() => {});
    this.onErrorCb = onError ?? (() => {});
    this._now = now ?? (() => (audio?.ctx ? audio.ctx.currentTime : 0));
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this.queue = [];        // {kind:'note', t, midi, dur, vel, hand, beat}
    this.barMarks = [];     // {t, bar}
    this.records = [];      // {midi, startBeats(绝对拍), durBeats, vel, hand} → MIDI 导出
    this.running = false;
    this.deciding = false;
    this.queuedBars = 0;
    this.scheduledBars = 0;
    this._timer = null;
    this._t0 = 0;
  }

  /** 绝对拍 → ctx 时间轴秒 */
  _beatToSec(absBeat) { return this._t0 + absBeat * this.secPerBeat; }

  start() {
    if (this.running) return;
    this.running = true;
    this._t0 = this._now() + 0.25; // 起播缓冲：给第一小节的决策留时间
    this._tick();
    this._timer = this._setTimer(() => this._tick(), TICK_MS);
  }

  stop() {
    this.running = false;
    if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; }
    if (this.paused) { this.paused = false; this.audio?.ctx?.resume?.(); }
    this.queue = [];
    this.barMarks = [];
    this.deciding = false;
    this.queuedBars = 0;
  }

  /** 暂停/继续（jevthoven 的 job pause/resume）：挂起 AudioContext 冻结其时钟，
   *  拍→秒的映射在恢复后依然成立，调度自动保持对齐；决策管线同时暂停。 */
  pause(on) {
    if (!this.running) return;
    if (on && !this.paused) {
      this.paused = true;
      if (this._timer != null) { this._clearTimer(this._timer); this._timer = null; }
      this.audio?.ctx?.suspend?.();
    } else if (!on && this.paused) {
      this.paused = false;
      this.audio?.ctx?.resume?.();
      if (!this._timer) this._timer = this._setTimer(() => this._tick(), TICK_MS);
    }
  }

  _tick() {
    if (!this.running) return;
    const horizon = this._now() + LOOKAHEAD;
    // 1) 小节边界 → UI（当前和弦/决策展示）
    while (this.barMarks.length && this.barMarks[0].t <= this._now()) {
      const mark = this.barMarks.shift();
      this.onBarCb(mark.bar);
      this.scheduledBars++;
      this.queuedBars = Math.max(0, this.queuedBars - 1);
    }
    // 2) 到点的音符 → 音频（audio 内部按 t0 精确排程）
    while (this.queue.length && this.queue[0].t <= horizon) {
      const ev = this.queue.shift();
      this.audio?.play?.(ev.midi, ev.t, ev.dur, ev.vel);
      this.records.push({ midi: ev.midi, startBeats: ev.beat, durBeats: ev.dur / this.secPerBeat, vel: ev.vel, hand: ev.hand });
      this.onNoteCb(ev);
    }
    // 3) 决策管线：保持提前 AHEAD_BARS 个小节
    if (!this.deciding && this.queuedBars < AHEAD_BARS) {
      this.deciding = true;
      this.composer.nextBar()
        .then((bar) => {
          this.deciding = false;
          if (!this.running) return;
          this._enqueueBar(bar);
        })
        .catch((err) => {
          this.deciding = false;
          this.onErrorCb(err);
          this.stop();
        });
    }
  }

  _enqueueBar(bar) {
    const barStartBeat = bar.index * this.meterNum;
    this.barMarks.push({ t: this._beatToSec(barStartBeat), bar });
    this.barMarks.sort((a, b) => a.t - b.t);
    for (const n of bar.notes) {
      const beat = barStartBeat + n.startBeats;
      this.queue.push({
        kind: 'note', t: this._beatToSec(beat), midi: n.midi,
        dur: n.durBeats * this.secPerBeat, vel: n.vel, hand: n.hand, beat,
      });
    }
    this.queue.sort((a, b) => a.t - b.t);
    this.queuedBars++;
  }
}
