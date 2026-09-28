// tension.js — 音乐张力分析：把「这一小节听起来有多紧」变成一个可测、可画的数。
// 纯函数、无 DOM、无决策副作用——这是**分析层**，不是**决策层**：
// 它读取已经渲染好的小节（和弦/功能/音域/密度/力度），不改任何一个音符。
import { CHORD_SHAPES } from './music.js';

/** 音程（相对根音的半音数）的不协和度。Plomp-Levelt 思想的简化版：
 *  小二度(1) 与三全音(6) 最刺耳，纯五(7) 几乎协和，大七(11) 明显比小七(10) 紧张。 */
const DISS = [0, 0.8, 0.15, 0.25, 0.1, 0.2, 0.8, 0.05, 0.45, 0.15, 0.2, 0.4];
/** m7b5 [0,3,6,10] 的不协和度和 = 1.25，作为归一化上限 */
const MAX_DISS = 1.25;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** 和弦形状的内在张力 0..1：三和弦平静，七和弦次之，减/半减最紧 */
export function shapeTension(shape) {
  const iv = CHORD_SHAPES[shape] || CHORD_SHAPES[''];
  const sum = iv.reduce((s, i) => s + DISS[((i % 12) + 12) % 12], 0);
  return clamp01(sum / MAX_DISS);
}

/** 和声功能的张力：离"家"越远越紧。
 *  次序 T < Tp < S < D 是刻意的——Tp（bVI/bIII/III 这类相对调色彩和弦）听感上比
 *  功能性下属和弦（IV/ii）更安定，它只是"颜色不同"而不是"要往别处去"；
 *  离调色彩自身的咬劲由 harmonic 分量负责，这里不重复计入。 */
export const FUNCTION_TENSION = { T: 0.15, Tp: 0.32, S: 0.45, D: 0.85 };

/** 五个分量的权重（相加为 1；调它们等于改"我们认为什么让音乐紧张"） */
export const TENSION_WEIGHTS = { harmonic: 0.34, functional: 0.24, register: 0.16, density: 0.12, dynamic: 0.14 };

/**
 * 单小节张力 0..1。bar 需含 { chord:{shape}, intensity, notes:[{midi,hand}] }，
 * 缺字段一律降级为该项的中性值，绝不抛错——分析层不能打断播放。
 */
export function barTension(bar) {
  if (!bar || !Array.isArray(bar.notes) || bar.notes.length === 0) return 0; // 没有音符就没有声音，也就没有张力
  const harmonic = shapeTension(bar.chord?.shape);
  const functional = FUNCTION_TENSION[bar.decision?.chordFn] ?? 0.5;
  const ms = bar.notes.map((n) => n.midi).filter((m) => Number.isFinite(m));
  const register = ms.length ? clamp01((Math.max(...ms) - Math.min(...ms)) / 48) : 0;
  const rh = bar.notes.filter((n) => n.hand === 'R').length;
  const density = clamp01(rh / 8);
  const dynamic = clamp01((Number(bar.intensity) || 0) / 3);
  const W = TENSION_WEIGHTS;
  return clamp01(W.harmonic * harmonic + W.functional * functional + W.register * register
    + W.density * density + W.dynamic * dynamic);
}

/** 实际张力序列：逐小节的数值数组（0..1） */
export function tensionSeries(bars) {
  return (bars ?? []).map(barTension);
}

/**
 * 滑动平滑（居中窗口）：张力逐小节抖动很大，直接连线会像心电图。
 * 窗口取奇数长度，端点做边缘复制（不丢数据）。
 */
export function smooth(series, win = 3) {
  if (win < 2 || series.length < 2) return [...(series ?? [])];
  const k = Math.floor(win / 2);
  return series.map((_, i) => {
    let sum = 0, n = 0;
    for (let j = i - k; j <= i + k; j++) {
      const v = series[Math.min(series.length - 1, Math.max(0, j))];
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    return n ? sum / n : 0;
  });
}

/** 描述性统计：给 UI 的数值读数用（均值/峰/谷），不做任何决策 */
export function tensionStats(series) {
  const s = (series ?? []).filter((v) => Number.isFinite(v));
  if (!s.length) return { mean: 0, max: 0, min: 0, span: 0 };
  const max = Math.max(...s), min = Math.min(...s);
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, max, min, span: max - min };
}
