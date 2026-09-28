# 强度连续化 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：消除 `bar.intensity` 的整数档抖动——相邻小节平均跳 1.03 档（4 档量表）、26.9% 的跳变 ≥2 档、6.2% 跳满 3 档，导致力度 2.4 倍落差 + 左手织体分支同时翻转。

**Architecture**：把 `score` 问的整数回答从「绝对值」重新解释为「相对计划弧线的偏移」，再施加每小节速率限制。两个常量 `INTENSITY_DEV=0.5` / `INTENSITY_SLEW=1.0`，参数已用重放模拟验证。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖。

---

## 证据（动手前先量）

`scripts/tmp-intensity.mjs`（跑完即删）实测 12 种子 × 32 小节 = 372 次相邻跳变：

| 指标 | 值 |
|---|---|
| 平均跳变 | **1.032 档** |
| 跳 ≥2 档 | **26.9%**（100/372） |
| 跳 ≥3 档 | 6.2%（23/372） |
| 最大跳变 | 3 档 |
| 分布 | 0档×111 · 1档×161 · 2档×77 · 3档×23 |

对照 seed 2022：
```
实渲染 : 3 2 3 2 0 2 3 3 3 2 2 0 1 0 0 0 2 0 3 2 1 1 3 0 2 1 3 2 1 1 3 3   ← 噪声
计划弧 : 2.4 2.3 2.3 2.2 2.2 2.1 2.1 1.5 1.9 1.9 1.8 1.8 1.7 1.7 ...      ← 平滑下行
```

**根因**：计划弧是连续曲线，Jev 的 `score` 按 API 契约**只能返回整数档**，代码把这个整数直接当绝对值渲染。音乐意图在量化处被摧毁。`scripts/tmp-slew.mjs` 重放模拟确认参数：

| 方案 | 平均跳变 | 跳≥2 | 最大 |
|---|---|---|---|
| 现状 | 1.032 | 26.9% | 3.00 |
| 仅 dev=0.5 | 0.556 | 0% | 1.78 |
| 仅 slew=1.5 | 0.820 | 0% | 1.50 |
| **dev=0.5 + slew=1.0（采纳）** | **0.495** | **0%** | **1.00** |
| dev=0.35 + slew=1.5 | 0.414 | 0% | 1.41 |

选 dev=0.5 而非 0.35：模型仍保有**一半**的偏移发言权，不因平滑而被架空。

## 为什么这两招都对

- **dev（偏移权重）**：整数回答被解释成「比计划亮/暗多少」，不是「绝对多响」。模型同意计划时得到计划，偏离时保留一半偏离。
- **slew（速率限制）**：限制**变化率**而非目标值——这是音频侧的压缩器 attack/release 与 MIDI CC 平滑的标准做法。模型仍然决定去哪里，只是不能一小节跳三档。

两者都保持模型对动态的主导权，符合 ADR-0001「模型只做选择」。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/composer.js` | Modify | 构造函数加 `lastIntensity`；`nextBar` 用 dev+slew 取代直接取整；导出两个常量 |
| `test/composer.test.mjs` | Modify | 新增强度连续性的性质测试 |
| `test/theory.test.mjs` | Modify | `intensityTarget` 相关断言保持不变（未改该函数） |
| `AGENTS.md` / `MEMORY.md` / `README.md` | Modify | 同步说明与行数 |

---

### Task 1: 先写失败测试

- [ ] **Step 1: 追加到 `test/composer.test.mjs`**

```js
test('强度连续化：相邻小节的强度跳变有界（不再出现整数档的 0↔3 翻转）', async () => {
  for (const seed of [2020, 2022, 2027, 2028]) {
    const { composer } = await makeComposer({ seed });
    const seq = [];
    for (let i = 0; i < 32; i++) seq.push((await composer.nextBar()).intensity);
    let maxJump = 0, jumps2 = 0;
    for (let i = 1; i < seq.length; i++) {
      const d = Math.abs(seq[i] - seq[i - 1]);
      maxJump = Math.max(maxJump, d);
      if (d >= 2) jumps2++;
    }
    assert.ok(maxJump <= 1.0 + 1e-9, `seed ${seed} 最大跳变 ${maxJump.toFixed(2)} 超过速率上限 1.0`);
    assert.equal(jumps2, 0, `seed ${seed} 出现 ${jumps2} 处 ≥2 档跳变`);
  }
});

test('强度连续化：取值不再局限于整数档（连续化确实发生了）', async () => {
  const { composer } = await makeComposer({ seed: 2022 });
  const seq = [];
  for (let i = 0; i < 32; i++) seq.push((await composer.nextBar()).intensity);
  const nonInteger = seq.filter((v) => Math.abs(v - Math.round(v)) > 1e-6);
  assert.ok(nonInteger.length >= 8, `32 小节里只有 ${nonInteger.length} 个非整数值，连续化没生效`);
  for (const v of seq) assert.ok(v >= 0 && v <= 3, `${v} 越界`);
});

test('强度连续化：模型仍有发言权（不是退化成纯计划弧线）', async () => {
  // 同一 seed 两次编曲一致（确定性），但强度不应与计划弧线完全相同
  const { composer } = await makeComposer({ seed: 2022 });
  const seq = [];
  for (let i = 0; i < 32; i++) seq.push((await composer.nextBar()).intensity);
  const unique = new Set(seq.map((v) => v.toFixed(3)));
  assert.ok(unique.size >= 5, `强度序列只有 ${unique.size} 种取值，可能退化成了跟随弧线`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/composer.test.mjs`
Expected: FAIL —— `最大跳变 ... 超过速率上限 1.0`（现状最大跳变 3）。

---

### Task 2: 实现

- [ ] **Step 1: 加常量与状态**

`public/js/composer.js` 顶部（`MODES` 附近）：

```js
/** 强度的连续化参数。Jev 的 score 问按 API 契约只能答整数 0-3，但音乐需要连续动态：
 *  dev  = 模型保留「相对计划弧线」偏移的比例（0.5 = 仍有一半发言权）
 *  slew = 每小节允许的最大强度变化档数（速率限制，压缩器/MIDI CC 平滑的同一思路） */
export const INTENSITY_DEV = 0.5;
export const INTENSITY_SLEW = 1.0;
```

构造函数里，紧跟 `this.intensitySoFar = 1;` 之后：

```js
    this.lastIntensity = null;    // 上一小节实际渲染的强度（速率限制的参考点）
```

- [ ] **Step 2: 替换解析逻辑**

把

```js
    const intensity = clamp(Number.isFinite(Number(ans.intensity?.value)) ? Number(ans.intensity.value) : intensityCurve, 0, 3);
```

替换为

```js
    // score 问只能答整数 0-3；直接渲染会让相邻小节跳档（实测平均 1.03 档、26.9% 跳 ≥2 档）。
    // 两步连续化：① 把整数解释为「相对计划弧线的偏移」，保留 dev 比例；
    //              ② 对变化率设上限，模型仍决定去哪里，只是不能一小节跳三档。
    const rawIntensity = Number(ans.intensity?.value);
    const target = Number.isFinite(rawIntensity) ? clamp(rawIntensity, 0, 3) : intensityCurve;
    const want = clamp(intensityCurve + (target - intensityCurve) * INTENSITY_DEV, 0, 3);
    const intensity = this.lastIntensity == null
      ? want
      : clamp(this.lastIntensity + clamp(want - this.lastIntensity, -INTENSITY_SLEW, INTENSITY_SLEW), 0, 3);
    this.lastIntensity = intensity;
```

- [ ] **Step 3: 运行确认通过**

Run: `npm test` → Expected: 86 + 3 = **89** 全绿。

注意既有测试 `强度曲线：rise 弧线的强度随进度上升` 必须仍然通过——平滑会**加强**该相关性，不会破坏。

---

### Task 3: 回归门

- [ ] **Step 1: 强度跳变实测**

重跑 `scripts/tmp-intensity.mjs`（改为对比新旧），目标：平均跳变 ≤0.55、跳≥2 占比 = 0%、最大 ≤1.0。

- [ ] **Step 2: 决策指标 12 种子**

Run: 12 种子 `analyze-repetition`。

**门**（相对轮次 6 基线 `chords 9.25 / entropy 2.47 / lh 29.58 / madj 0 / ladj 0`）：
- `melody_adjacent_repeat` = 0（**硬门**）
- `lh_adjacent_repeat` = 0（**硬门**——左手护栏是靠 intensity 阈值分叉的，平滑可能让它更容易同质化）
- `lh_unique_bars` ≥ 27.0
- `unique_chords` ≥ 8.5
- `interval_entropy` ≥ 2.35

任一硬门失败 → 调小 `INTENSITY_SLEW` 重跑；仍失败则回退本改动。

- [ ] **Step 3: 删掉一次性脚本**

```bash
rm scripts/tmp-intensity.mjs scripts/tmp-slew.mjs
```

- [ ] **Step 4: 文档 + commit**

`AGENTS.md` 代码地图同步 `composer.js` 行数与高危区（`INTENSITY_DEV`/`INTENSITY_SLEW` 锁值理由）；`MEMORY.md` 顶部写记忆；`README.md` 设计说明补一条「动态连续化」。

---

## 自检

- **规格覆盖**：目标（消除跳变）→ Task 1/2；验证 → Task 3；不做实时渠道复测（本次是纯渲染层，fixture 与真实同构，见 ADR-0002）。
- **占位符扫描**：无 TBD/TODO，代码与命令均可直接粘贴执行。
- **类型一致性**：`bar.intensity` 由 `number`（整数）变为 `number`（浮点）——下游 `velFor`/`renderLH`/`lhCandidates`/`barTension`/`toFixed` 全部接受浮点，无需改动；已在 Task 3 Step 2 列为验证项。
