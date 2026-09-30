// ui.test.mjs — 可视化层的纯逻辑：和声功能轨的类名/文案映射、段落标注、决策日志的安全渲染。
// DOM 相关行为靠浏览器冒烟；这里锁住的是"不可注入/不可错标/不依赖颜色"的不变量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnLabel, fnSegClass, RIBBON_MAX, sectionLabel, sectionMarkerAt, planLine, motifShape, DEVELOP_ZH, LEGEND_ITEMS, renderLegend, planTempoLine, hoverBarAt, uniquenessLine, stageLightFor, probabilityStrip } from '../public/js/ui.js';
import { deriveSections } from '../public/js/candidates.js';

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

test('fnSegClass: 乐句语气标记（问/答）挂类名，未标记不带类', () => {
  assert.ok(fnSegClass(bar({ phraseRole: 'question' })).includes('qa-q'), '问句尾应有 qa-q');
  assert.ok(fnSegClass(bar({ phraseRole: 'answer' })).includes('qa-a'), '答句尾应有 qa-a');
  assert.ok(!fnSegClass(bar()).includes('qa-'), '普通小节不带语气类');
  assert.ok(!fnSegClass(bar({ phraseRole: 'weird' })).includes('qa-'), '未知语气不产出类');
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

/* ---------------- 段落标注（不依赖颜色：必须有文字通道） ---------------- */

test('sectionLabel: 段落名；非法输入安全降级', () => {
  assert.equal(sectionLabel({ id: 'A', arc: 'flat', bars: 8 }), 'A');
  assert.equal(sectionLabel({ id: 'Coda', arc: 'fall', bars: 8 }), 'Coda');
  assert.equal(sectionLabel(null), '');
  assert.equal(sectionLabel({}), '');
  assert.equal(sectionLabel({ id: 123 }), '123', '数字 id 也要能显示，不能丢信息');
});

test('sectionMarkerAt: 只在段落首小节返回该段落，否则 null', () => {
  const secs = [{ id: 'A', start: 0, bars: 8 }, { id: 'B', start: 8, bars: 8 }];
  assert.equal(sectionMarkerAt(secs, 0)?.id, 'A');
  assert.equal(sectionMarkerAt(secs, 7), null, '段落内不是边界');
  assert.equal(sectionMarkerAt(secs, 8)?.id, 'B', '第二段落首小节');
  assert.equal(sectionMarkerAt(secs, 99), null, '越界不是边界');
  assert.equal(sectionMarkerAt(null, 0), null);
  assert.equal(sectionMarkerAt([], 0), null);
  assert.equal(sectionMarkerAt(undefined, 3), null);
});

test('planLine: 计划卡的段落清单是纯文本等价物（无颜色也能读懂曲式）', () => {
  const secs = [{ id: 'A', bars: 8 }, { id: 'B', bars: 8 }, { id: "A'", bars: 8 }, { id: 'Coda', bars: 4 }];
  const line = planLine(secs);
  assert.ok(line.includes('A') && line.includes('B') && line.includes('Coda'), `缺段落名: ${line}`);
  assert.ok(line.includes('8') && line.includes('4'), '缺段落长度');
  assert.ok(!line.includes('<'), '纯文本，不应含 HTML');
  assert.equal(planLine(null), '', '无段落时整行不输出');
  assert.equal(planLine([]), '');
});

/* ---------------- 动机地图（文字/形状通道，不依赖颜色） ---------------- */

test('motifShape: 音高序列归一化成可绘制轮廓（形状与音域大小无关）', () => {
  const s = motifShape([72, 74, 76, 72]);
  assert.equal(s.length, 4, '点数与音数一致');
  for (const p of s) {
    assert.ok(p.y >= 0 && p.y <= 1, `y=${p.y} 越界`);
    assert.ok(p.x >= 0 && p.x <= 1, `x=${p.x} 越界`);
  }
  // 整体移调不改变形状：同一动机换个八度仍是同一形状
  assert.deepEqual(motifShape([72, 74, 76, 72]), motifShape([60, 62, 64, 60]), '移调后形状应完全一致');
  // 同音反复（span=0）不能除零
  assert.deepEqual(motifShape([60, 60, 60]).map((p) => p.y), [0.5, 0.5, 0.5], '同音应落在中线');
  assert.deepEqual(motifShape([]), [], '空输入不崩');
  assert.deepEqual(motifShape(null), []);
  assert.deepEqual(motifShape([60]), [{ x: 0, y: 0.5 }], '单音落在中线');
  // 最高音在顶端（y 最小），这样画出来方向才对
  const up = motifShape([60, 72]);
  assert.ok(up[1].y < up[0].y, '音高上升应对应 y 减小');
});

test('DEVELOP_ZH: 五种发展手法都有标签（文字通道，不依赖颜色）', () => {
  for (const k of ['repeat', 'sequence', 'inversion', 'ornament', 'new']) {
    assert.ok(DEVELOP_ZH[k] !== undefined, `缺 ${k} 的标签`);
  }
  assert.equal(DEVELOP_ZH.repeat, '承', '承袭的标记是「承」');
  assert.equal(DEVELOP_ZH.new, '', '新句无标记（它是「没有承袭」）');
  assert.equal(Object.keys(DEVELOP_ZH).length, 5);
});

/* ---------------- 图例（impeccable/onboard：可选、可记忆、使用现场） ---------------- */

test('LEGEND_ITEMS: 每条都有名字与说明，且覆盖所有真实标记', () => {
  assert.ok(Array.isArray(LEGEND_ITEMS) && LEGEND_ITEMS.length >= 8, `条目太少：${LEGEND_ITEMS?.length}`);
  for (const it of LEGEND_ITEMS) {
    assert.ok(it.label && it.desc, `缺 label/desc：${JSON.stringify(it)}`);
    assert.ok(it.group, '每条要归组');
  }
  // 覆盖面：四功能 + 五手法 + 断路器 + 驳回 + 段落 + 动机 + 张力 + 契合度 + 非和弦
  const text = LEGEND_ITEMS.map((i) => `${i.label}${i.desc}`).join('');
  for (const kw of ['主', '下属', '属', '色彩', '承', '模', '倒', '装', '断路', '驳回', '复读', '段落', '动机', '张力', '契合', '非和弦', '问句', '答句']) {
    assert.ok(text.includes(kw), `图例缺少「${kw}」的说明`);
  }
});

test('LEGEND_ITEMS: 四个和声功能与五个发展手法都在图例里（与真实标记同源，不能脱节）', () => {
  const text = LEGEND_ITEMS.map((i) => i.label).join(' ');
  for (const id of ['T', 'S', 'D', 'Tp']) {
    assert.ok(text.includes(fnLabel(id)), `图例缺和声功能 ${id}（${fnLabel(id)}）`);
  }
  for (const d of ['承', '模', '倒', '装']) assert.ok(text.includes(d), `图例缺发展手法「${d}」`);
  // 「新句」在功能轨上没有标记（DEVELOP_ZH.new 是空串），图例里要说清楚它为什么没有标记
  assert.ok(LEGEND_ITEMS.some((i) => i.label === '新句'), '图例应解释「新句」为何无标记');
});

test('renderLegend: 输出可读结构，且不含未转义的注入面', () => {
  const out = renderLegend(LEGEND_ITEMS);
  assert.ok(out.includes('主'), '应含条目文字');
  assert.ok(!/<script/i.test(out), '不得含 script');
  const evil = renderLegend([{ group: 'x', label: '<b>hi</b>', desc: '<img onerror=1>' }]);
  assert.ok(!evil.includes('<img'), 'desc 里的标签必须被转义：' + evil);
  assert.equal(renderLegend([]), '', '空列表不产出内容');
  assert.equal(renderLegend(null), '');
});

/* ---------------- 时间维可见化（轮次 21 · 前端） ---------------- */

test('planTempoLine: 速度行带尾段渐慢的具体数字（文字通道，不靠画布）', () => {
  const plan = { bpm: 92, totalBars: 32, sections: deriveSections('arch', 32, 8) };
  assert.equal(planTempoLine(plan), '速度 92 BPM · 尾段渐慢至 74');
});

test('planTempoLine: 末小节乘数为 1 时只有速度', () => {
  const plan = {
    bpm: 90, totalBars: 2,
    sections: [
      { id: 'A', arc: 'flat', level: 1, swing: 0.3, bars: 1, start: 0 },
      { id: 'B', arc: 'flat', level: 1, swing: 0.3, bars: 1, start: 1 },
    ],
  };
  assert.equal(planTempoLine(plan), '速度 90 BPM');
});

test('planTempoLine: 脏输入降级为空串（整段不输出）', () => {
  assert.equal(planTempoLine(null), '');
  assert.equal(planTempoLine({ totalBars: 32 }), '');
  assert.equal(planTempoLine({ bpm: -5, totalBars: 32 }), '');
});

test('hoverBarAt: 命中/边缘/越界/空数据', () => {
  assert.equal(hoverBarAt(26, 326, 10), 0, '左缘 = 第 0 小节');
  assert.equal(hoverBarAt(320, 326, 10), 9, '右缘 = 最后一小节');
  const mid = hoverBarAt(176, 326, 10);
  assert.ok(mid >= 4 && mid <= 5, `中线附近: ${mid}`);
  assert.equal(hoverBarAt(10, 326, 10), -1, '绘图区外');
  assert.equal(hoverBarAt(100, 326, 0), -1, '没有小节');
  assert.equal(hoverBarAt(NaN, 326, 10), -1, '脏输入');
});

/* ---------------- 反重复成果可见化（轮次 27 · 前端） ---------------- */

test('uniquenessLine: 唯一性读数是纯文本；0 小节时不输出', () => {
  assert.equal(uniquenessLine(32, 31, 32), '旋律唯一 32/32 · 左手唯一 31/32');
  assert.equal(uniquenessLine(5, 5, 5), '旋律唯一 5/5 · 左手唯一 5/5');
  assert.equal(uniquenessLine(0, 0, 0), '');
  assert.equal(uniquenessLine(0, 0, -3), '');
  assert.equal(uniquenessLine(3, 2, NaN), '');
});

/* ---------------- 舞台灯光（轮次 31 · 创意） ---------------- */

test('stageLightFor: 张力升→暖光升冷光降（氛围不抢戏，上界 ≤0.21）', () => {
  const low = stageLightFor(0), high = stageLightFor(1);
  assert.ok(high.warm > low.warm, '暖光随张力单调升');
  assert.ok(high.cool < low.cool, '冷光随张力单调降');
  assert.ok(Math.abs(low.warm - 0.05) < 1e-9);
  assert.ok(Math.abs(high.warm - 0.21) < 1e-9);
  assert.ok(stageLightFor(0.5).warm <= 0.21 && stageLightFor(1).cool >= 0.05, '两层都保持克制的不透明度');
});

test('stageLightFor: 越界夹取、脏输入降级中性', () => {
  assert.equal(stageLightFor(-1).warm, stageLightFor(0).warm);
  assert.equal(stageLightFor(2).warm, stageLightFor(1).warm);
  const mid = stageLightFor(0.5);
  assert.deepEqual(stageLightFor(NaN), mid, 'NaN → 中性');
  assert.deepEqual(stageLightFor(undefined), mid);
  assert.deepEqual(stageLightFor('x'), mid);
});

/* ---------------- 决策概率可视化（轮次 33 · 创意） ---------------- */

test('probabilityStrip: 按概率降序取前三，选中项带标记，条宽是百分数', () => {
  const html = probabilityStrip({ i: 0.93, V: 0.01, 'iiø': 0.02, bVI: 0.02, bIII: 0.01, bVII: 0, iv: 0.01 }, 'i');
  assert.ok(html.includes('i'), '应含最高候选');
  assert.ok(html.indexOf('iiø') < html.indexOf('bVI'), '同概率按原序稳定');
  assert.ok(!html.includes('bIII'), '只取前三');
  assert.ok(html.includes('93%'), '百分比文本');
  assert.ok(html.includes('width:93%'), '条宽=百分数');
  assert.ok(html.includes('prob-pick'), '选中项有标记');
});

test('probabilityStrip: 脏输入降级为空串（整行不输出）；sym 一律转义', () => {
  assert.equal(probabilityStrip(null, 'i'), '');
  assert.equal(probabilityStrip({}, 'i'), '');
  assert.equal(probabilityStrip({ a: NaN }), '');
  const html = probabilityStrip({ '<img>': 0.5, b: 0.3 }, '<img>');
  assert.ok(!html.includes('<img>'), 'sym 必须转义');
  assert.ok(html.includes('&lt;img&gt;'));
});
