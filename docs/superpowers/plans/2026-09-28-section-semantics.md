# 段落边界的和声与动机语义 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：让**段落边界**在和声与动机上真正有语义——新段落从「家」出发并**重述主题**，旧段落用更强的终止式收束。这是 A→A' 关系能被听出来的前提。

**Architecture**：`candidates.js` 新增 `developCandidates()`（把 composer 里内联的发展手法权重提成纯函数，同时让 composer.js 瘦下来）并给 `chordCandidates` 加 `sectionStart`/`sectionEnd` 标志；`composer.js` 由 `plan.sections` 算出这两个标志喂给候选集与 `state`。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖。

---

## 证据（动手前先量）

### ① 段落对动机毫无影响

12 种子 × 32 小节：

| 指标 | 值 |
|---|---|
| 段落首小节拿到「承袭」 | **8/48 = 16.7%** |
| 全局「承袭」基线 | 12.2% |
| 段落首落在主和弦 | 11/48 = 22.9% |
| 段落末落在 V/I 终止式 | 18/48 = 37.5% |

16.7% vs 12.2%，样本 48——**差异在噪声内，等于段落首和别处没什么两样**。轮次 8 建的曲式只通过 `intensityTarget` 约束了**动态**，对**和声**和**动机**毫无影响。A→A' 的再现关系因此在音乐上听不出来。

### ② 诊断过程中我犯的一个错（记录在案）

我一度从「最常见的发展手法转移 top-6 里没有 `repeat`」推断「承袭几乎从不触发」。下一轮测量直接推翻：`repeat` 在 **12/12 个种子全部触发**，占 12.2%。**把「没出现在榜单上」当成「不存在」**——证据缺失不是证据。

## 音乐学依据

- **新段落从主和弦出发**：乐句可以从中途开始（半终止），但**新段落是一次"重新立足"**，回到 T 让听众听见"开始了新的一段"。
- **新段落重述主题**（承袭 `repeat`）：A→A' 的听觉关联正是靠"同一动机在新的和声语境里再出现一次"。没有这一步，两段只是并置而非呼应。
- **段落收束比乐句收束更强**：乐句尾是半终止，段落尾是段落性的收束，V/I 权重应高于普通乐句尾。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/candidates.js` | Modify | `developCandidates()` 纯函数；`chordCandidates` 的 `sectionStart`/`sectionEnd` 加权 |
| `public/js/composer.js` | Modify | 由 `plan.sections` 算标志；`state` 暴露 `position.section` / `is_section_start` / `is_section_end` |
| `test/candidates.test.mjs` | Modify | 段落标志的权重方向测试 |
| `test/composer.test.mjs` | Modify | `state` 含段落信息；段落首「承袭」比例提升 |

---

### Task 1: `developCandidates` 纯函数（TDD）

- [ ] **Step 1: 写失败测试**（`test/candidates.test.mjs`）

```js
test('developCandidates: 段落首显著偏向「承袭」（A→A\' 的再现关系）', () => {
  const base = developCandidates({ arc: 'arch' }, { barInPhrase: 3, isPhraseEnd: false, lastDevelop: 'new' });
  const atSec = developCandidates({ arc: 'arch' }, { barInPhrase: 0, isPhraseEnd: false, lastDevelop: 'new', sectionStart: true });
  assert.ok(atSec.repeat > base.repeat * 1.8, `段落首 repeat ${atSec.repeat.toFixed(2)} 应远高于平时 ${base.repeat.toFixed(2)}`);
  // 不得把其它手法压成 0——模型仍要有选择
  for (const k of ['sequence', 'inversion', 'ornament', 'new']) {
    assert.ok(atSec[k] > 0, `段落首 ${k} 权重被压成 0，模型失去选择`);
  }
});

test('developCandidates: 段落末偏向「承袭」以外的收束手法（不必强制）', () => {
  const c = developCandidates({ arc: 'arch' }, { barInPhrase: 7, isPhraseEnd: true, lastDevelop: 'new' });
  assert.ok(c.repeat > 0, '乐句尾仍可有承袭');
});

test('developCandidates: 刚承袭过就抑制再次承袭（既有逻辑不回归）', () => {
  const a = developCandidates({}, { barInPhrase: 0, lastDevelop: 'new' }).repeat;
  const b = developCandidates({}, { barInPhrase: 0, lastDevelop: 'repeat' }).repeat;
  assert.ok(b < a, '连续承袭应被抑制');
});
```

- [ ] **Step 2: 运行确认失败** → `developCandidates is not a function`

- [ ] **Step 3: 实现**（`candidates.js`）

把 `composer.js` 里内联的 `devW` 搬过来并加段落语义：

```js
/** 发展手法（第 7 问）权重。段落边界有特殊语义：
 *  段落首大幅偏向 repeat（承袭）——A→A' 的再现关系就是靠"同一动机在新段落里再出现一次"建立的；
 *  乐句头偏向 new（起新句），乐句尾偏向 repeat，段落首则避开 new（不是新句，是重述）。 */
export function developCandidates(plan, { barInPhrase = 0, isPhraseEnd = false, lastDevelop = null, sectionStart = false, sectionEnd = false } = {}) {
  const w = { repeat: 0.5, sequence: 1.1, inversion: 0.5, ornament: 0.9, new: 0.9 };
  if (barInPhrase <= 1) w.new += 0.5;
  if (isPhraseEnd) w.repeat += 0.4;
  if (lastDevelop === 'repeat') w.repeat *= 0.3;
  if ((plan?.density ?? 0.5) > 0.6) w.ornament += 0.2;
  if (sectionStart) { w.repeat += 1.6; w.new *= 0.3; }   // 重述主题，而不是另起新句
  if (sectionEnd) { w.repeat += 0.8; w.inversion += 0.4; }
  return w;
}
```

- [ ] **Step 4: 运行确认通过** → `npm test` 103 全绿

---

### Task 2: 段落边界的和声加权

- [ ] **Step 1: 写失败测试**

```js
test('chordCandidates: 段落首更偏向主和弦、段落末更偏向 V/I（强于普通乐句）', () => {
  const plan = { mode: 'minor', meterNum: 4, barsPerPhrase: 8, density: 0.5, totalBars: 32, arc: 'arch' };
  const style = STYLE_BY_ID.romantic;
  const w = (opts) => chordCandidates(style, plan, 'iv', opts.bi, opts.be, null, [], {}, opts);
  const plain = w({ bi: 3, be: false });
  const secStart = w({ bi: 0, be: false, sectionStart: true });
  const secEnd = w({ bi: 7, be: true, sectionEnd: true });
  const g = (c, pc) => c.find((x) => x.rootPc === pc)?.weight ?? -Infinity;
  assert.ok(g(secStart, 0) > g(plain, 0), `段落首主和弦 ${g(secStart, 0)} 应高于普通小节 ${g(plain, 0)}`);
  assert.ok(g(secEnd, 0) + g(secEnd, 7) >= g(plain, 0) + g(plain, 7), '段落末的终止式权重应不低于普通乐句尾');
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**：`chordCandidates` 增加末尾参数 `opts = {}`，在 `build()` 的权重里加两行（**只做加法，不改既有项**）：

```js
      if (opts.sectionStart && p.rootPc === 0) weight += 1.0;   // 新段落重新立足
      if (opts.sectionEnd && (p.rootPc === 7 || p.rootPc === 0)) weight += 0.8; // 段落性收束
```

- [ ] **Step 4: 运行确认通过** → `npm test` 104 全绿

---

### Task 3: composer 接线 + `state` 暴露段落

- [ ] **Step 1: 实现**

`composer.js` 的 `nextBar()`：

```js
    // 段落边界标志（曲式在和声与动机上的语义）
    const secHere = sectionAt(plan.sections, this.index);
    const sectionStart = secHere && secHere.start === this.index;
    const sectionEnd = secHere && secHere.start + secHere.bars - 1 === this.index;
```

传给 `chordCandidates`（末尾 opts）与 `developCandidates`；`state.position` 增�� `section: secHere?.id ?? null`、`is_section_start: sectionStart`、`is_section_end: sectionEnd`，并在 `state.form` 里放整份 `plan.sections`（模型需要看到 A→B→A' 的全貌才谈得上呼应）。

- [ ] **Step 2: 加测试**（`test/composer.test.mjs`）

```js
test('段落边界进入决策状态与候选权重（fixture 下可测）', async () => {
  const { composer, plan } = await makeComposer({ styleId: 'romantic', seed: 2026, bars: 32 });
  let atStart = 0, atStartRepeat = 0, totalRepeat = 0, sawSectionState = 0;
  for (let i = 0; i < 32; i++) {
    const bar = await composer.nextBar();
    totalRepeat += bar.decision.develop === 'repeat' ? 1 : 0;
    const sec = plan.sections.find((s) => s.start === bar.index);
    if (sec) {
      atStart++;
      if (bar.decision.develop === 'repeat') atStartRepeat++;
      sawSectionState += bar.decision.answers.function != null ? 1 : 0;
    }
  }
  assert.ok(atStart >= 2, '32 小节至少 2 个段落起点');
  assert.ok(sawSectionState === atStart, '段落首小节仍应有完整的七问决策');
  assert.ok(atStartRepeat / atStart > 0.45, `段落首「承袭」${atStartRepeat}/${atStart} 应显著高于基线（约 0.16）`);
});
```

> 「承袭」比例用**单个种子的 4 个段落起点**判定会太抖（4 个样本）。实现后先跑 12 种子聚合再定阈值；测试本身用较松的 0.45 作为回归护栏，真实效果以 12 种子聚合为准。

- [ ] **Step 3: 运行确认通过** → `npm test` 105 全绿

---

### Task 4: 回归门与收尾

- [ ] **Step 1: 段落语义实测**（重跑 `tmp-secbase` 口径）：段落首「承袭」应从 16.7% 显著上升，段落首主和弦与段落末 V/I 同��上升。
- [ ] **Step 2: 决策指标 12 种子**。**门**（相对轮次 9 基线 `chords 9.42 / entropy 2.51 / lh 28.33 / madj 0 / ladj 0`）：`madj = 0`（硬）、`ladj = 0`（硬）、`lh ≥ 26.0`、`chords ≥ 8.5`、`entropy ≥ 2.30`。
- [ ] **Step 3:** 删临时脚本；同步 `AGENTS.md` / `MEMORY.md` / `README.md`；一个 commit。

---

## 自检

- **规格覆盖**：动机语义 → Task 1；和声语义 → Task 2；接线与模型可见 → Task 3；验证 → Task 4。
- **占位符扫描**：无 TBD/TODO，代码与命令可直接执行。
- **类型一致性**：`developCandidates(plan, opts)` 产出 `{repeat, sequence, inversion, ornament, new}`；`chordCandidates` 的 `opts` 是**末尾带默认值的新参数**——既有 7 参调用点（含测试）全部无需改动。
