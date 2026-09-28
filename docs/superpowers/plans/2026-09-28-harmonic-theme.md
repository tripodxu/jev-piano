# 和声主题（Harmonic Theme）Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：让和声也参与「主题」——承袭旋律动机时，底下的和声功能与动机保持一致。第 11 轮让旋律成为主题，和声至今仍是逐小节独立决策，A→A' 只在旋律层呼应。

**Architecture**：`this.motif` 扩展保存 `fn`（动机那一小节的和声功能）；`chordCandidates` 新增 `opts.themeFn`，对同功能候选加权；`composer.js` 在 `dev === 'repeat'` 时把 `themeFn` 喂给候选集与 `state`。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖。

---

## 证据

12 种子，66 个承袭小节：

| 指标 | 值 |
|---|---|
| 承袭时和声功能与动机相同 | **22.7%** |
| 承袭时根音与动机相同 | 9.1% |
| 平均根音距离 | 3.15 半音 |
| **全局功能分布** | T 19% · **S 38%** · D 9% · Tp 34% |

**22.7% 低于最常见功能（下属 38%）的基线**——和声对「主题」毫无概念，「A→A′ 只是同一个旋律配了一堆随便的和声」。

第 11 轮修好了旋律，这一轮补上另一半：**同一旋律 + 同一和声功能 = 真正的主题重现**。

## 音乐学依据

「主题」在古典作曲里通常是**旋律与和声的合体**。只复现旋律而每次换和声，听感上是「一段旋律被重新配了和声」；旋律与和声路径一起复现，才是「主题回来了」。同时，**只在功能层对齐、具体和弦仍由模型自由选**，既保住了主题识别度，又不牺牲和声词汇。

## 设计

- `this.motif.fn`：动机那一小节的和声功能（第 2 小节时记下）
- `chordCandidates(..., { themeFn })`：同功能候选 `weight += 0.6`（可调节）。`0.6` 与 `W_FN=0.8` 同量级——足以决定性，又不绝对压倒
- `state.harmonic_theme`：告诉模型「动机落在 X 功能上」，让它自己也能用这条信息
- 只在 `dev === 'repeat'` 时生效——模进/倒影/装饰是对**上一小节**的变形，不该牵动机

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/candidates.js` | Modify | `chordCandidates` 的 `opts.themeFn` 加权 |
| `public/js/composer.js` | Modify | 动机记下 `fn`；`repeat` 时传 `themeFn`；`state` 暴露 |
| `test/candidates.test.mjs` | Modify | `themeFn` 加权方向与量级 |
| `test/composer.test.mjs` | Modify | 承袭时功能对齐率显著高于全局基线 |

---

### Task 1: 候选加权（TDD）

- [ ] **Step 1: 写失败测试**（`test/candidates.test.mjs`）

```js
test('chordCandidates: themeFn 提高同功能候选的权重，但不做绝对过滤', () => {
  const plan = { mode: 'minor', meterNum: 4, barsPerPhrase: 8, density: 0.5, totalBars: 32, arc: 'arch' };
  const style = STYLE_BY_ID.romantic;
  const plain = chordCandidates(style, plan, 'i', 3, false, null, [], {}, {});
  const themed = chordCandidates(style, plan, 'i', 3, false, null, [], {}, { themeFn: 'D' });
  const w = (c, fn) => c.filter((x) => x.fn === fn).reduce((s, x) => s + x.weight, 0);
  assert.ok(w(themed, 'D') > w(plain, 'D'), '主题功能的候选权重应更高');
  assert.ok(w(themed, 'S') === w(plain, 'S'), '非主题功能不应受影响');
  assert.ok(themed.some((x) => x.fn !== 'D'), '仍必须保留其它功能的候选（不做硬过滤）');
});
```

- [ ] **Step 2: 运行确认失败** → 断言不成立
- [ ] **Step 3: 实现**（`candidates.js` 的 `build()` 内，既有 `opts.sectionStart` 附近）

```js
      // 主题功能：承袭旋律动机时，同一和声功能更可能是「同一个主题」而非「同一旋律配了新和声」
      if (opts.themeFn && fn === opts.themeFn) weight += 0.6;
```

- [ ] **Step 4: 运行确认通过**

---

### Task 2: composer 接线

- [ ] **Step 1: 动机记下功能**

`this.motif = { ..., fn: chordP.fn ?? chordFn }`（`chordP` 已带 `fn`）。

- [ ] **Step 2: 承袭时传 `themeFn`**

```js
    const themeFn = dev === 'repeat' ? (this.motif?.fn ?? null) : null;
    const cands = chordCandidates(..., { sectionStart, sectionEnd, themeFn });
```

> 注意：`chordCandidates` 在 `dev` 解析**之前**被调用，需把 `themeFn` 的计算挪到解析之后或改为两段式。实施时以最小改动为准：**先按既有顺序构造 cands**，`dev` 解析后若 `dev === 'repeat'`，用 `themeFn` 重算一次权重（纯函数，代价可忽略），或者更简单：把和弦解析整体后移。**以「重算一次」最安全，不动既有顺序。**

- [ ] **Step 3: `state` 暴露**

`harmonic_theme: this.motif?.fn ? \`the motif rests on ${this.motif.fn}\` : undefined`

- [ ] **Step 4: 加测试**（`test/composer.test.mjs`）——聚合多颗种子，断言承袭时功能对齐率显著高于全局基线：

```js
test('和声主题：承袭旋律时，和声功能与动机对齐（不再是随机配和声）', async () => {
  let n = 0, aligned = 0, base = { T: 0, S: 0, D: 0, Tp: 0 }, tot = 0;
  for (const seed of [2026, 2027, 2028, 2029]) {
    const { composer } = await makeComposer({ styleId: 'romantic', seed, bars: 32 });
    const bars = []; for (let i = 0; i < 32; i++) bars.push(await composer.nextBar());
    const mFn = bars[1].decision.chordFn;
    for (const b of bars) { base[b.decision.chordFn]++; tot++; }
    for (const b of bars) {
      if (b.decision.develop !== 'repeat') continue;
      n++; if (b.decision.chordFn === mFn) aligned++;
    }
  }
  const maxBase = Math.max(...Object.values(base)) / tot;
  assert.ok(n >= 10, `承袭样本太少（${n}）`);
  assert.ok(aligned / n > maxBase * 1.3, `对齐率 ${(aligned / n * 100).toFixed(0)}% 应远高于最常见功能的基线 ${(maxBase * 100).toFixed(0)}%`);
});
```

---

### Task 3: 验证

- [ ] **Step 1:** 12 种子实测对齐率（基线 22.7%，最常见功能基线 38%）
- [ ] **Step 2:** 12 种子决策指标。**门**：`madj = 0`（硬）、`ladj = 0`（硬）、`chords ≥ 8.5`、`lh ≥ 26.0`、`entropy ≥ 2.30`、`melody ≥ 28`
- [ ] **Step 3:** 删临时脚本；同步文档；一个 commit

---

## 自检

- **规格覆盖**：候选加权 → Task 1；接线 → Task 2；验证 → Task 3。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`opts.themeFn` 是 `string | null`；`chordCandidates` 的 `opts` 已是末尾带默认值的对象，既有调用点零改动。
