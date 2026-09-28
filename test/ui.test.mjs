// ui.test.mjs — 可视化层的纯逻辑：和声功能轨的类名/文案映射、决策日志的安全渲染。
// DOM 相关行为靠浏览器冒烟；这里锁住的是"不可注入/不可错标"的不变量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnLabel, fnSegClass, RIBBON_MAX } from '../public/js/ui.js';

const bar = (over = {}) => ({
  index: 3,
  label: 'A4',
  chord: { symbol: 'Am' },
  decision: { chordFn: 'T', loopLocked: false, rejected: false, ...over },
});

test('fnLabel: 四功能有中文名，未知值原样返回（不丢信息）', () => {
  assert.equal(fnLabel('T'), '主');
  assert.equal(fnLabel('S'), '下属');
  assert.equal(fnLabel('D'), '属');
  assert.equal(fnLabel('Tp'), '色彩');
  assert.equal(fnLabel('X'), 'X');
  assert.equal(fnLabel(undefined), '');
});

test('fnSegClass: 功能色类 + 断路器/驳回标记', () => {
  assert.equal(fnSegClass(bar()), 'fnseg fn-T');
  assert.equal(fnSegClass(bar({ chordFn: 'S' })), 'fnseg fn-S');
  assert.equal(fnSegClass(bar({ chordFn: 'D' })), 'fnseg fn-D');
  assert.equal(fnSegClass(bar({ chordFn: 'Tp' })), 'fnseg fn-Tp');
  assert.equal(fnSegClass(bar({ loopLocked: true })), 'fnseg fn-T lock');
  assert.equal(fnSegClass(bar({ rejected: true })), 'fnseg fn-T rej');
  assert.equal(fnSegClass(bar({ loopLocked: true, rejected: true })), 'fnseg fn-T lock rej');
});

test('fnSegClass: 非法/缺失功能一律降级为主功能，绝不产出无色的空类', () => {
  for (const chordFn of [null, undefined, 'X', '', 0]) {
    const cls = fnSegClass(bar({ chordFn }));
    assert.ok(cls.includes('fn-T'), `chordFn=${JSON.stringify(chordFn)} 未降级: ${cls}`);
    assert.ok(cls.split(' ').every((c) => /^[a-zA-Z-]+$/.test(c)), `类名含非法字符: ${cls}`);
  }
  assert.ok(fnSegClass({}).includes('fn-T'), '整个 decision 缺失时也不能崩');
});

test('RIBBON_MAX: 功能轨保留段数是合理的一屏容量', () => {
  assert.ok(Number.isInteger(RIBBON_MAX) && RIBBON_MAX >= 8 && RIBBON_MAX <= 32, `RIBBON_MAX=${RIBBON_MAX}`);
});
