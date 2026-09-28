# 段落/曲式规划 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：让 `plan` 拥有**段落结构**（A–B–A'–Coda），强度目标按段落各自的弧线与基准值计算——把 README 远期路线图第 3 条（LLM 系统二规划曲式 / Jev 系统一选小节）落地。

**Architecture**：`candidates.js` 新增 `FORM_TEMPLATES` / `deriveSections(arc, bars)` / `sectionAt()`，`intensityTarget` 改为段落感知。`buildPlan` 产出 `plan.sections`（LLM 给就用 LLM 的，否则用模板派生）。`jev.js` 的 LLM 系统提示词增加 `sections` 字段，让**大模型承担系统二的曲式规划**。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖。

---

## 证据（动手前先量）

### ① 现状：张力曲线被噪声淹没，形式不可见

`scripts/tmp-form.mjs` 数张力曲线的显著峰（12 种子 × 32 小节）：**平均 2.42 峰，分布 `4 3 2 2 2 1 2 3 0 4 3 3`**，高度随机。形状（seed 2020）：

```
▇▇▇██▇▇███▇▇▇▆▆▆▆▇▇███▆▇▇▇▆▆▇▆▆▆
```

那些"峰"是织体造成的噪声尖刺，不是结构。一条 `fall` 弧线不该在第 4、8、15、23 小节各冒一个峰。

### ② 方案模拟：段落感知能造出结构

`scripts/tmp-sections.mjs` 对比两条目标曲线：

| 弧线 | 全局弧线 | 段落感知（A–B–A'–Coda） |
|---|---|---|
| arch | `▃▃▄▄▅▅▆▆▇▇█████▇███████▆▇▆▆▅▅▄▄▂` 单峰 | `▄▅▆▆▆▆▅▄│▆▆▆▇▇███▄▅▆│▇▇▆▅▄▄▃▃▃▃▃▂▂` 段落清晰 |
| rise | 单峰 | 4 个递升峰 A→B→A2→Climax |

段落边界的凹陷让 A–B–A'–Coda **变得看得见**。

## 段落模板

| 段落 | arc | level | swing | 音乐含义 |
|---|---|---|---|---|
| A | flat/arch | 1.4 | 0.3 | 陈述主题，克制 |
| B | arch/rise | 2.2 | 0.6 | 对比段，全曲张力峰值 |
| A' | flat/arch | 1.6 | 0.35 | 主题再现，更充实 |
| Coda | fall | 0.8 | 0.25 | 收束，退到安静 |

强度目标 = `section.level + (ARC[section.arc](local) − 1.3) × section.swing`，再扣乐句尾 0.5。

**段落数**：`totalBars >= 24 ? 4 : 2`（16 小节 → 2 段，32/64 → 4 段；每段长度是 `barsPerPhrase` 的整数倍，段落边界与乐句边界天然对齐）。

## LLM 侧（系统二）

`PLAN_SYS_PROMPT` 增加可选字段：
```
"sections":[{"id":"A","arc":"flat","level":1.4}, ...]   // 可选：2-5 个段落，按出现顺序
```
解析时校验（长度 2..5、`arc` 合法、`level` 落在 0..3），不合法则回退到 `deriveSections`。**LLM 不可用时（默认）走模板派生，功能不受影响。**

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/candidates.js` | Modify | `FORM_TEMPLATES` / `deriveSections` / `sectionAt` / 段落感知 `intensityTarget` |
| `public/js/composer.js` | Modify | `buildPlan` 产出 `plan.sections`（LLM 优先，模板兜底） |
| `public/js/jev.js` | Modify | `PLAN_SYS_PROMPT` 增加 `sections` 字段 |
| `test/candidates.test.mjs` | Modify | 段落派生与强度目标的测试 |
| `test/theory.test.mjs` | Modify | LLM sections 校验 |
| `AGENTS.md` / `MEMORY.md` / `README.md` | Modify | 同步 |

---

### Task 1: 段落派生（TDD）

- [ ] **Step 1: 写失败测试**（追加到 `test/candidates.test.mjs`）

```js
test('deriveSections: 段数与长度合理，边界与乐句对齐', () => {
  for (const bars of [16, 32, 64]) {
    const secs = deriveSections('arch', bars);
    assert.ok(secs.length === (bars >= 24 ? 4 : 2), `bars=${bars} 段数 ${secs.length}`);
    let cover = 0;
    for (const s of secs) {
      assert.ok(s.bars > 0 && s.level >= 0 && s.level <= 3, `bars=${bars} 段 ${s.id} 非法`);
      assert.ok(['flat', 'rise', 'arch', 'fall'].includes(s.arc), `非法 arc ${s.arc}`);
      cover += s.bars;
    }
    assert.equal(cover, bars, `段落长度之和应等于总小节数`);
    assert.equal(secs[0].start, 0);
    for (let i = 1; i < secs.length; i++) assert.equal(secs[i].start, secs[i - 1].start + secs[i - 1].bars, '段落必须首尾相接');
    // 段落边界必须落在乐句边界上（长度是 barsPerPhrase 的整数倍）
    for (const s of secs) assert.equal(s.bars % 8, 0, `段落长度 ${s.bars} 未对齐 8 小节乐句`);
  }
});

test('deriveSections: B 段是全曲张力峰值，Coda 最低（A–B–A''–Coda 的音乐逻辑）', () => {
  const secs = deriveSections('arch', 32);
  const peak = secs.reduce((a, b) => (b.level > a.level ? b : a));
  const low = secs.reduce((a, b) => (b.level < a.level ? b : a));
  assert.equal(peak.id, 'B', `峰值段应是 B，实际 ${peak.id}`);
  assert.equal(low.id, 'Coda', `最低段应是 Coda，实际 ${low.id}`);
  assert.ok(secs[0].id === 'A' && secs[2].id.startsWith('A'), 'A 与 A\' 应成对出现');
});

test('intensityTarget: 段落感知——同一弧线下的 B 段峰值高于 A 段', () => {
  const plan = { arc: 'arch', totalBars: 32, barsPerPhrase: 8, sections: deriveSections('arch', 32) };
  const at = (bar) => intensityTarget(plan, bar / 32, false);
  const aPeak = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map(at));
  const bPeak = Math.max(...[8, 9, 10, 11, 12, 13, 14, 15].map(at));
  const coda = Math.max(...[24, 25, 26, 27, 28, 29, 30, 31].map(at));
  assert.ok(bPeak > aPeak, `B 段峰值 ${bPeak.toFixed(2)} 应高于 A 段 ${aPeak.toFixed(2)}`);
  assert.ok(coda < aPeak, `Coda ${coda.toFixed(2)} 应低于 A 段`);
  for (let bar = 0; bar < 32; bar++) assert.ok(at(bar) >= 0 && at(bar) <= 3, `bar ${bar} 越界`);
});

test('sectionAt: 越界与非法输入安全降级', () => {
  const secs = deriveSections('arch', 32);
  assert.equal(sectionAt(secs, 0).id, 'A');
  assert.equal(sectionAt(secs, 31).id, 'Coda');
  assert.equal(sectionAt(secs, 99).id, 'Coda', '越界取末段');
  assert.equal(sectionAt([], 0), null);
  assert.equal(sectionAt(null, 0), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/candidates.test.mjs`
Expected: FAIL —— `deriveSections is not a function`。

- [ ] **Step 3: 实现**

`candidates.js` 中，把 `intensityTarget` 之前的 `ARC_CURVES` 保留，新增：

```js
/** 曲式模板：段落 id / 内部弧线 / 基准强度 / 内部起伏幅度。这是 A–B–A'–Coda 的经典四段式。
 *  level 决定该段"响到什么程度"，arc 决定该段"内部怎么走"，swing 是起伏的比例。 */
const FORM_TEMPLATES = {
  arch: [['A', 'flat', 1.4, 0.3], ['B', 'arch', 2.2, 0.6], ["A'", 'flat', 1.6, 0.35], ['Coda', 'fall', 0.8, 0.25]],
  rise: [['A', 'flat', 1.2, 0.25], ['B', 'rise', 1.9, 0.5], ["A'", 'rise', 2.1, 0.45], ['Climax', 'rise', 2.8, 0.3], ['Coda', 'fall', 0.9, 0.25]],
  fall: [['A', 'flat', 1.9, 0.35], ['B', 'fall', 1.5, 0.45], ["A'", 'fall', 1.1, 0.4], ['Coda', 'fall', 0.6, 0.2]],
  flat: [['A', 'flat', 1.4, 0.25], ['B', 'arch', 2.1, 0.55], ["A'", 'flat', 1.5, 0.3], ['Coda', 'flat', 1.0, 0.2]],
};

/** 段落数：短曲 2 段，正常长度 4 段；每段长度取 8 小节的整数倍，段落边界与乐句边界对齐 */
export function deriveSections(arc, totalBars, barsPerPhrase = 8) {
  const bars = Math.max(1, Math.round(Number(totalBars) || 32));
  const n = bars >= barsPerPhrase * 3 ? 4 : 2;
  const tpl = FORM_TEMPLATES[arc] ?? FORM_TEMPLATES.arch;
  // 模板比段数多时取前面的（rise 的 5 段模板在 4 段曲里丢掉 Climax）
  const picks = n === 4 && tpl.length > 4
    ? [tpl[0], tpl[1], tpl[2], tpl.at(-1)]
    : tpl.slice(0, n);
  const per = Math.floor(bars / picks.length);
  const out = [];
  for (let i = 0; i < picks.length; i++) {
    const [id, a, level, swing] = picks[i];
    const count = i === picks.length - 1 ? bars - per * (picks.length - 1) : per;
    if (count > 0) out.push({ id, arc: a, level, swing, bars: count, start: per * i });
  }
  return out;
}

/** 某小节属于哪个段落；越界取末段，非法输入返回 null */
export function sectionAt(sections, bar) {
  if (!Array.isArray(sections) || !sections.length) return null;
  const b = Number(bar) || 0;
  for (const s of sections) if (b >= s.start && b < s.start + s.bars) return s;
  return b < 0 ? sections[0] : sections.at(-1);
}
```

把 `intensityTarget` 换成段落感知版（签名不变，`progress` 换算成小节号）：

```js
/** 强度曲线值：段落感知——每段用自己的 arc 与基准值，段落内再走局部弧线。
 *  没有 sections 时退化为旧的全局弧线（旧项目 JSON / 单测兼容）。 */
export function intensityTarget(plan, progress, isPhraseEnd, barsPerPhrase = 8) {
  const total = Math.max(1, Number(plan?.totalBars) || 32);
  const bar = Math.min(total - 1, Math.max(0, Math.floor(progress * total)));
  const sec = sectionAt(plan?.sections, bar);
  let v;
  if (sec) {
    const local = sec.bars > 1 ? (bar - sec.start) / (sec.bars - 1) : 0;
    v = sec.level + ((ARC_CURVES[sec.arc] ?? ARC_CURVES.arch)(local) - 1.3) * sec.swing;
  } else {
    v = (ARC_CURVES[plan?.arc] ?? ARC_CURVES.arch)(progress);
  }
  return Math.min(3, Math.max(0, v - (isPhraseEnd ? 0.5 : 0)));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test` → Expected: 89 + 4 = **93** 全绿。

---

### Task 2: `buildPlan` 产出 `plan.sections`

- [ ] **Step 1: 实现**

`composer.js` 的 `buildPlan`，在 return 之前插入：

```js
    // 曲式（系统二）：LLM 给了就用它的，否则按弧线模板派生 A–B–A'–Coda
    const sections = sanitizeSections(raw?.sections, base.arc, barsPerPhraseGuess) ?? deriveSections(base.arc, totalBarsGuess);
```

更实际的写法（`raw` 只在 LLM 分支存在，故在两个分支后统一处理）——把现有 return 改为：

```js
  const totalBars = clamp(bars, 8, 128);
  const barsPerPhrase = 8;
  return {
    ...base,
    title: base.title || `${prompt.slice(0, 12) || '无名'} · 即兴`,
    prompt: String(prompt).slice(0, 200),
    goal, seed,
    keyPc: base.keyPc ?? 0,
    meterNum: meterNum || 4, meterDen: meterDen || 4,
    barsPerPhrase,
    totalBars,
    sections: sanitizeSections(llmSections, base.arc, totalBars) ?? deriveSections(base.arc, totalBars, barsPerPhrase),
    melodyScale: ...,
    styleName: st.name,
  };
```

其中 `llmSections` 来自 LLM 分支（`raw.sections`），非 LLM 路径为 `null`。`sanitizeSections` 为本地纯函数：

```js
/** 校验 LLM 给的段落：长度 2..5、arc 合法、level ∈ [0,3]、bars 为正整数且不超总长。任一不合格返回 null（回退模板） */
export function sanitizeSections(raw, arc, totalBars) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 5) return null;
  const out = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || !['flat', 'rise', 'arch', 'fall'].includes(s.arc)) return null;
    const level = Number(s.level);
    if (!Number.isFinite(level) || level < 0 || level > 3) return null;
    const n = Math.max(1, Math.min(totalBars - start, Math.round(Number(s.bars) || 0)));
    out.push({ id: String(s.id ?? i + 1).slice(0, 6), arc: s.arc, level, swing: Number.isFinite(Number(s.swing)) ? Number(s.swing) : 0.4, bars: n, start });
    start += n;
    if (start >= totalBars) break;
  }
  return out.length >= 2 ? out : null;
}
```

> LLM 不必给 `bars`——不合法时会被夹到剩余长度；这样提示词可以只要求 `id/arc/level`（`PLAN_SYS_PROMPT` 同步说明）。

- [ ] **Step 2: 加测试**（`test/theory.test.mjs`）

```js
test('sanitizeSections: LLM 段落校验严格，非法一律回退 null', async () => {
  const { sanitizeSections } = await import('../public/js/composer.js');
  assert.equal(sanitizeSections(null, 'arch', 32), null);
  assert.equal(sanitizeSections([{ arc: 'arch', level: 1.5 }], 'arch', 32), null, '只有 1 段');
  assert.equal(sanitizeSections([{ arc: '乱写', level: 1.5, bars: 16 }, { arc: 'flat', level: 1, bars: 16 }], 'arch', 32), null, '非法 arc');
  assert.equal(sanitizeSections([{ arc: 'arch', level: 9, bars: 16 }, { arc: 'flat', level: 1, bars: 16 }], 'arch', 32), null, 'level 越界');
  const ok = sanitizeSections([{ id: 'A', arc: 'flat', level: 1.2, bars: 16 }, { id: 'B', arc: 'rise', level: 2.4, bars: 16 }], 'arch', 32);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].start, 0);
  assert.equal(ok[1].start, 16, 'start 必须首尾相接');
});
```

- [ ] **Step 3: 运行确认通过** → 94 全绿。

---

### Task 3: LLM 提示词

- [ ] **Step 1: `jev.js` 的 `PLAN_SYS_PROMPT` 增加一行**

```
'可选字段"sections"：把整曲拆成 2-5 个段落（如 A 陈述 / B 对比 / A\' 再现 / Coda 收束），形如 [{"id":"A","arc":"flat","level":1.2},...]，'
+'arc ∈ flat|rise|arch|fall，level 为该段基准强度 0-3，顺序即出现顺序。没有把握就不要给。',
```

- [ ] **Step 2:** 全量测试仍绿（提示词文本无测试覆盖，确认 `npm test` 不受影响即可）。

---

### Task 4: 回归门

- [ ] **Step 1:** 12 种子决策指标。**门**（相对轮次 7 基线 `chords 9.25 / entropy 2.46 / lh 28.42 / madj 0 / ladj 0`）：
  - `melody_adjacent_repeat` = 0（**硬门**）
  - `lh_adjacent_repeat` = 0（**硬门**）
  - `lh_unique_bars` ≥ 26.0
  - `unique_chords` ≥ 8.5
  - `interval_entropy` ≥ 2.30

- [ ] **Step 2:** 张力峰数（`scripts/tmp-form.mjs`）：目标平均峰数 ≥3.0，且**种子间方差下降**（现状 0..4 高度随机 → 形式固定后应稳定）。峰数不达标不算失败（形式的价值主要在听感与可读性，不在指标），但必须如实记录。

- [ ] **Step 3:** 删临时脚本；同步 `AGENTS.md` / `MEMORY.md` / `README.md`；一个 commit。

---

## 自检

- **规格覆盖**：段落派生 → Task 1；接入 plan → Task 2；LLM 系统二 → Task 3；验证 → Task 4。
- **占位符扫描**：无 TBD/TODO，代码与命令可直接执行。
- **类型一致性**：`plan.sections` 统一为 `{id, arc, level, swing, bars, start}[]`；`sectionAt`/`deriveSections`/`sanitizeSections` 三处产出同构。`intensityTarget` 签名不变（多一个带默认值的 `barsPerPhrase`），既有调用点无需改动。
