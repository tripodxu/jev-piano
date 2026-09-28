// candidates.test.mjs — 候选集构造（ADR-0003 的发送侧）：循环锁死断路器、疲劳断路器、兜底不剔空。
// 这些纯函数决定了"模型能选什么"，因此这里锁住的是"不可选"的不变量，而不只是"可选"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLoop, chordCandidates, lhCandidates, rhythmCandidates, contourWeights, intensityTarget, commonTones, fifthsDist, functionCandidates } from '../public/js/candidates.js';
import { parseRoman, STYLE_BY_ID, HARMONIC_FUNCTIONS } from '../public/js/music.js';

const MINOR_PLAN = { mode: 'minor', meterNum: 4, barsPerPhrase: 8, density: 0.5, totalBars: 32, arc: 'arch' };

test('detectLoop: 按根音检测，members 为数字（防字符串 Set 回归）', () => {
  const r = detectLoop([0, 5, 7, 0, 5, 7]);
  assert.equal(r.locked, true);
  for (const m of r.members) assert.equal(typeof m, 'number', 'members 必须是数字');
  assert.ok(r.members.has(0) && r.members.has(5) && r.members.has(7));
  assert.equal(detectLoop([0, 5, 7, 3]).locked, false, '不足窗口不锁');
  assert.equal(detectLoop([0, 5, 7, 3, 8, 10]).locked, false, '根音丰富不锁');
});

test('chordCandidates: 疲劳根音被剔除、替换和弦入场，且不会剔空', () => {
  const cands = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, [0, 5, 7, 0, 5, 7], { 0: 3, 5: 3, 7: 3 });
  for (const c of cands) assert.ok(![0, 5, 7].includes(c.rootPc), `疲劳根音 ${c.rootPc} 不应出现在候选`);
  assert.ok(cands.length >= 3, '剔除后仍有候选');
  // 疲劳衰减后重新可用。recentRoots 必须取"未锁死"的序列，否则断言的是锁死断路器而非疲劳衰减
  const open = [0, 3, 7, 5, 8, 10];
  const decayed = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, open, { 0: 0.5, 5: 0.4, 7: 0.3 });
  assert.ok(decayed.some((c) => c.rootPc === 0), '疲劳衰减后主和弦应回归候选');
  const tired = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, open, { 0: 3, 5: 3, 7: 3 });
  assert.ok(!tired.some((c) => c.rootPc === 0), '未衰减时主和弦应被剔除');
});

/* ---------------- 循环锁死断路器（本轮接线；此前 recentRoots 是死参数） ---------------- */

test('chordCandidates: 循环锁死时循环成员被剔除（无疲劳表也能断）', () => {
  // 疲劳表传空：证明起作用的是"循环锁死"这条机制，而不是疲劳的副作用
  const cands = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, [0, 3, 7, 0, 3, 7], {});
  for (const c of cands) assert.ok(![0, 3, 7].includes(c.rootPc), `循环根音 ${c.rootPc} 不应出现在候选`);
  assert.ok(cands.length >= 3, '剔除后仍有候选');
  assert.ok(cands.length > 0, '候选集不得为空');
});

test('chordCandidates: 替换和弦不能把被锁死的根音偷渡回来', () => {
  // currentSym='V'、poolNext='i' 时会生成副属；但副属的根音若已在循环成员里，必须一并剔除
  const cands = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'V', 3, false, null, [0, 3, 7, 0, 3, 7], {});
  for (const c of cands) assert.ok(![0, 3, 7].includes(c.rootPc), `副属偷渡了循环根音 ${c.rootPc}`);
});

test('chordCandidates: 未锁死时不误伤（根音丰富则原样保留）', () => {
  const cands = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, [0, 3, 7, 5, 8, 10], {});
  assert.ok(cands.some((c) => c.rootPc === 0), '根音丰富时不应误剔主和弦');
});

test('chordCandidates: 全池都在循环里时兜底不剔空（长曲保护）', () => {
  // waltz 大调只有 I/IV/V/vi 四个根音；把它们全部锁死时必须仍能给出候选
  for (const styleId of ['waltz', 'classical', 'pop', 'oriental', 'newage']) {
    const cands = chordCandidates(STYLE_BY_ID[styleId], { ...MINOR_PLAN, mode: STYLE_BY_ID[styleId].modes[0] }, 'I', 3, false, null, [0, 5, 7, 9, 0, 5], { 0: 9, 5: 9, 7: 9, 9: 9 });
    assert.ok(cands.length >= 3, `${styleId} 被剔空了（${cands.length}）`);
  }
});

/* ---------------- 色板扩充 + 声部进行权重 ---------------- */

test('chordCandidates: 候选来源是全调内色板（带调式性质），不再受 4 和弦进行池限制', () => {
  const cands = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, [], {});
  const syms = new Set(cands.map((c) => c.sym));
  const roots = new Set(cands.map((c) => c.rootPc));
  assert.ok(roots.size >= 4, `色板应给出多个根音，实际 ${[...roots]}`);
  assert.ok(cands.every((c) => HARMONIC_FUNCTIONS[c.fn]), '每个候选都应带合法功能标注');
  assert.ok(cands.some((c) => c.rootPc === 0), '主和弦应在候选内');
  // 小调色板独有的 iiø（池里只有 i/bVI/bIII/bVII/iv/V）
  assert.ok(syms.has('iiø'), `应出现小调 iiø，实际 ${[...syms]}`);
});

test('chordCandidates: 风格进行池的原有色彩不被色板挤掉（jazz 七和弦仍在）', () => {
  const cands = chordCandidates(STYLE_BY_ID.jazz, { ...MINOR_PLAN, mode: 'major' }, 'I', 3, false, null, [], {});
  assert.ok(cands.some((c) => c.sym === 'V7'), '爵士的 V7 不应被大三色板条目挤掉');
  assert.ok(cands.some((c) => c.sym === 'ii7'), '爵士的 ii7 不应被挤掉');
});

test('chordCandidates: 共同音多的和弦权重更高（声部进行优先于五度圈远距）', () => {
  // C 之后：IV(F A C) 与 C 共 1 音；viiø(B D F) 与 C 共 0 音且五度圈距离 3
  const cands = chordCandidates(STYLE_BY_ID.classical, { ...MINOR_PLAN, mode: 'major' }, 'I', 3, false, null, [], {});
  const w = (sym) => cands.find((c) => c.sym === sym)?.weight ?? -Infinity;
  assert.ok(w('IV') > w('viiø'), `IV(${w('IV')}) 应高于 viiø(${w('viiø')})`);
});

test('chordCandidates: 功能转移加分（属之后主和弦加分，主之后下属/属加分）', () => {
  const afterD = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'V', 4, false, null, [], {});
  const afterT = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 4, false, null, [], {});
  const w = (cands, pc) => cands.find((c) => c.rootPc === pc)?.weight ?? -Infinity;
  assert.ok(w(afterD, 0) > w(afterD, 5), `属之后主(${w(afterD, 0)}) 应高于下属(${w(afterD, 5)})`);
  assert.ok(w(afterT, 5) > w(afterT, 0), `主之后下属(${w(afterT, 5)}) 应高于主(${w(afterT, 0)})`);
});

/* ---------------- 其余候选构造 ---------------- */

test('lhCandidates: 连续同织体衰减，强度偏置方向正确', () => {
  const fresh = lhCandidates(STYLE_BY_ID.jazz, 1, null, 0);
  const repeated = lhCandidates(STYLE_BY_ID.jazz, 1, 'shell', 3);
  assert.ok(repeated.shell.w < fresh.shell.w, '连续同织体应衰减');
  const loud = lhCandidates(STYLE_BY_ID.jazz, 3, null, 0);
  const soft = lhCandidates(STYLE_BY_ID.jazz, 0, null, 0);
  assert.ok(loud.stride.w > soft.stride.w, '强拍偏好 stride');
  // pad 只在含 pad 织体的曲风里（新世纪），不能拿爵士风格断言
  const padLoud = lhCandidates(STYLE_BY_ID.newage, 3, null, 0);
  const padSoft = lhCandidates(STYLE_BY_ID.newage, 0, null, 0);
  assert.ok(padSoft.pad.w > padLoud.pad.w, '弱乐句偏好 pad');
  assert.ok(Object.keys(fresh).length === STYLE_BY_ID.jazz.lh.length, '候选覆盖该曲风全部织体');
});

test('rhythmCandidates: 取目标密度档附近的 3 个 + 动机重现项', () => {
  const sparse = rhythmCandidates({ meterNum: 4, density: 0 }, null, 0);
  const dense = rhythmCandidates({ meterNum: 4, density: 1 }, null, 0);
  assert.equal(Object.keys(sparse).length, 3, '无动机时 3 个候选');
  assert.equal(Math.max(...Object.values(sparse).map((v) => v.tier)), 0, 'density=0 取稀疏档');
  assert.equal(Math.max(...Object.values(dense).map((v) => v.tier)), 2, 'density=1 取密集档');
  const motif = { pattern: { on: [0, 4, 8], tier: 1 } };
  const withMotif = rhythmCandidates({ meterNum: 4, density: 0.5 }, motif, 1);
  assert.ok('motif' in withMotif, '有乐句位置时应给动机重现项');
  assert.ok(!('motif' in sparse), '第 0 小节（动机诞生中）不出现 motif');
});

test('contourWeights / intensityTarget: 乐句位置与弧线偏置生效且有界', () => {
  const plan = { arc: 'rise' };
  assert.ok(contourWeights(plan, 0).rise > contourWeights(plan, 0).fall, '乐句头偏上行');
  assert.ok(contourWeights(plan, 6).fall > contourWeights(plan, 6).rise, '乐句尾偏下行');
  assert.ok(contourWeights({ arc: 'rise' }, 0).rise > contourWeights({ arc: 'flat' }, 0).rise, 'rise 弧线上行加权');
  for (let p = 0; p <= 1.0001; p += 0.1) {
    for (const arc of ['flat', 'rise', 'arch', 'fall']) {
      const v = intensityTarget({ arc }, p, false);
      assert.ok(v >= 0 && v <= 3, `${arc} @${p.toFixed(1)} = ${v} 越界`);
    }
  }
  assert.ok(intensityTarget({ arc: 'arch' }, 0.5, false) > intensityTarget({ arc: 'arch' }, 0.5, true), '乐句尾应减强度');
});

/* ---------------- 声部进行打分与功能转移矩阵 ---------------- */

test('commonTones: 共音计数正确', () => {
  // C = {0,4,7}；Am = {9,0,4} → 交集 {0,4} = 2
  assert.equal(commonTones('', 0, 'm', 9), 2, 'C→Am 共 2 音');
  // C = {0,4,7}；G = {7,11,2} → 交集 {7} = 1
  assert.equal(commonTones('', 0, '', 7), 1, 'C→G 共 1 音');
  // C 与 F# 大三 {6,10,1} → 无交集
  assert.equal(commonTones('', 0, '', 6), 0, 'C→F# 无共音');
  assert.equal(commonTones('maj7', 0, 'm7', 9), 3, 'Cmaj7{0,4,7,11} ∩ Am7{9,0,4,7} = 3');
});

test('fifthsDist: 五度圈环形距离（0..6，对称）', () => {
  assert.equal(fifthsDist(0, 0), 0);
  assert.equal(fifthsDist(0, 7), 1, 'C→G 五度圈相邻');
  assert.equal(fifthsDist(0, 5), 1, 'C→F 五度圈相邻（反向）');
  assert.equal(fifthsDist(0, 1), 5, 'C# 在五度圈上顺时针 7 步 / 逆时针 5 步，取近者 5');
  assert.equal(fifthsDist(0, 2), 2, 'C→D 顺时针两步');
  assert.equal(fifthsDist(0, 1), fifthsDist(1, 0), '对称');
  for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
    const d = fifthsDist(a, b);
    assert.ok(d >= 0 && d <= 6 && Number.isInteger(d), `fifthsDist(${a},${b})=${d} 越界`);
  }
});

test('functionCandidates: 四功能齐备，D→T 与乐句尾→T 权重更高', () => {
  const c = functionCandidates({ arc: 'arch' }, 'D', true, 7);
  assert.deepEqual(Object.keys(c).sort(), ['D', 'S', 'T', 'Tp'], '四功能必须齐备');
  assert.ok(c.T.w > c.D.w, `乐句尾属功能应向主功能回落 (T=${c.T.w} D=${c.D.w})`);
  const mid = functionCandidates({ arc: 'arch' }, 'T', false, 3);
  assert.ok(mid.S.w > mid.T.w && mid.D.w > mid.T.w, '主功能之后应走向下属或属');
  // 乐句开头偏好主功能
  assert.ok(functionCandidates({ arc: 'arch' }, 'S', false, 0).T.w > functionCandidates({ arc: 'arch' }, 'S', false, 4).T.w, '乐句头偏好主功能');
});
