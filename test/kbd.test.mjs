// kbd.test.mjs — 电脑键盘弹奏（轮次 65）：键位映射、事件守卫、八度落点、挂接全路径。
// 键位用 e.code（物理键位，与输入法/布局无关）——测试也全部按 code 构造事件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_SEMITONES, keyLabel, keyToMidi, clampBase, OCTAVE_BASES,
  shouldHandle, hintsFor, attachKeyboard,
} from '../public/js/kbd.js';
import { LOW, HIGH } from '../public/js/canvas.js';

const ev = (code, over = {}) => ({ code, target: { tagName: 'BODY' }, ...over });

test('keyToMidi: A 行白键 + 上行黑键 + ; 跨三半音；未映射/脏输入 null', () => {
  assert.equal(keyToMidi('KeyA', 60), 60, 'A = C4');
  assert.equal(keyToMidi('KeyW', 60), 61, 'W = C#4');
  assert.equal(keyToMidi('KeyG', 60), 67, 'G = G4');
  assert.equal(keyToMidi('KeyK', 60), 72, 'K = C5（跨八度）');
  assert.equal(keyToMidi('Semicolon', 60), 76, '; = E5');
  assert.equal(keyToMidi('KeyQ', 60), null, '未映射键不弹');
  assert.equal(keyToMidi('KeyA', NaN), null);
  // 全部键位在任何合法 base 下都落在键盘音域内（与 ui 键盘/Fall 同一真相源 LOW..HIGH）
  for (const base of OCTAVE_BASES) {
    for (const code of Object.keys(KEY_SEMITONES)) {
      const m = keyToMidi(code, base);
      assert.ok(m >= LOW && m <= HIGH, `${code}@${base} → ${m} 越界`);
    }
  }
});

test('keyLabel: KeyA→A、Semicolon→;（琴键上的提示字母）', () => {
  assert.equal(keyLabel('KeyA'), 'A');
  assert.equal(keyLabel('Semicolon'), ';');
  assert.equal(keyLabel('KeyP'), 'P');
});

test('clampBase: 只落在 C 上——36/48/60 三个可达八度位，越界取最近', () => {
  assert.deepEqual(OCTAVE_BASES, [36, 48, 60], 'C2/C3/C4（60+16=76 ≤ 84；72 会让 ; 顶到 88）');
  assert.equal(clampBase(60), 60);
  assert.equal(clampBase(72), 60, '超出最高八度回落到 60');
  assert.equal(clampBase(24), 36, '低于最低八度抬到 36');
  assert.equal(clampBase(43), 48, '取最近的 C');
  assert.equal(clampBase(NaN), 60, '脏输入给默认');
});

test('hintsFor: 当前 base 的全部键位提示都在键盘音域内', () => {
  const hints = hintsFor(60);
  assert.ok(hints.some(([m, l]) => m === 60 && l === 'A'));
  assert.ok(hints.some(([m, l]) => m === 76 && l === ';'));
  assert.equal(hints.length, Object.keys(KEY_SEMITONES).length);
  for (const [m] of hints) assert.ok(m >= LOW && m <= HIGH);
});

test('shouldHandle: 重触/组合键/表单焦点不弹——ctrl+z 是撤销不是音符', () => {
  assert.equal(shouldHandle(ev('KeyA')), true);
  assert.equal(shouldHandle(ev('KeyA', { repeat: true })), false, '按住重触会机关枪，忽略');
  assert.equal(shouldHandle(ev('KeyA', { ctrlKey: true })), false);
  assert.equal(shouldHandle(ev('KeyA', { metaKey: true })), false);
  assert.equal(shouldHandle(ev('KeyA', { altKey: true })), false);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(shouldHandle(ev('KeyA', { target: { tagName } })), false, `${tagName} 里是打字`);
  }
  assert.equal(shouldHandle(ev('KeyA', { target: { tagName: 'DIV', isContentEditable: true } })), false);
  assert.equal(shouldHandle(null), false);
});

test('attachKeyboard: 弹奏/换八度/守卫全路径（handler 直调，不伪造 window）', () => {
  const notes = [];
  const octaves = [];
  const kbd = attachKeyboard({ onKey: (m) => notes.push(m), onOctave: (b) => octaves.push(b) });
  kbd.handle(ev('KeyA'));            // 60
  kbd.handle(ev('KeyS'));            // 62
  kbd.handle(ev('Semicolon'));       // 76
  assert.deepEqual(notes, [60, 62, 76]);
  kbd.handle(ev('KeyZ'));            // 60 → 48
  kbd.handle(ev('KeyA'));
  assert.equal(notes.at(-1), 48, '换八度后 A 键落在 C3');
  kbd.handle(ev('KeyZ'));            // 48 → 36
  kbd.handle(ev('KeyZ'));            // 36 已是最低：不变、不回调
  kbd.handle(ev('KeyX'));            // 36 → 48
  kbd.handle(ev('KeyX'));            // 48 → 60
  kbd.handle(ev('KeyX'));            // 60 已是最高：不变
  assert.deepEqual(octaves, [48, 36, 48, 60], '只在真的换挡时回调');
  // 守卫在 handler 内部生效：输入框里的 A 不弹、ctrl+A 不弹
  const before = notes.length;
  kbd.handle(ev('KeyA', { target: { tagName: 'INPUT' } }));
  kbd.handle(ev('KeyA', { ctrlKey: true }));
  assert.equal(notes.length, before);
  // Z/X 在输入框里也不换八度（同一守卫）
  const octBefore = octaves.length;
  kbd.handle(ev('KeyX', { target: { tagName: 'INPUT' } }));
  assert.equal(octaves.length, octBefore);
  assert.equal(kbd.getBase(), 60);
  kbd.detach();
});

test('attachKeyboard: 挂到可注入的 target 上，detach 后解绑', () => {
  const listeners = new Map();
  const target = {
    addEventListener: (t, f) => listeners.set(t, f),
    removeEventListener: (t) => listeners.delete(t),
  };
  const notes = [];
  const kbd = attachKeyboard({ onKey: (m) => notes.push(m) }, { base: 48, target });
  assert.ok(listeners.has('keydown'), '应挂 keydown');
  listeners.get('keydown')(ev('KeyA'));
  assert.deepEqual(notes, [48], '注入的 base 生效');
  kbd.detach();
  assert.ok(!listeners.has('keydown'), 'detach 后解绑');
});
