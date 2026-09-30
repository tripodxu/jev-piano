// player.js — 实时调度器：Web Audio 时钟 + lookahead（"A Tale of Two Clocks"模式）。
// 决策管线与播放并行：始终提前 ≥ AHEAD_BARS 个小节向 composer 要下一小节，
// Jev 的 100~500ms 延迟被完全藏在小节时长里。now/setTimer/clearTimer 可注入（测试用假时钟）。
import { tempoMultAt } from './candidates.js';

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

  /** 绝对拍 → ctx 时间轴秒。仅在游标失配的防御路径使用（正常路径走 _enqueueBar 的逐小节累计） */
  _beatToSec(absBeat) { return this._t0 + absBeat * this.secPerBeat; }

  start() {
    if (this.running) return;
    this.running = true;
    this._t0 = this._now() + 0.25; // 起播缓冲：给第一小节的决策留时间
    this._cursorBeat = 0;          // 速度弧线游标：下一期望小节的起始绝对拍
    this._cursorSec = this._t0;    // 该小节的起始秒（由逐小节累计而来）
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
    // 1) 小节边界 → UI（当前和弦/决策展示）。展示层抛错**不得**中断调度——
    // 2026-09-30 线上「弹到第二小节就停」的候选根因：onBar 里十几处 DOM 操作，
    // 任何一个异常都会炸掉整个 _tick（setInterval 回调里的异常不清定时器、但吞掉本轮全部调度）。
    // 红线「播放永不中断」要求把展示层隔离在 try/catch 后面。
    while (this.barMarks.length && this.barMarks[0].t <= this._now()) {
      const mark = this.barMarks.shift();
      try { this.onBarCb(mark.bar); } catch (e) { console.error('[jev] onBar 展示层异常（已跳过，播放不受影响）', e); }
      this.scheduledBars++;
      this.queuedBars = Math.max(0, this.queuedBars - 1);
    }
    // 2) 到点的音符 → 音频（audio 内部按 t0 精确排程）。同上：音频节点异常也不得拖垮排程
    while (this.queue.length && this.queue[0].t <= horizon) {
      const ev = this.queue.shift();
      try { this.audio?.play?.(ev.midi, ev.t, ev.dur, ev.vel); } catch (e) { console.error('[jev] audio.play 异常（跳过该音）', e); }
      this.records.push({ midi: ev.midi, startBeats: ev.beat, durBeats: ev.dur / this.secPerBeat, vel: ev.vel, hand: ev.hand });
      try { this.onNoteCb(ev); } catch (e) { console.error('[jev] onNote 展示层异常（已跳过）', e); }
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
    // 速度弧线：每小节用自己的乘数（tempoMultAt，来自计划），顺序游标累计小节起点秒。
    // 小节内恒速——相邻小节差 ≤4% 时 bar 内连续变化不可闻，而游标把映射保持为一次乘法。
    let barStartSec, spb;
    if (barStartBeat === this._cursorBeat) {
      spb = this.secPerBeat / tempoMultAt(this.composer.plan, bar.index);
      barStartSec = this._cursorSec;
      this._cursorBeat = barStartBeat + this.meterNum;
      this._cursorSec = barStartSec + this.meterNum * spb;
    } else {
      // 防御：乱序/缺口入队（正常管线不会发生）——回退线性映射，绝不让播放中断
      spb = this.secPerBeat;
      barStartSec = this._beatToSec(barStartBeat);
    }
    this.barMarks.push({ t: barStartSec, bar });
    this.barMarks.sort((a, b) => a.t - b.t); // 防御路径可能乱序，保持弹出语义正确
    for (const n of bar.notes) {
      const beat = barStartBeat + n.startBeats;
      this.queue.push({
        kind: 'note', t: barStartSec + n.startBeats * spb, midi: n.midi,
        dur: n.durBeats * spb, vel: n.vel, hand: n.hand, beat,
      });
    }
    this.queue.sort((a, b) => a.t - b.t);
    this.queuedBars++;
  }
}
