# 计划：接线循环锁死断路器 + 抽出候选集模块

- **状态**：已完成（2026-09-28）
- **轮次**：第 1 轮 ·【优化】
- **归属**：`public/js/composer.js`（拆分）、新 `public/js/candidates.js`、`test/composer.test.mjs`、新 `test/candidates.test.mjs`
- **触发**：MEMORY.md [阻塞] 条目「真实 Jev 重复度基线：和弦多样性未达标」

---

## Phase 0：文档发现（本计划的依据）

| 需要的事实 | 来源 | 结论 |
|---|---|---|
| 循环锁死机制的设计意图 | `public/js/composer.js:122-124` JSDoc | 「循环锁死时循环成员直接从候选中剔除（jevthoven：代码策划候选集）」 |
| 该机制是否真的实现 | `public/js/composer.js:134` 签名第 7 参 `recentRoots` | **声明了但函数体从未引用——死参数** |
| `detectLoop` 的产出 | `public/js/composer.js:123-130` | `{ locked, members:Set<number> }`，`members` = 窗口内出现 ≥2 次的根音 |
| `members` 的消费者 | 全仓 grep `recentRoots\|detectLoop\|members` | **零消费者**；`detectLoop` 的返回值只用于 `state.harmony.loop_locked` 这个提示字段 |
| 调用方已经在传参 | `public/js/composer.js:589-591` | `chordCandidates(..., recentRoots, this.rootFatigue)`——接口早就留好了 |
| 既有测试已经在传参 | `test/composer.test.mjs:162,166` | 同上，但断言只覆盖疲劳，循环成员从未被断言 |
| 剔除是否安全 | `docs/adr/0003-candidate-set-enforcement.md:13` | 「反重复机制可以放心地动态剔除候选——剔除即强制，不担心模型抗议」 |
| 疲劳的两段式兜底 | `public/js/composer.js:177,203-204` | `build(respectFatigue)`：全剔则 `build(false)` 重建，保证候选非空 |
| 文件行数约束 | `docs/adr/0004-zero-framework-static-frontend.md:10` | 「每个文件 ≤800 行」；当前 composer.js = 769，MEMORY 已记「逼近上限」 |

**Allowed APIs（只能复制，不得自创）**：`detectLoop`、`parseRoman`、`chordLabel`、`chordMidis`、`STYLE_BY_ID`、`LH_DEFS`、`RHYTHM_POOLS`、`node:test` + `node:assert/strict`、`node --test`。

**Anti-patterns**：
- ✗ 自创新的检测算法（必须复用 `detectLoop`，它已被 `test/composer.test.mjs:149` 锁定语义）
- ✗ 把剔除放进 `Composer.nextBar()`（剔除属于候选集构造职责，见 Phase 1 的模块边界）
- ✗ 循环锁死删空候选集后不兜底（长曲必然出现"全池都在循环里"）
- ✗ 改 `STYLES` 预设或进行池（`theory.test.mjs` 全量断言，改必炸且与本任务无关）

---

## Phase 1：抽出 `public/js/candidates.js`（模块边界）

**做什么**　把「候选集构造」这一职责整体搬出 `composer.js`：候选集是"给模型的可选域"，渲染内核是"把选择变成音符"，两者是不同的深度。`composer.js` 769 行已逼近 ADR-0004 的 800 行上限，而本轮要加的代码正好落在这一职责里。

**搬走**（`composer.js:119-257`，逐字复制，不改逻辑）：

| 符号 | 行 | 依赖 |
|---|---|---|
| `ROMAN_BY_PC` | 119 | — |
| `ROOT_ROLE` | 46-51 | — |
| `ARC_CURVES` | 31-36 | — |
| `detectLoop` | 123-130 | — |
| `chordCandidates` | 134-214 | `STYLE_BY_ID` 不需要；`parseRoman`、`chordLabel` |
| `lhCandidates` | 217-227 | `LH_DEFS` |
| `rhythmCandidates` | 230-240 | `RHYTHM_POOLS` |
| `contourWeights` | 243-251 | — |
| `intensityTarget` | 254-257 | `ARC_CURVES` |

**留在 composer.js**：`CONTOUR_STEPS`（`renderMelody:392` 消费）、`DEVELOP_OPS`、`Composer` 类、全部音符渲染。

**关键校验**　`contourWeights` 只用字面量键、不引用 `CONTOUR_STEPS`；`intensityTarget` 只引用同搬的 `ARC_CURVES`。因此新模块**不依赖 composer.js 任何内部符号**，无循环依赖。

**References**：`public/js/composer.js:3-6` 的 import 块按需裁剪；`public/js/composer.js:645-687` 的 `questions` 构造从 `./candidates.js` 取函数。

**Verification checklist**
- `node --check public/js/candidates.js` → 无输出
- `npm test` → 47/47（改 test 的 import 路径后）
- `grep -c "chordCandidates" public/js/composer.js` → 仅剩 import + 调用处
- `wc -l public/js/composer.js` → **< 700**

**Anti-pattern guards**：不得改搬走函数的任何一行逻辑（Phase 2 只改 `chordCandidates` 内部）；不得把 `CONTOUR_STEPS` 复制两份。

---

## Phase 2：接线循环锁死断路器（TDD，先测试后实现）

**做什么**　兑现 JSDoc 已承诺的机制。两种反重复机制互补：

| 机制 | 触发条件 | 语义 | 弱点 |
|---|---|---|---|
| 根音疲劳（已有） | 某根音累计疲劳 > 2.0 | "用得太多" | 衰减慢；**必须等循环已经形成才拦得住** |
| 循环锁死（缺失） | 最近 6 根音 ≤3 个不同值 | "结构上正在绕圈" | — |

真实渠道 `unique_chords=6` + 前 8 小节 `Cm-Fm-G` 死循环，正是因为疲劳阈值在 6 小节窗口内来不及累积到 2.0。

**Step 1：先写测试**（`test/candidates.test.mjs`，此时**必须失败**）

```js
test('chordCandidates: 循环锁死时循环成员被剔除，且不会剔空', () => {
  const plan = { mode: 'minor', meterNum: 4, barsPerPhrase: 8, density: 0.5, totalBars: 32 };
  const style = STYLE_BY_ID.romantic;
  // 无疲劳表干扰：只验证循环锁死这一条机制
  const cands = chordCandidates(style, plan, 'i', 3, false, null, [0, 3, 7, 0, 3, 7], {});
  for (const c of cands) assert.ok(![0, 3, 7].includes(c.rootPc), `循环根音 ${c.rootPc} 不应出现`);
  assert.ok(cands.length >= 3, '剔除后仍有候选');
});
test('chordCandidates: 未锁死时循环成员仍在候选内（不误伤）', () => {
  const cands = chordCandidates(style, plan, 'i', 3, false, null, [0, 3, 7, 5, 8, 10], {});
  assert.ok(cands.some((c) => c.rootPc === 0), '根音丰富时不应误剔');
});
test('chordCandidates: 全池都在循环里时兜底不剔空（长曲保护）', () => {
  // 只有 I/V/IV/vi 四个根音的风格，锁死时必须仍有候选
  const waltz = STYLE_BY_ID.waltz;
  const cands = chordCandidates(waltz, plan, 'I', 3, false, null, [0, 5, 7, 0, 5, 7], {});
  assert.ok(cands.length >= 3);
});
```

**Step 2：实现**（`candidates.js` 的 `chordCandidates`）

1. 顶部算一次 `const loop = detectLoop(recentRoots); const loopMembers = loop.locked ? loop.members : new Set();`
2. `build(respectFatigue, respectLoop)` 增加第二个开关；根音过滤条件改为 `fatigued(p.rootPc) || loopMembers.has(p.rootPc)`，两个开关分别短路。
3. 三段兜底：`build(true, true)` → 空则 `build(false, true)`（**保留循环锁死、放掉疲劳**：疲劳是自衰减的软约束，锁死是当下正在发生的硬事实，见 ADR-0003「剔除即强制」）→ 仍空则 `build(false, false)`。
4. `subs`（副属/借用/悬挂）走同一个过滤，替换和弦不能把被锁死的根音偷渡回来。

**Documentation references**　照抄 `composer.js:177` 既有 `build(respectFatigue)` 的两段式形状与注释风格；`detectLoop` 直接调用，不重新实现。

**Verification checklist**
- `node --test test/candidates.test.mjs` → 3/3
- `npm test` → 50/50（47 + 3）
- `node scripts/analyze-repetition.mjs 32 <seed> random` × 4 种子 → `unique_chords` 均值 ≥ 基线 8.5，**最低值 > 6**
- 回归红线：`melody_adjacent_repeat == 0`、`lh_unique_bars` 不低于基线 27.3、`interval_entropy` 不低于 2.46

**Anti-pattern guards**：不得在 `Composer.nextBar()` 里过滤（职责错位）；不得为了指标好看而放宽 `detectLoop` 的 `window/maxDistinct` 语义（已被测试锁定）。

---

## Phase 3：决策元信息可归因（ADR-0003 后果条款）

**做什么**　ADR-0003:13 要求「decision 元信息应能表达『发生了剔除』」。把 `loopLocked` 落到 `bar.decision`，未来前端可显示"断路器已触发"。

**Verification**　`test/composer.test.mjs` 增一条：连续 32 小节编曲中，bar.decision 有 `loopLocked` 布尔字段。

**Anti-pattern guards**：不新增 UI（下一轮前端轮再做）。

---

## Phase 4：验证与收尾

1. `npm test` → 全绿且只增不减
2. `node --check` 全部改动 .js
3. `analyze-repetition` 4 种子对比表（前后）
4. 同步 `AGENTS.md` §2 代码地图（composer.js 新行数 + candidates.js 新条目）
5. `MEMORY.md` 顶部写记忆条目；[阻塞] 条目改写为"已解锁"
6. README 反重复设计一节补一行"循环锁死断路器"
7. 一个 commit
