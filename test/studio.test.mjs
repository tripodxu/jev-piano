// studio.test.mjs — 工作室的确定性编辑变换与项目校验（纯函数，Node 可测）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keywordAction, densifyHand, sparserHand, transposeNotes, scaleVel,
  chordAt, applyAction, validatePiece, savePiece,
} from '../public/js/studio.js';

function mkPiece() {
  return {
    version: 1, totalBars: 4, nid: 100,
    plan: { keyPc: 0, melodyScale: 'minor', meterNum: 4, mode: 'minor' },
    barChords: [
      { startBeat: 0, symbol: 'Cm', rootPc: 0, shape: 'm' },
      { startBeat: 4, symbol: 'G', rootPc: 7, shape: '' },
    ],
    notes: [
      { id: 1, midi: 48, startBeats: 0, durBeats: 2, vel: 0.5, hand: 'L' },
      { id: 5, midi: 55, startBeats: 4, durBeats: 1, vel: 0.5, hand: 'L' },
      { id: 2, midi: 60, startBeats: 4.5, durBeats: 1, vel: 0.7, hand: 'L' },
      { id: 3, midi: 72, startBeats: 0, durBeats: 1, vel: 0.8, hand: 'R' },
      { id: 4, midi: 75, startBeats: 2, durBeats: 1, vel: 0.8, hand: 'R' },
    ],
  };
}

test('keywordAction: 自然语言 → 编辑命令', () => {
  assert.equal(keywordAction('下一句左手更密集'), 'lh_busier');
  assert.equal(keywordAction('左手简一点'), 'lh_sparser');
  assert.equal(keywordAction('旋律稀疏一些'), 'rh_sparser');
  assert.equal(keywordAction('结尾渐弱'), 'soften');
  assert.equal(keywordAction('整体亮一些'), 'brighten');
  assert.equal(keywordAction('升高一点'), 'transpose_up');
  assert.equal(keywordAction('降低一点'), 'transpose_down');
  assert.equal(keywordAction('随便看看'), 'none');
});

test('chordAt: 找到当前拍所在小节的和弦', () => {
  const bc = mkPiece().barChords;
  assert.equal(chordAt(bc, 0).symbol, 'Cm');
  assert.equal(chordAt(bc, 3.9).symbol, 'Cm');
  assert.equal(chordAt(bc, 5).symbol, 'G');
  assert.equal(chordAt(bc, -1), null);
});

test('densifyHand: 有缝插缝，无缝则八度加厚', () => {
  const p = mkPiece();
  const added = densifyHand(p, 'L');
  assert.ok(added >= 1, '至少插一个音');
  const inserted = p.notes[p.notes.length - 1];
  assert.equal(inserted.hand, 'L');
  assert.ok(Math.abs((inserted.startBeats * 4) % 1) < 1e-9, `startBeats=${inserted.startBeats} 应落在 16 分格`);
  assert.ok([0, 3, 7].includes(((inserted.midi % 12) + 12) % 12), `midi=${inserted.midi} 应为 Cm 和弦音`);

  // 第二阶段：织体已密（全部 0.5 拍间隙）时用八度加厚
  const dense = {
    version: 1, totalBars: 2, nid: 10,
    plan: { keyPc: 0, melodyScale: 'major', meterNum: 4 },
    barChords: [{ startBeat: 0, symbol: 'C', rootPc: 0, shape: '' }],
    notes: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, midi: 48, startBeats: i * 0.5, durBeats: 0.5, vel: 0.5, hand: 'L' })),
  };
  const doubled = densifyHand(dense, 'L');
  assert.ok(doubled > 0, '无缝隙时应走八度加厚');
  assert.ok(dense.notes.some((n) => n.midi === 60), '应出现高八度 C');
});

test('sparserHand: 删弱位，但每小节至少保留一个音', () => {
  const p = mkPiece();
  const before = p.notes.length;
  const removed = sparserHand(p, 'L');
  assert.ok(removed >= 1, '应删掉至少一个弱位音');
  assert.ok(p.notes.length < before);
  const bars = new Set(p.notes.filter((n) => n.hand === 'L').map((n) => Math.floor(n.startBeats / 4)));
  assert.ok(bars.has(0), 'bar0 不应被清空');
  assert.ok(bars.has(1), 'bar1 不应被清空');
});

test('transposeNotes: 全体移位、吸附调内、不出界', () => {
  const p = mkPiece();
  const before = p.notes.map((n) => n.midi);
  transposeNotes(p, null, 1);
  p.notes.forEach((n, i) => {
    assert.ok(n.midi >= 36 && n.midi <= 95, `midi ${n.midi} 出界`);
    assert.ok(n.midi !== before[i] || before[i] === 95, '应发生移位（除非撞到上限）');
  });
});

test('scaleVel: 力度缩放有边界', () => {
  const p = mkPiece();
  scaleVel(p, null, 3);
  for (const n of p.notes) assert.ok(n.vel <= 1 && n.vel >= 0.15);
});

test('applyAction: 分发到对应变换', () => {
  const p = mkPiece();
  const before = p.notes.length;
  assert.ok(applyAction(p, 'lh_busier') > 0, 'lh_busier 应插入音符');
  assert.ok(p.notes.length > before);
  assert.equal(applyAction(p, 'none'), 0);
});

test('validatePiece: 版本/结构/音符字段校验', () => {
  const good = validatePiece(JSON.parse(JSON.stringify({ ...mkPiece(), version: 1 })));
  assert.ok(good, '合法项目应通过');
  assert.equal(good.nid, 100, '已有 nid 应保留');
  const noNid = JSON.parse(JSON.stringify({ ...mkPiece(), version: 1 }));
  delete noNid.nid;
  assert.ok(validatePiece(noNid).nid >= 6, '缺 nid 时应从最大 id 续起');
  assert.equal(validatePiece({ version: 2 }), null);
  assert.equal(validatePiece(null), null);
  const bad = { ...JSON.parse(JSON.stringify({ ...mkPiece(), version: 1 })), notes: [{ midi: 'x', startBeats: 0 }] };
  assert.equal(validatePiece(bad), null);
});

test('savePiece: 存储可用时写入并返回 true；不可用时返回 false 不抛错', () => {
  const ok = { setItem(k, v) { this.k = k; this.v = v; } };
  assert.equal(savePiece({ version: 1, notes: [] }, ok), true);
  assert.equal(ok.k, 'jevpiano.studio.v1');
  assert.equal(JSON.parse(ok.v).version, 1);
  const boom = { setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(savePiece({ version: 1, notes: [] }, boom), false);
});
