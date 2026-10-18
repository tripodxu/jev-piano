// ui.test.mjs — 可视化层的纯逻辑：和声功能轨的类名/文案映射、段落标注、决策日志的安全渲染。
// DOM 相关行为靠浏览器冒烟；这里锁住的是"不可注入/不可错标/不依赖颜色"的不变量。
// canvas 三件套（Fall/TensionGraph/MotifCard）用假 canvas + 假 ResizeObserver 测：
// 只锁两条与画面无关、与耗电有关的契约——draw 不逐帧读布局、静止画布不自我重绘。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnLabel, fnSegClass, RIBBON_MAX, sectionLabel, sectionMarkerAt, planLine, motifShape, DEVELOP_ZH, LEGEND_ITEMS, renderLegend, planTempoLine, hoverBarAt, uniquenessLine, stageLightFor, probabilityStrip, chorusSummary, chorusView, styleChipTitle, goalTitle, decisionGuards, CHANNEL_LABEL, emptyLedger, accumulateLedger, ledgerPills, Fall, TensionGraph, MotifCard, MOTIF_PULSE_MS, pulseActive } from '../public/js/ui.js';
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
  for (const kw of ['主', '下属', '属', '色彩', '承', '模', '倒', '装', '断路', '驳回', '复读', '超预算', '段落', '动机', '张力', '契合', '非和弦', '问句', '答句']) {
    assert.ok(text.includes(kw), `图例缺少「${kw}」的说明`);
  }
});

test('decisionGuards: 四类归因标记（超预算是新的一类，且与图例同源）', () => {
  assert.deepEqual(decisionGuards(null), [], '脏输入降级为空');
  assert.deepEqual(decisionGuards(undefined), []);
  assert.deepEqual(decisionGuards('x'), []);
  assert.deepEqual(decisionGuards({}), [], '没有归因字段时一个标记都不产出');
  assert.equal(decisionGuards({ loopLocked: true })[0].label, '断路');
  assert.equal(decisionGuards({ rejected: true })[0].label, '驳回');
  assert.equal(decisionGuards({ farRepeat: true })[0].label, '复读');
  assert.equal(decisionGuards({ lhFarRepeat: true })[0].label, '复读');
  // 超预算：轮次 48 的诚实账本——渠道跟不上时主动顶替，必须与"渠道坏了"分开说
  const slow = decisionGuards({ deadlineMiss: true })[0];
  assert.equal(slow.label, '超预算');
  assert.equal(slow.cls, 'slow', '超预算用弱化配色（设计在起作用，不是故障）');
  assert.ok(slow.title.includes('下一小节重试'), 'title 要说清会自动重试');
  // 可叠加：断路 + 超预算同时成立时两个标记都要在
  assert.deepEqual(decisionGuards({ loopLocked: true, deadlineMiss: true }).map((g) => g.label), ['断路', '超预算']);
  // 与图例同源：每一个真实标记都要能在图例里找到（标记改了图例没改，比没图例更糟）
  const legend = LEGEND_ITEMS.map((i) => i.label).join(' ');
  for (const g of decisionGuards({ loopLocked: true, rejected: true, farRepeat: true, deadlineMiss: true })) {
    assert.ok(legend.includes(g.label), `图例缺少标记「${g.label}」的说明`);
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

/* ---------------- 曲终读数与遍次小结（轮次 37 · 前端） ---------------- */

test('chorusSummary: 遍次汇总一行纯文本；脏输入降级', () => {
  assert.equal(chorusSummary(1, 32, 9, 32, 31, 0.0026), '第 1 遍完 · 32 小节 · 和弦 9 种 · 旋律唯一 32/32 · $0.0026');
  assert.equal(chorusSummary(2, 16, 7, 16, 16, 0), '第 2 遍完 · 16 小节 · 和弦 7 种 · 旋律唯一 16/16 · $0.0000');
  assert.equal(chorusSummary(NaN, 32, 9, 32, 31, 0.0026), '', '遍次非法 → 空串');
  assert.equal(chorusSummary(1, 0, 9, 32, 31, 0.0026), '', '小节数非法 → 空串');
});

/* ---------------- 双遍张力对照（轮次 42 · 创意） ---------------- */

test('chorusView: 按 totalBars 分遍——past 是已完成遍，current 是进行中遍', () => {
  const actual = Array.from({ length: 40 }, (_, i) => i / 40);
  const v = chorusView(actual, 32);
  assert.equal(v.past.length, 32);
  assert.equal(v.current.length, 8);
  assert.equal(v.base, 32, '当前遍在 actual 里的起点');
  assert.equal(v.total, 32, 'x 轴分母 = 遍长');
  // 第一遍进行中（未超过一遍）→ past 为空
  const early = chorusView(actual.slice(0, 10), 32);
  assert.equal(early.past.length, 0);
  assert.equal(early.current.length, 10);
  assert.equal(early.base, 0);
});

test('chorusView: 脏输入降级（无 totalBars / 空序列）', () => {
  const v = chorusView([0.1, 0.2], 0);
  assert.equal(v.past.length, 0);
  assert.equal(v.current.length, 2);
  assert.equal(v.total, 0, '0 = 未启用分遍（调用方回退旧行为）');
  assert.deepEqual(chorusView([], 32), { past: [], current: [], base: 0, total: 32 });
});

/* ---------------- 选择控件的信息前置（轮次 44 · 前端） ---------------- */

test('styleChipTitle: 曲风描述 + BPM 区间一行可读；未知风格空串', () => {
  const t = styleChipTitle({ name: '爵士 · 摇摆', desc: 'ii-V-I，七九和弦', bpm: [88, 132] });
  assert.ok(t.includes('ii-V-I'), '含领域描述');
  assert.ok(t.includes('88-132 BPM'), '含速度区间');
  assert.equal(styleChipTitle(null), '');
  assert.equal(styleChipTitle({ name: 'x' }), '', '无 desc 不输出');
});

test('goalTitle: 目标的实际偏置透明化；无偏置说明随机', () => {
  assert.equal(goalTitle({ arc: 'rise', brightness: 0.15 }), '影响：弧线 rise · 亮度 +0.15');
  assert.equal(goalTitle({ arc: 'flat', density: -0.15 }), '影响：弧线 flat · 密度 −0.15');
  assert.equal(goalTitle({}), '每次随机生成，不偏置任何参数');
  assert.equal(goalTitle(undefined), '每次随机生成，不偏置任何参数');
});

/* ---------------- 计费台账（轮次 50）：工作室此前完全不记账 ---------------- */

test('CHANNEL_LABEL: 四渠道都有中文名（实时/工作室共用同一份，不许各写各的）', () => {
  assert.equal(CHANNEL_LABEL.fixture, '离线随机');
  assert.equal(CHANNEL_LABEL.proxy, '同源代理');
  assert.equal(CHANNEL_LABEL.typesafe, 'TypeSafe');
  assert.equal(CHANNEL_LABEL.openrouter, 'OpenRouter');
});

test('emptyLedger: 四个字段从 0 起（不是 undefined，避免 NaN 传染）', () => {
  const l = emptyLedger();
  assert.deepEqual(l, { tokens: 0, usd: 0, latencySum: 0, latencyN: 0 });
});

test('accumulateLedger: 累加真实渠道的 tokens/费用/延迟', () => {
  let l = emptyLedger();
  l = accumulateLedger(l, { fixture: false, inputTokens: 1860, usd: 0.000078, ms: 461 });
  assert.equal(l.tokens, 1860);
  assert.ok(Math.abs(l.usd - 0.000078) < 1e-12);
  assert.equal(l.latencyN, 1);
  assert.equal(l.latencySum, 461);

  l = accumulateLedger(l, { fixture: false, inputTokens: 1900, usd: 0.00008, ms: 539 });
  assert.equal(l.tokens, 3760, '累加而非覆盖');
  assert.equal(l.latencyN, 2);
  assert.equal(l.latencySum, 1000);
});

test('accumulateLedger: fixture 决策不记账（离线随机无网络请求、无费用）', () => {
  let l = emptyLedger();
  l = accumulateLedger(l, { fixture: true, inputTokens: 999, usd: 1, ms: 500 });
  assert.deepEqual(l, emptyLedger(), 'fixture 一律不计');
  // 混合：真实的计、fixture 的不计
  l = accumulateLedger(l, { fixture: false, inputTokens: 100, usd: 0.001, ms: 200 });
  l = accumulateLedger(l, { fixture: true, inputTokens: 999, usd: 9, ms: 900 });
  assert.equal(l.tokens, 100);
  assert.equal(l.latencyN, 1);
});

test('accumulateLedger: 脏输入不污染台账（不产生 NaN）', () => {
  let l = emptyLedger();
  l = accumulateLedger(l, null);
  l = accumulateLedger(l, undefined);
  l = accumulateLedger(l, {});
  l = accumulateLedger(l, { fixture: false, inputTokens: NaN, usd: NaN, ms: NaN });
  l = accumulateLedger(l, { fixture: false, inputTokens: 'x', usd: 'y', ms: 'z' });
  for (const [k, v] of Object.entries(l)) assert.ok(Number.isFinite(v), `${k} 必须是有限数，实际 ${v}`);
  assert.equal(l.tokens, 0);
  assert.equal(l.latencyN, 0, '无效 ms 不占延迟样本');
});

test('accumulateLedger: ms<=0 不计入延迟样本（但 tokens/费用照记）', () => {
  const l = accumulateLedger(emptyLedger(), { fixture: false, inputTokens: 50, usd: 0.0001, ms: 0 });
  assert.equal(l.tokens, 50);
  assert.equal(l.latencyN, 0, '0ms 不是有效延迟样本');
  assert.equal(l.latencySum, 0);
});

test('ledgerPills: 台账 → 三个 pill 的文案（0 样本时延迟显示 — ms）', () => {
  const empty = ledgerPills(emptyLedger());
  assert.equal(empty.tokens, '0 tok');
  assert.equal(empty.cost, '$0.000000');
  assert.equal(empty.latency, null, '无样本 → null，由 setStatus 渲染成 — ms');

  const l = accumulateLedger(accumulateLedger(emptyLedger(),
    { fixture: false, inputTokens: 1860, usd: 0.000078, ms: 461 }),
    { fixture: false, inputTokens: 1900, usd: 0.00008, ms: 539 });
  const p = ledgerPills(l);
  assert.equal(p.tokens, '3,760 tok', '千分位');
  assert.equal(p.cost, '$0.000158');
  assert.equal(p.latency, 500, '平均而非求和');
});

test('ledgerPills: 脏台账不产出 NaN 文案', () => {
  const p = ledgerPills(undefined);
  assert.equal(p.tokens, '0 tok');
  assert.equal(p.cost, '$0.000000');
  assert.equal(p.latency, null);
  const q = ledgerPills({ tokens: NaN, usd: NaN, latencySum: 0, latencyN: 0 });
  assert.ok(!String(q.tokens).includes('NaN'), '不能把 NaN 渲染给用户');
  assert.ok(!String(q.cost).includes('NaN'));
});

// 轮次 50 的真实事故：ledgerPills 返回字符串，而 setStatus 仍对它调 .toFixed()，
// 浏览器报 `cost.toFixed is not a function`。下面这条把两者的**组合**也测上——
// 只测各自的输出、不测它们对接，正是上面那个 bug 溜过去的原因。
test('setStatus 必须能吃下 ledgerPills 的输出（一次集成断言，防格式化重复）', async () => {
  const { setStatus } = await import('../public/js/ui.js');
  const mk = () => ({ channel: {}, tokens: {}, cost: {}, latency: {} });
  const p = ledgerPills(accumulateLedger(emptyLedger(),
    { fixture: false, inputTokens: 7490, usd: 0.000315, ms: 461 }));

  const pills = mk();
  assert.doesNotThrow(() => setStatus(pills, { channel: 'TypeSafe', tokens: p.tokens, cost: p.cost, latency: p.latency }),
    'ledgerPills 的输出必须能直接喂给 setStatus（曾因重复格式化而崩）');
  assert.equal(pills.tokens.textContent, '7,490 tok');
  assert.equal(pills.cost.textContent, '$0.000315');
  assert.equal(pills.latency.textContent, '461 ms');

  // 数值形态仍然可用（旧调用点兼容）
  const num = mk();
  setStatus(num, { channel: 'x', tokens: 1000, cost: 0.5, latency: 200 });
  assert.equal(num.tokens.textContent, '1,000 tok');
  assert.equal(num.cost.textContent, '$0.500000');
  assert.equal(num.latency.textContent, '200 ms');

  // null / undefined 延迟 → — ms（不是 NaN ms）
  const nil = mk();
  setStatus(nil, { channel: 'x', tokens: '0 tok', cost: '$0.000000', latency: null });
  assert.equal(nil.latency.textContent, '— ms');
});

/* ---------------- canvas 渲染契约：尺寸缓存 + 按需重绘 ---------------- */

/** 假 2D 上下文：任何方法都是 no-op；clearRect 单独计数，用来证明"该画的时候确实画了"。 */
function fakeCtx() {
  const calls = { clearRect: 0 };
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (k in t) return t[k];
      return () => { if (k in calls) calls[k]++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

/** 假 canvas：clientWidth/clientHeight 记读次数——「布局读取次数」就是这次优化的验收指标。 */
function fakeCanvas(w = 320, h = 90) {
  const m = { reads: 0 };
  const ctx = fakeCtx();
  const canvas = {
    width: 0, height: 0,
    get clientWidth() { m.reads++; return w; },
    get clientHeight() { m.reads++; return h; },
    getContext: () => ctx,
    addEventListener() {}, removeEventListener() {},
  };
  return { canvas, ctx, m };
}

/** Node 里没有 ResizeObserver；三个类只在构造时 observe，空壳足够。 */
function withDom(fn) {
  const real = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
  try { return fn(); } finally {
    if (real) globalThis.ResizeObserver = real; else delete globalThis.ResizeObserver;
  }
}

/** 在整个同步执行期间接管 setTimeout：返回排队数与手动 flush（时钟由调用方推进）。 */
function withFakeTimers(fn) {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const q = new Map();
  let id = 1;
  globalThis.setTimeout = (f) => { const i = id++; q.set(i, f); return i; };
  globalThis.clearTimeout = (i) => { q.delete(i); };
  try {
    return fn({
      pending: () => q.size,
      flush() { const fs = [...q.values()]; q.clear(); for (const f of fs) f(); },
    });
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
}

test('pulseActive: 强调窗口是有限时长，到点即失效', () => {
  assert.equal(pulseActive(null, 1000), false, '没有强调时永远不是 fresh');
  assert.equal(pulseActive(1000, 1000), true);
  assert.equal(pulseActive(1000, 1899), true);
  assert.equal(pulseActive(1000, 1900), false, '900ms 一到就回到常态描边');
  assert.equal(MOTIF_PULSE_MS, 900);
});

test('TensionGraph: 静止画面不再起常驻定时器，但变更仍会重绘', () => withDom(() => {
  const { canvas, ctx } = fakeCanvas();
  const tg = new TensionGraph(canvas);
  const realSet = globalThis.setInterval;
  let scheduled = 0;
  globalThis.setInterval = () => { scheduled++; return { fake: scheduled }; };
  try { tg.start(); } finally { globalThis.setInterval = realSet; }
  assert.equal(scheduled, 0, '张力带只在数据变化时变，start() 不该 8fps 自我重绘');
  assert.equal(tg.timer, null);

  const before = ctx.__calls.clearRect;
  tg.push(0.4);
  assert.ok(ctx.__calls.clearRect > before, 'push() 仍然要立刻重绘');
  tg.setSections([{ start: 0, bars: 8, name: 'A' }]);
  assert.ok(ctx.__calls.clearRect > before + 1, 'setSections() 仍然要立刻重绘');
}));

test('三块 canvas 的 draw 不再逐帧读布局（尺寸由 ResizeObserver 缓存）', () => withDom(() => {
  const a = fakeCanvas(), b = fakeCanvas(), c = fakeCanvas();
  const fall = new Fall(a.canvas, () => 0);
  const tg = new TensionGraph(b.canvas);
  const mc = new MotifCard(c.canvas, { now: () => 0 });
  const base = [a.m.reads, b.m.reads, c.m.reads];
  fall.push({ midi: 60, t: 1, dur: 0.5, vel: 0.8, hand: 'R' });
  mc.setMotif([60, 64, 67]);
  for (let i = 0; i < 20; i++) { fall.draw(); tg.draw(); mc.draw(); }
  assert.deepEqual([a.m.reads, b.m.reads, c.m.reads], base,
    'draw 里读 clientWidth 会让浏览器每帧强制同步布局');
}));

test('MotifCard: 强调只在窗口内自排程重绘，窗口一关就停手', () => withDom(() => withFakeTimers((timers) => {
  let now = 5000;
  const { canvas } = fakeCanvas();
  const mc = new MotifCard(canvas, { now: () => now });
  mc.setMotif([60, 62, 64]);
  mc.start();
  assert.equal(timers.pending(), 0, '没有强调时机卡是静止的，不该有任何后台排程');

  mc.markRestatement();
  assert.equal(mc.restatements, 1);
  assert.equal(timers.pending(), 1, '强调窗口内才有一次重绘排程');
  now += 120; timers.flush();
  assert.equal(timers.pending(), 1, '窗口内继续自排程');
  now += 1000; timers.flush();
  assert.equal(timers.pending(), 0, '窗口一关闭立刻停手');
  assert.equal(mc.pulseAt, null, 'pulseAt 归 null = 描边已回到常态');
})));

test('MotifCard.stop(): 停播时清掉在途的强调排程', () => withDom(() => withFakeTimers((timers) => {
  const { canvas } = fakeCanvas();
  const mc = new MotifCard(canvas, { now: () => 0 });
  mc.setMotif([60, 62]);
  mc.start();
  mc.markRestatement();
  assert.equal(timers.pending(), 1);
  mc.stop();
  assert.equal(timers.pending(), 0, 'stop() 必须清定时器，否则停播后还在画');
})));

