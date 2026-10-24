// studio-roll.test.mjs — 卷帘视图（轮次 54 拆出的 studio-roll.js）的接线契约：
// 工厂接口形状、空曲/有曲两条绘制路径、指针编辑经 deps 落账（pushUndo/onCommit）。
// 视觉效果仍靠人工冒烟；这里锁的是「拆分后接线不断」——轮次 49 的教训：
// 搬走的符号如果没有任何测试走过那条路径，它就是无声的死代码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRollView } from '../public/js/studio-roll.js';
import { ZOOM } from '../public/js/studio-core.js';

/** 假 2D 上下文：任何方法 no-op；fillText 单独记录文本——用来证明"该画的确实画了"。 */
function fakeCtx() {
  const calls = { fillText: [] };
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (k in t) return t[k];
      return (...a) => { if (k === 'fillText') calls.fillText.push(String(a[0])); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

/** 假 canvas：记录监听器、可手动派发事件；getBoundingClientRect 原点在 (0,0)，坐标换算可控。 */
function fakeCanvas() {
  const ctx = fakeCtx();
  const listeners = new Map();
  return {
    ctx, style: {}, width: 0, height: 0,
    texts: () => ctx.__calls.fillText,
    getContext: () => ctx,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatch(type, ev) { for (const fn of listeners.get(type) ?? []) fn(ev); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 4000, height: 900 }),
    setPointerCapture() {},
  };
}

/** Node 里没有 window；绘制路径读 devicePixelRatio。 */
function withWindow(fn) {
  const real = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try { return fn(); } finally {
    if (real) globalThis.window = real; else delete globalThis.window;
  }
}

function mkPiece() {
  return {
    version: 1, totalBars: 4, nid: 100,
    plan: { keyPc: 0, meterNum: 4, mode: 'minor', bpm: 96, barsPerPhrase: 4 },
    barChords: [
      { startBeat: 0, symbol: 'Cm', rootPc: 0, shape: 'm', fn: 'T', intensity: 1 },
      { startBeat: 4, symbol: 'G7', rootPc: 7, shape: '7', fn: 'D', intensity: 2 },
    ],
    notes: [
      { id: 1, midi: 48, startBeats: 0, durBeats: 2, vel: 0.5, hand: 'L' },
      { id: 2, midi: 55, startBeats: 4, durBeats: 1, vel: 0.5, hand: 'L' },
      { id: 3, midi: 72, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' },
    ],
  };
}

/** 组一套视图 + 记账 deps；piece 由调用方持有（对应 studio.js 的单一真相源，可整体替换） */
function mkView(piece) {
  const calls = { pushUndo: 0, onCommit: 0 };
  const roll = fakeCanvas(), vel = fakeCanvas();
  const view = createRollView({
    els: { roll, vel, bpm: { value: 96 } },
    getPiece: () => piece,
    playing: () => false,
    pushUndo: (snap) => { calls.pushUndo++; calls.snap = snap; },
    onCommit: () => { calls.onCommit++; },
    muted: { R: false, L: false },
  });
  return { view, roll, vel, calls };
}

test('createRollView：接口形状——bind/bindVel/draw/drawVel/invalidate 都是函数', () => {
  withWindow(() => {
    const { view } = mkView(null);
    for (const k of ['bind', 'bindVel', 'draw', 'drawVel', 'invalidate']) {
      assert.equal(typeof view[k], 'function', `${k} 必须是函数`);
    }
  });
});

test('draw/drawVel：无曲画占位文案；有曲画和弦名，invalidate 后重画走全路径不炸', () => {
  withWindow(() => {
    const empty = mkView(null);
    empty.view.draw(); empty.view.drawVel();
    assert.ok(empty.roll.texts().some((t) => t.includes('生成编曲')), '空卷帘应有引导文案');
    assert.ok(empty.vel.texts().some((t) => t.includes('力度轨')), '空力度轨应有引导文案');

    const { view, roll } = mkView(mkPiece());
    view.draw(); view.drawVel();
    assert.ok(roll.texts().some((t) => t === 'Cm') && roll.texts().some((t) => t === 'G7'), '和弦名应画在头部');
    view.invalidate(); // 作废张力/非和声音缓存后重画 = pieceTension/nonChordIds 重新计算
    view.draw();
    assert.ok(roll.texts().some((t) => t === 'Cm'));
  });
});

test('卷帘指针编辑：空白处按下建音 → 抬起经 deps 落账（undo 快照是编辑前的音符表）', () => {
  withWindow(() => {
    const piece = mkPiece();
    const { view, roll, calls } = mkView(piece);
    view.bind();
    const before = piece.notes.length;
    // rollPos 换算：pitch = P_HI − (clientY − HEADER)/ROW；clientY=350 → pitch 60（≥60 归右手）
    roll.dispatch('pointerdown', { clientX: 12, clientY: 350, pointerId: 1 });
    assert.equal(piece.notes.length, before + 1, '空白处按下应新建音符');
    const added = piece.notes[piece.notes.length - 1];
    assert.equal(added.midi, 60);
    assert.equal(added.hand, 'R', 'pitch ≥ 60 归右手');
    assert.equal(added.startBeats, 0, 'beat 0.5 再退半拍吸附到 0');
    roll.dispatch('pointerup', {});
    assert.equal(calls.pushUndo, 1, '编辑提交应压一次撤销');
    assert.equal(JSON.parse(calls.snap).length, before, 'undo 快照是编辑前的音符表');
    assert.equal(calls.onCommit, 1, '编辑提交应触发一次收尾（自动保存/信息行/按钮态）');
  });
});

test('hover 读数与力度轨拖动：hover 画出逐小节读数，力度改动经 deps 落账', () => {
  withWindow(() => {
    const piece = mkPiece();
    const { view, roll, vel, calls } = mkView(piece);
    view.bind(); view.bindVel();
    // hover：beat 2（clientX = 2×ZOOM）落在第 1 小节 → 重画 + 读数行
    roll.dispatch('pointermove', { clientX: 2 * ZOOM, clientY: 100 });
    assert.ok(roll.texts().some((t) => t.startsWith('第 1 小节')), `hover 读数应画出，实际 ${JSON.stringify(roll.texts())}`);
    roll.dispatch('pointerleave', {});
    // 力度轨：beat 0 命中 id=1（两音同拍取先画的）；先按在 0.5，再拖到 0.8 让快照真的变化
    vel.dispatch('pointerdown', { clientX: 0, clientY: 27, pointerId: 1 });
    vel.dispatch('pointermove', { clientX: 0, clientY: 10.8 });
    assert.ok(Math.abs(piece.notes[0].vel - 0.8) < 1e-9, `拖动应改力度，实际 ${piece.notes[0].vel}`);
    vel.dispatch('pointerup', {});
    assert.equal(calls.pushUndo, 1, '力度编辑应压撤销');
    assert.equal(calls.onCommit, 1);
  });
});
