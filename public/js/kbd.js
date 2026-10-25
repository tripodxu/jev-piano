// kbd.js — 电脑键盘弹奏（轮次 65）：物理键位（e.code，与键盘布局无关）→ 钢琴键。
// 标准在线钢琴映射：A–L 一行白键、W/E/T/Y/U/O/P 行上黑键、; 再跨三半音；
// Z/X 上下换八度（base 钳制在键盘音域内，与 ui 键盘/Fall 的 LOW..HIGH 同一真相源）。
// 纯函数可单测；attachKeyboard 把 handler 也暴露出来（测试直接调 handle，不必伪造 window）。
import { LOW, HIGH } from './canvas.js';

/** e.code → 相对 base 的半音偏移（base 默认 C4=60；最高 ; = base+16） */
export const KEY_SEMITONES = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

/** 琴键提示字母：KeyA→A、Semicolon→; */
export const keyLabel = (code) => (code === 'Semicolon' ? ';' : code.replace(/^Key/, ''));

/** 键码 + base → midi；未映射/脏输入返回 null */
export function keyToMidi(code, base) {
  const off = KEY_SEMITONES[code];
  return Number.isFinite(off) && Number.isFinite(base) ? base + off : null;
}

/** base 的可落点：只落在 C 上（C2/C3/C4）。键盘音域 36..84 与 17 键跨度（base+16 ≤ 84）
 *  共同决定可达的八度位就这三个——72 作 base 会让 ; 键顶到 88 越界。 */
export const OCTAVE_BASES = [LOW, LOW + 12, LOW + 24]; // 36 / 48 / 60（C2/C3/C4）
export const clampBase = (b) => {
  const v = Number(b);
  if (!Number.isFinite(v)) return 60;
  return OCTAVE_BASES.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), 60);
};

/** 该键盘事件要不要当琴键处理：忽略按住重触（真钢琴不会机关枪）、组合键（ctrl+z 是撤销不是弹奏）、
 *  以及焦点在表单里时的正常打字。纯函数，脏输入返回 false。 */
export function shouldHandle(e) {
  if (!e || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
  return true;
}

/** 当前 base 下全部键位提示：[[midi, label], …]（喂给 renderKeyboard.setKeyHints） */
export function hintsFor(base) {
  return Object.keys(KEY_SEMITONES).map((code) => [keyToMidi(code, base), keyLabel(code)]);
}

/**
 * 挂接电脑键盘弹奏。onKey(midi) 走与琴键点击完全相同的路径（回声/下落/发声）；
 * onOctave(base) 在 Z/X 换挡时回调（调用方更新键位提示与读数）。
 * enabled()（可选）：本界面是否处于激活视图——两个界面各自挂接且监听器常驻 window，
 * 不检查视图的话，开过一次工作室后实时页的每次按键都会双触发（双发声/八度互踩，轮次 68 修复）。
 * target 可注入（默认 globalThis）；返回的 handle 供测试直调，detach 供界面卸载。
 */
export function attachKeyboard({ onKey, onOctave, enabled = null }, { base = 60, target = globalThis } = {}) {
  let b = clampBase(base);
  const handle = (e) => {
    if (enabled && !enabled()) return;
    if (!shouldHandle(e)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      const next = clampBase(b + (e.code === 'KeyX' ? 12 : -12));
      if (next !== b) { b = next; onOctave?.(b); }
      return;
    }
    const midi = keyToMidi(e.code, b);
    if (midi != null) onKey(midi);
  };
  target.addEventListener?.('keydown', handle);
  return {
    handle,
    detach: () => target.removeEventListener?.('keydown', handle),
    getBase: () => b,
    setBase: (v) => { b = clampBase(v); },
  };
}
