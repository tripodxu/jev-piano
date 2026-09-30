# 修复「移调只移旋律，不移和声」（轮次 22 · 优化）Implementation Plan

> **轮次 22 · 优化**。诊断证据见轮次 20 前的取证脚本（docs/memory/2026-09-30-keypc-harmony-fix.md）。

## 证据（动手前先量）

`keyPc=0 / 7 / 3`（C / G / Eb）三种调、同 seed 生成 6 小节（romantic·minor）：

| keyPc | 计划卡显示 | 实际和弦序列 | 左手音域 |
|---|---|---|---|
| 0 | C minor | Bb Cm Bb Cm G Cm | 36–64 |
| 7 | **G minor** | Bb Cm Bb Cm Cm Ab | 36–64 |
| 3 | **Eb minor** | Bb Cm Bb Cm G Cm | 36–64 |

**三种「调」产出完全相同的 C 体系和声**。`keyPc` 的全部消费点只有：旋律音阶 `scaleMidis`、Jev state 的 key 标签、UI 显示、工作室编辑的音阶池。`parseRoman('i')` → rootPc 0 → `lhVoicing` 低音 36（=C2）——**和弦永远是 C 调体系**。

**后果分级**：
1. 用户选调 / LLM 给 keyPc 后，**和声与旋律不同调**（旋律音阶在 Eb，强拍锚定的「和弦音」是 C 体系 chordMidis）——真实的不协和；
2. Jev 被告知 `key: "G minor"`，候选集却是 C 体系符号——**模型在错误的语境里做选择**；
3. 「开演前指定 12 个调性之一」（README 承诺）对和声无效。

## 修复设计（相对/绝对分离，决策逻辑零改动）

**根因**：rootPc 在候选集里是「相对主音的度数」（I=0），但在渲染点被当成**绝对音高类**消费。19 轮以来默认 keyPc=0，两者恰好相等，bug 不可见。

- **候选集/决策层全部保持相对**（不动）：`chordCandidates`、`functionOf`、疲劳表、循环锁死、`FN_NEXT`、`decision.roman`。
- **唯一介入点 = composer.nextBar 的素材化处**：
  `absPc = (chordP.rootPc + plan.keyPc) % 12`；`chord = { ...chordP, rootPc: absPc, relPc: chordP.rootPc, symbol: chordLabel(absPc, shape) }`。
- 消费绝对 rootPc 的渲染路径**自动修正**：`renderLH`/`chordMidis`/`snapLastToChord`/`buildFromMotif`/工作室 `barChords`/`nct.js`。
- 消费相对 rootPc 的决策路径改读 `relPc`：`recentRoots`（循环锁死输入）、`rootFatigue` 键。
- 工作室旧 JSON：rootPc 本来就是 C 体系绝对值（因为 bug），修复后语义一致，无需迁移。

**已知取舍（如实记录）**：和弦拼写沿用 `PREFERRED_NAME` 固定惯例（pc 11 显示 `B`）。Eb 小调的 bVI 理论拼写是 Cb，本修复后显示 `B`（同音，钢琴键名也是 B）——完整调号拼写引擎是独立的大工程，不在本轮。

## 测试（TDD）

1. 同 seed 下 keyPc=0 与 keyPc=7 逐小节：`b.chord.rootPc === (a.chord.rootPc + 7) % 12` 且 `b.chord.relPc === a.chord.rootPc`（fixture 同构保证决策序列一致）。
2. 移调后和弦名必有变化（G 小调 i = Gm ≠ Cm）。
3. **12 种子回归门**：默认计划 keyPc=0，absPc === relPc，指标必须逐位不变。

## 验证关卡

npm test 全绿 · `node --check` · 12 种子指标逐位一致 · 元素 id 不新增。
