// ui.test.mjs — 可视化层的纯逻辑：和声功能轨的类名/文案映射、段落标注、决策日志的安全渲染。
// DOM 相关行为靠浏览器冒烟；这里锁住的是"不可注入/不可错标/不依赖颜色"的不变量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnLabel, fnSegClass, RIBBON_MAX, sectionLabel, sectionMarkerAt, planLine, motifShape, DEVELOP_ZH, LEGEND_ITEMS, renderLegend, planTempoLine, hoverBarAt, uniquenessLine, stageLightFor, probabilityStrip, chorusSummary, chorusView, styleChipTitle, goalTitle, fifthPos, compassPoints, compassRadius, compassStep, compassStepZh, compassStatLine, drawCompassCard, CompassCard, decisionGuards, COMPASS_PAD } from '../public/js/ui.js';
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
  for (const kw of ['主', '下属', '属', '色彩', '承', '模', '倒', '装', '断路', '驳回', '复读', '超预算', '罗盘', '段落', '动机', '张力', '契合', '非和弦', '问句', '答句']) {
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

/* ---------------- 和声罗盘（轮次 45 · 创意） ---------------- */

test('fifthPos: 五度圈映射 rootPc → 0..1 顺时针位置（C 在顶点，G 相邻）', () => {
  assert.equal(fifthPos(0), 0, 'C 在顶点');
  assert.ok(Math.abs(fifthPos(7) - 1 / 12) < 1e-9, 'G 是 C 的顺时针邻位（+1 步 = 相差五度 = 声部最近）');
  assert.ok(Math.abs(fifthPos(5) - 11 / 12) < 1e-9, 'F 是逆时针邻位（−1 步）');
  assert.ok(Math.abs(fifthPos(6) - 6 / 12) < 1e-9, '三全音对角（最远的声部进行）');
  assert.ok(Math.abs(fifthPos(12) - 0) < 1e-9, '越界取模');
  assert.ok(Number.isFinite(fifthPos(NaN)), '脏输入不抛错');
});

test('compassPoints: 归一化坐标在圆环上、顺序保持、脏 pc 过滤', () => {
  const pts = compassPoints([0, 7, 5]);
  assert.equal(pts.length, 3);
  for (const p of pts) {
    const d = Math.hypot(p.x - 0.5, p.y - 0.5);
    assert.ok(Math.abs(d - 0.42) < 1e-9, `点到圆心距离恒为半径 0.42，实际 ${d}`);
  }
  assert.deepEqual(compassPoints([0, 7])[0], compassPoints([0])[0], '同 pc 同位置（顺序无关）');
  assert.equal(compassPoints([]).length, 0);
  assert.equal(compassPoints([3, NaN, 8]).length, 2, '脏 pc 过滤');
});

/* ---------------- 和声罗盘补完（轮次 49 · 前端）：可见性判据与生命周期 ---------------- */

test('compassRadius: 半径随盒子缩放，且 ≥48px 才算「可读」（轮次 45 的失败是画小了）', () => {
  // 轮次 45 的实际盒子：96×48 → 半径 ~12px，12 个刻度与轨迹挤成一团，这就是当时的阻塞项
  assert.ok(compassRadius(96, 48) < 20, '旧尺寸确实不可读（<20px）——这是被修掉的那个数');
  // 补完后的盒子：≥120px 高、宽度充足
  assert.ok(compassRadius(240, 132) >= 48, `240×132 的盒子半径应 ≥48，实际 ${compassRadius(240, 132)}`);
  assert.ok(compassRadius(120, 120) >= 48, '120×120 也应达线');
  // 取短边：宽度很大但高度不足时，半径仍由高度决定
  assert.equal(compassRadius(1000, 120), compassRadius(120, 120), '半径由短边决定（宽高各留 12px 刻度位）');
  assert.equal(compassRadius(240, 132), Math.min(240, 132) / 2 - COMPASS_PAD);
  // 脏输入降级为 0 而不是 NaN（绘制端据此提前返回，不抛错）
  assert.equal(compassRadius(0, 100), 0);
  assert.equal(compassRadius(NaN, 100), 0);
  assert.equal(compassRadius(undefined, undefined), 0);
});

test('compassStep: 五度圈步数取「顺时针步」且值域 0..6（同音最近、三全音最远）', () => {
  assert.equal(compassStep(0, 0), 0, '同一个根音 = 同音');
  assert.equal(compassStep(0, 7), 1, 'C→G 是顺时针一步（相差五度 = 声部最近）');
  assert.equal(compassStep(0, 5), 1, 'C→F 逆时针一步，取较短的 1 而不是 11');
  assert.equal(compassStep(0, 6), 6, '三全音 = 圈上对角，最远的声部进行');
  for (let a = 0; a < 12; a++) {
    for (let b = 0; b < 12; b++) {
      const s = compassStep(a, b);
      assert.ok(s >= 0 && s <= 6, `步数必须落在 0..6，实际 ${s}（${a}→${b}）`);
      assert.equal(s, compassStep(b, a), '步数对称');
    }
  }
});

test('compassStepZh: 步数→文字（罗盘的形状因此也能被读到，不依赖看图）', () => {
  assert.equal(compassStepZh(0), '同音');
  assert.equal(compassStepZh(1), '五度邻位');
  assert.equal(compassStepZh(6), '远跳');
  assert.equal(compassStepZh(NaN), '', '脏输入空串而不是「同音」——不能替数据编结论');
});

test('compassStatLine: 无轨迹给引导语，有轨迹给「第 N 小节 · 和弦 · 功能 · 进行」', () => {
  assert.equal(compassStatLine({ count: 0 }), '第 2 小节后出现根音轨迹');
  assert.equal(compassStatLine({}), '第 2 小节后出现根音轨迹');
  assert.equal(compassStatLine(), '第 2 小节后出现根音轨迹');
  // 单小节：还没有「进行」可言，不说距离
  assert.equal(compassStatLine({ count: 1, symbol: 'Cm', fn: 'T' }), '第 1 小节 · Cm · 主功能');
  assert.equal(compassStatLine({ count: 3, symbol: 'G', fn: 'D', step: 1 }), '第 3 小节 · G · 属功能 · 五度邻位');
  assert.equal(compassStatLine({ count: 8, symbol: 'F', fn: 'S', step: 6 }), '第 8 小节 · F · 下属功能 · 远跳');
  // 缺字段如实省略，不编内容
  assert.equal(compassStatLine({ count: 2, step: 1 }), '第 2 小节 · 五度邻位');
  assert.equal(compassStatLine({ count: 2, symbol: 'Cm', fn: '乱写', step: 0 }), '第 2 小节 · Cm · 同音');
  assert.equal(compassStatLine({ count: -5 }), '第 2 小节后出现根音轨迹', '负数视为无轨迹');
});

test('drawCompassCard: 给定 ctx 就能画（工作室复用同一实现），无尺寸时安静返回不抛错', () => {
  const calls = [];
  const g = new Proxy({}, {
    get: (_, k) => (...args) => { calls.push([k, args]); },
    set: () => true,
  });
  drawCompassCard(g, { w: 200, h: 160, roots: [0, 7, 5], fnColor: { T: '#1', S: '#2', D: '#3', Tp: '#4' } });
  assert.ok(calls.length > 0, '有尺寸与数据时应产生绘制调用');
  assert.ok(calls.some(([k]) => k === 'arc'), '应画圆点');
  assert.ok(calls.some(([k, a]) => k === 'fillText' && a.length >= 3), '应画 12 个音名刻度');

  // 以下三种都不该抛错，且都不产生新的绘制调用
  const before = calls.length;
  drawCompassCard(g, { w: 0, h: 160, roots: [0] });    // 无宽度 → 提前返回
  drawCompassCard(g, { w: 200, h: 0, roots: [0] });    // 无高度 → 提前返回
  drawCompassCard(null, { w: 200, h: 160 });           // 无 ctx → 提前返回
  assert.equal(calls.length, before, '无尺寸/无 ctx 时不得绘制');
});

test('CompassCard: push/reset/max 截断/读数 生命周期（mock canvas，无需真实 DOM）', () => {
  const canvas = { clientWidth: 240, clientHeight: 132, width: 0, height: 0,
    getContext: () => ({ clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, setTransform() {} }),
    setAttribute() {} };
  const readout = { textContent: '', setAttribute() {} };
  const c = new CompassCard(canvas, { readout, max: 3, fnColor: { T: '#1', S: '#2', D: '#3', Tp: '#4' } });

  assert.equal(c.status(), '第 2 小节后出现根音轨迹', '空状态是引导语');

  c.push({ rootPc: 0, symbol: 'Cm' }, 'T');
  assert.equal(c.entries.length, 1);
  assert.equal(c.status(), '第 1 小节 · Cm · 主功能', '单小节不给「进行」');
  assert.equal(readout.textContent, '第 1 小节 · Cm · 主功能', '读数节点被同步（文字通道）');

  c.push({ rootPc: 7, symbol: 'G' }, 'D');
  assert.equal(c.status(), '第 2 小节 · G · 属功能 · 五度邻位', 'C→G 是五度邻位');

  c.push({ rootPc: 6, symbol: 'F#' }, 'Tp');
  assert.equal(c.status(), '第 3 小节 · F# · 色彩功能 · 远跳', 'G→F# 圈上对角 = 远跳');

  c.push({ rootPc: 3, symbol: 'Eb' }, 'S');   // 超过 max=3 → 最早的 Cm 被挤掉
  assert.equal(c.entries.length, 3, 'max 截断生效');
  assert.equal(c.entries[0].rootPc, 7, '挤掉的是最早那条');

  c.push({ rootPc: NaN }, 'T');               // 脏输入不进入轨迹
  assert.equal(c.entries.length, 3, '脏 pc 不占位');

  c.reset();
  assert.equal(c.entries.length, 0);
  assert.equal(c.status(), '第 2 小节后出现根音轨迹', 'reset 回到引导语');
  assert.equal(readout.textContent, '第 2 小节后出现根音轨迹');

  // 兼容旧调用形态：直接给一个 pc 数字（不带和弦对象）
  c.push(5);
  assert.equal(c.entries.length, 1);
  assert.equal(c.status(), '第 1 小节', '无和弦名/功能时如实省略，不编内容');
  c.destroy();
});

test('图例：罗盘条目 swatch 非空（轮次 45 欠的账——标记没色块比没有图例更糟）', () => {
  const it = LEGEND_ITEMS.find((i) => i.label === '罗盘');
  assert.ok(it, '图例必须有罗盘条目');
  assert.ok(it.swatch && it.swatch.trim(), `罗盘 swatch 不能为空，实际 ${JSON.stringify(it.swatch)}`);
  assert.ok(it.desc.includes('五度圈'), '说明要点出五度圈');
  const html = renderLegend(LEGEND_ITEMS);
  assert.ok(html.includes('lg-sw compass'), '渲染出罗盘的色块类');
  assert.ok(!html.includes('lg-sw lg-blank"></i><b>罗盘'), '罗盘不该走空色块分支');
});

/* ---------------- 模块完整性（轮次 49 · 真实回归） ---------------- */

test('FN_COLOR: 功能色的单一真相源——与 studio-core.js 逐键等值（跨文件同名常量不许漂移）', async () => {
  // 轮次 49 的真事故：我在 ui.js 里直接引用 FN_COLOR 却忘了引入，
  // 让罗盘的绘制路径一加载就 `ReferenceError`（真实浏览器报错，Node 单测当时测不到）。
  // 这个断言同时守住两件事：ui.js 有这个导出，且与 studio-core.js 的值一致。
  const { FN_COLOR } = await import('../public/js/ui.js');
  const { FN_COLOR: CORE } = await import('../public/js/studio-core.js');
  assert.deepEqual(Object.keys(FN_COLOR).sort(), ['D', 'S', 'T', 'Tp'], '四功能齐全');
  for (const k of Object.keys(FN_COLOR)) {
    assert.equal(FN_COLOR[k], CORE[k], `FN_COLOR.${k} 必须与 studio-core.js 一致（两份调色板不许漂移）`);
  }
});

test('drawCompassCard 的 fnColor 缺省值生效：不传 fnColor 时也不抛错（默认走 FN_COLOR）', async () => {
  // 上面那条 ReferenceError 的直接守卫：把 ui.js 作为一个**模块**加载并真正调用绘制路径。
  const { drawCompassCard } = await import('../public/js/ui.js');
  const calls = [];
  const g = new Proxy({}, { get: () => (...a) => calls.push(a), set: () => true });
  assert.doesNotThrow(() => drawCompassCard(g, { w: 200, h: 160, roots: [0, 7, 5] }), '不传 fnColor 必须能画');
  assert.ok(calls.length > 0);
});

test('compassStatLine: hideCount 抑制行内小节数（避免「整曲 16 小节 · 第 16 小节」重复）', () => {
  assert.equal(compassStatLine({ count: 5, symbol: 'Cm', fn: 'T', step: 1, hideCount: true }), 'Cm · 主功能 · 五度邻位');
  // 抑制后如果什么都不剩，仍要给出小节数，不能返回空串
  assert.equal(compassStatLine({ count: 3, hideCount: true }), '第 3 小节');
  // 默认行为不变
  assert.equal(compassStatLine({ count: 5, symbol: 'Cm', fn: 'T' }), '第 5 小节 · Cm · 主功能');
});
