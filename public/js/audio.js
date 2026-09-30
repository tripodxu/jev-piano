// audio.js — 合成钢琴 + 生成式混响 + 录音。零采样下载：三角波基频 + 正弦泛音 + 包络 + 低通。
// 纯参数函数 envFor 可单测；AudioContext 相关只能在浏览器里跑（Task 10 冒烟验证）。

/** 音符声学参数：高音衰减小、力度大则亮 */
export function envFor(midi, vel, brightness = 0.5) {
  const peak = 0.12 + vel * 0.55;
  const decay = Math.min(5.5, Math.max(1.2, 5.5 - ((midi - 36) / 12) * 1.4));
  const cutoff = Math.min(9000, 480 + midi * 28 * (0.4 + brightness) + vel * 2200);
  return { peak, decay, cutoff, release: 0.28 };
}

export class PianoAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.dry = null;
    this.wet = null;
    this.voices = [];       // {midi, gain, offAt}
    this.recorder = null;
    this.recDest = null;
    this.muted = false;
    this.volume = 0.9;
  }

  /** 必须在用户手势里首次调用（自动播放策略） */
  async ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    await this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.dry = this.ctx.createGain(); this.dry.gain.value = 0.85;
    this.wet = this.ctx.createGain(); this.wet.gain.value = 0.22;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3;
    const reverb = this.ctx.createConvolver();
    reverb.buffer = this._impulse(1.8, 2.6);
    this.dry.connect(comp); this.wet.connect(reverb); reverb.connect(comp);
    comp.connect(this.master); this.master.connect(this.ctx.destination);
    // 录音分支
    this.recDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.recDest);
  }

  /** 生成式脉冲响应：双通道指数衰减白噪声 */
  _impulse(seconds, decayPow) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decayPow);
      }
    }
    return buf;
  }

  /** 播放一个音（whenSec 为 ctx 时间轴）；复音上限 32，超出强释最旧 */
  play(midi, whenSec, durSec, vel) {
    if (!this.ctx || this.muted) return;
    const t0 = Math.max(whenSec, this.ctx.currentTime + 0.005);
    const { peak, decay, cutoff, release } = envFor(midi, vel, 0.5);
    const f = 440 * Math.pow(2, (midi - 69) / 12);

    if (this.voices.length >= 32) {
      const oldest = this.voices.shift();
      try { oldest.gain.gain.cancelScheduledValues(this.ctx.currentTime); oldest.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); } catch { /* */ }
    }

    const g = this.ctx.createGain();
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = cutoff; flt.Q.value = 0.4;

    const oscs = [
      { type: 'triangle', freq: f, amp: 1 },
      { type: 'sine', freq: f * 2.003, amp: 0.4 },
      { type: 'sine', freq: f * 3.01, amp: 0.14 },
    ].map(({ type, freq, amp }) => {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      const og = this.ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(flt); o.start(t0);
      return o;
    });

    const stopAt = t0 + Math.max(durSec, 0.12) + release;
    // 钢琴式包络：快起 → 指数衰减到延音 → 松键释放
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.14, 0.001), t0 + Math.min(decay, durSec + 0.1));
    g.gain.setTargetAtTime(0.0001, t0 + Math.max(durSec, 0.12), release / 3);
    flt.connect(g); g.connect(this.dry); g.connect(this.wet);
    oscs.forEach((o) => o.stop(stopAt + 0.1));

    const voice = { midi, gain: g };
    this.voices.push(voice);
    // 事件驱动清理（轮次 32）：主振荡器 stop 到点时移除 voice。
    // 旧实现每音挂一个 setTimeout——后台标签页定时器被节流（≥1s），voices 靠 32 上限硬挤；
    // onended 由音频线程时钟驱动，不受页面可见性影响。
    oscs[0].onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  mute(on) {
    this.muted = on;
    if (this.master) this.master.gain.value = on ? 0 : this.volume;
  }

  /** 录音（MediaRecorder，webm/opus）；返回 stop() → Promise<Blob> */
  startRec() {
    if (!this.recDest) return null;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m));
    this.recorder = new MediaRecorder(this.recDest.stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { this.recorder.onstop = () => resolve(new Blob(chunks, { type: this.recorder.mimeType })); });
    this.recorder.start();
    return { stop: () => { this.recorder?.stop(); return done; } };
  }
}

/** 共享单例：实时即兴与工作室两个界面共用同一个 AudioContext */
let _shared = null;
export function getAudio() {
  if (!_shared) _shared = new PianoAudio();
  return _shared;
}
