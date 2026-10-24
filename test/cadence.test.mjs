// cadence.test.mjs — 终止式识别（轮次 55）：Kostka-Payne 判据的纯函数锁。
// 判据三要素：功能归因（fn）、根音运动（d）、乐句位置（乐句末才算终止式）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceAt, cadenceIntoBar, pieceCadences, CADENCE_ZH } from '../public/js/cadence.js';

test('cadenceAt: 完全终止 = D→T 且根音下行五度（V→I / V7→i / 其它调）', () => {
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D' }, { rootPc: 0, fn: 'T' }), 'authentic');
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D', shape: '7' }, { rootPc: 0, fn: 'T' }), 'authentic', 'V7 同判');
  assert.equal(cadenceAt({ rootPc: 2, fn: 'D' }, { rootPc: 7, fn: 'T' }), 'authentic', 'D 大调的 A→D 同样成立');
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D' }, { rootPc: 7, fn: 'T' }), null, '功能对了根音没走（V→V）不算');
  assert.equal(cadenceAt({ rootPc: 2, fn: 'D' }, { rootPc: 0, fn: 'T' }), null, 'ii→I 功能对但根音不走五度，不判');
});

test('cadenceAt: 变格终止 S→T 上行四度；阻碍终止 D→Tp 下行三度', () => {
  assert.equal(cadenceAt({ rootPc: 5, fn: 'S' }, { rootPc: 0, fn: 'T' }), 'plagal');
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D' }, { rootPc: 9, fn: 'Tp' }), 'deceptive', '大调 V→vi');
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D' }, { rootPc: 8, fn: 'Tp' }), 'deceptive', '小调 V→VI');
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D' }, { rootPc: 4, fn: 'Tp' }), null, 'Tp 但根音不走三度，不判');
});

test('cadenceAt: 同功能对置 / 反向进行 / 脏输入都是 null', () => {
  assert.equal(cadenceAt({ rootPc: 0, fn: 'T' }, { rootPc: 5, fn: 'S' }), null);
  assert.equal(cadenceAt({ rootPc: 0, fn: 'T' }, { rootPc: 0, fn: 'T' }), null);
  assert.equal(cadenceAt({ rootPc: 7, fn: 'D' }, { rootPc: 2, fn: 'S' }), null);
  assert.equal(cadenceAt(null, { rootPc: 0, fn: 'T' }), null);
  assert.equal(cadenceAt({ rootPc: NaN, fn: 'D' }, { rootPc: 0, fn: 'T' }), null);
  assert.equal(cadenceAt({ fn: 'D' }, { rootPc: 0, fn: 'T' }), null, '缺 rootPc 降级为 null');
});

test('cadenceIntoBar: 只在乐句末判读；半终止 = 乐句收在属上；乐句长缺失按 4 退化', () => {
  const bc = [
    { rootPc: 0, fn: 'T' }, { rootPc: 5, fn: 'S' }, { rootPc: 7, fn: 'D' }, { rootPc: 0, fn: 'T' },
    { rootPc: 0, fn: 'T' }, { rootPc: 2, fn: 'S' }, { rootPc: 7, fn: 'D' }, { rootPc: 7, fn: 'D' },
  ];
  assert.equal(cadenceIntoBar(bc, 4, 4, 3), 'authentic', '第 4 小节 V→I 完全终止');
  assert.equal(cadenceIntoBar(bc, 4, 4, 7), 'half', '第 8 小节乐句收在属上 = 半终止');
  assert.equal(cadenceIntoBar(bc, 4, 4, 2), null, '乐句中段不判');
  assert.equal(cadenceIntoBar(bc, 4, 4, 0), null, '第 1 小节不在乐句末');
  assert.equal(cadenceIntoBar(bc, 4, undefined, 3), 'authentic', 'barsPerPhrase 缺失按 4 退化');
  assert.equal(cadenceIntoBar(bc, 4, 8, 3), null, '8 小节乐句里第 4 小节不是句末');
  assert.equal(cadenceIntoBar(null, 4, 4, 3), null);
  assert.equal(cadenceIntoBar(bc, 4, 4, -1), null);
  assert.equal(cadenceIntoBar(bc, 4, 4, 8), null, '越界');
  assert.equal(cadenceIntoBar(bc, 4, 4, 1.5), null, '非整数小节号');
});

test('pieceCadences: 整曲扫描只含乐句末；四种终止都可达且都有中文名', () => {
  const bc = [
    { rootPc: 0, fn: 'T' }, { rootPc: 0, fn: 'T' }, { rootPc: 5, fn: 'S' }, { rootPc: 0, fn: 'T' },
    { rootPc: 7, fn: 'D' }, { rootPc: 0, fn: 'T' }, { rootPc: 7, fn: 'D' }, { rootPc: 9, fn: 'Tp' },
  ];
  assert.deepEqual(pieceCadences(bc, 4, 4), [
    { bar: 3, type: 'plagal' },    // IV→I
    { bar: 7, type: 'deceptive' }, // V→vi
  ]);
  assert.deepEqual(pieceCadences(null, 4, 4), []);
  assert.deepEqual(pieceCadences([], 4, 4), []);
  const auth = [{ rootPc: 0, fn: 'T' }, { rootPc: 5, fn: 'S' }, { rootPc: 7, fn: 'D' }, { rootPc: 0, fn: 'T' }];
  assert.deepEqual(pieceCadences(auth, 4, 4), [{ bar: 3, type: 'authentic' }]);
  const half = [{ rootPc: 0, fn: 'T' }, { rootPc: 0, fn: 'T' }, { rootPc: 5, fn: 'S' }, { rootPc: 7, fn: 'D' }];
  assert.deepEqual(pieceCadences(half, 4, 4), [{ bar: 3, type: 'half' }]);
  for (const t of ['authentic', 'plagal', 'deceptive', 'half']) {
    assert.ok(CADENCE_ZH[t], `${t} 必须有中文名`);
  }
});
