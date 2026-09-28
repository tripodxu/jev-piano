# 呼吸取消承袭（归因撒谎）Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：修掉「呼吸」静默取消「承袭」——四分之一的所谓主题重述其实什么��重述，而界面仍在宣称它重述了。

**Architecture**：`buildFromMotif` 接受 `breathe`，把动机**整体延后**而不是替换（作曲里「主题延迟进入」是真实手法，两个模型决策都被兑现）；并在兜底路径上**修正归因**，让 `decision.develop` 说真话。

---

## 证据

12 种子 384 小节诊断：

| 指标 | 值 |
|---|---|
| 发展手法分布 | repeat 17.2% · sequence 24.5% · inversion 14.3% · ornament 23.4% · new 20.6% |
| 呼吸小节 | 15.9% |
| **承袭中被呼吸取消** | **16/66 = 24.2%** |
| 音符落在 1/16 网格 | 99.1% |
| 旋律跳进 | ≤小二度 71.8% · ≤四度 19.2% · ≤六度 6.0% · >六度 2.9% |

机制：`motifReady` 与 `usePrev` 都要求 `!breathe`，所以 `develop === 'repeat' && breathe === true` 时走 `fresh()`。

**两个 bug 叠在一起**：
1. **音乐**：四分之一的「重述」什么��重述
2. **诚实性**：`decision.develop` 仍记为 `repeat`，决策日志显示「承袭」、功能轨给它括线与「承」字、动机卡给它**计数一次「回来」**——**归因在撒谎**，而这个项目的立身之本就是「每个音符可溯源」

---

## 设计

### ① 呼吸不再取消承袭，而是让动机**延后进入**

`buildFromMotif(motif, { breathe })`：为真时把全部 onset **整体后移**一个「动机自身的最小音程间距」（从动机自己的节奏里取，没有就用 0.5 拍）。

这比「丢掉第一个音」更好——丢掉首音会破坏动机身份；整体后移则两个模型决策都被兑现：既重述了动机，又留了呼吸的空档。作曲里「主题延迟进入」是真实手法（弱起进入的再现段）。

### ② 兜底路径上**修正归因**

若因任何原因（素材缺失等）最终走了 `fresh()`，`decision.develop` 记为 `'new'` 而非 `'repeat'`。**决策日志说真话是硬要求**，不靠调用方自觉。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/composer.js` | Modify | `buildFromMotif` 支持 `breathe`；兜底时归因为 `new` |
| `test/composer.test.mjs` | Modify | 呼吸+承袭时动机仍在；归因不说谎 |

---

### Task 1: 呼吸不再取消承袭（TDD）

- [ ] **Step 1: 写失败测试**

```js
test('呼吸不再取消承袭：breathe 时动机整体延后，音程序列不变', async () => {
  let checked = 0;
  for (const seed of [2026, 2027, 2028, 2029, 2030, 2031]) {
    const { composer } = await makeComposer({ styleId: 'romantic', seed, bars: 32 });
    const bars = [];
    for (let i = 0; i < 32; i++) bars.push(await composer.nextBar());
    const intOf = (b) => b.notes.filter((n) => n.hand === 'R').map((n, k, a) => (k ? n.midi - a[k - 1].midi : 0)).slice(1);
    const mInt = intOf(bars[1]);
    for (const b of bars) {
      if (b.decision.develop !== 'repeat' || !b.decision.breathe) continue;
      checked++;
      const r = intOf(b);
      const L = Math.min(r.length, mInt.length);
      let d = 0; for (let k = 0; k < L; k++) d += Math.abs(r[k] - mInt[k]);
      assert.ok(L > 0 && d / L <= 2.2, `呼吸的承袭应仍是动机轮廓，平均音程差 ${(d / L).toFixed(2)}`);
    }
  }
  assert.ok(checked >= 4, `样本太少（${checked}）——若为 0 说明这条路径没被覆盖`);
});

test('归因不说谎：若最终走了全新渲染，develop 必须记为 new', async () => {
  // 直接用无动机素材的构造：第 0 小节（动机未诞生）若被要求承袭，也不该记成 repeat
  const { composer } = await makeComposer({ styleId: 'romantic', seed: 2026, bars: 32 });
  const bars = []; for (let i = 0; i < 32; i++) bars.push(await composer.nextBar());
  for (const b of bars) {
    if (b.decision.develop === 'repeat') {
      const rh = b.notes.filter((n) => n.hand === 'R');
      assert.ok(rh.length > 0, '记为承袭的小节必须有旋律');
    }
  }
});
```

- [ ] **Step 2: 运行确认失败** → 呼吸的承袭音程差不满足
- [ ] **Step 3: 实现**

`buildFromMotif` 的签名加 `breathe = false`，在 `onsets` 算好后：

```js
  // 「呼吸」不应该取消承袭：把动机**整体延后**而不是替换——主题延迟进入是真实手法，
  // 而丢掉首音会破坏动机身份。延后量取动机自身的最小音程间距（从它自己的节奏里来）。
  const shift = breathe ? Math.min(0.5, ...gapsOf(onsets)) : 0;
```

其中 `gapsOf(onsets)` 返回相邻 onset 的正差值集合（无正差时给 `[0.5]`）。然后所有 `onsets[k] + shift`。

分流处把 `breathe` 从「退回全新渲染」改为「传入延后量」：

```js
    const fromMotif = !!this.motif?.midis?.length && (dev === 'repeat' || dev === 'ornament');
```

> 注意：第 11 轮已把 `ornament` 改回基于 `prevMelody`，此处只需保留 `repeat` 走动机。

- [ ] **Step 4: 兜底归因**：在 `if (!rh || !rh.length) rh = fresh();` 之后，若 `dev === 'repeat'`，把 `dev` 改为 `'new'`（并同步 `this.developHistory` 的最后一项）。

- [ ] **Step 5: 运行确认通过** → `npm test` ≥111

---

### Task 2: 验证

- [ ] **Step 1:** `npm test` 全绿
- [ ] **Step 2:** `node --check`
- [ ] **Step 3:** 12 种子指标回归。**门**：`madj = 0`（硬）、`ladj = 0`（硬）、`melody ≥ 28`、`chords ≥ 8.5`、`entropy ≥ 2.30`、`lh ≥ 26.0`
- [ ] **Step 4:** 「呼吸的承袭」样本里动机轮廓恢复率
- [ ] **Step 5:** 同步 `AGENTS.md` / `MEMORY.md` / `README.md`

---

## 自检

- **规格覆盖**：呼吸不取消承袭 → Task 1 Step 3；归因修正 → Task 1 Step 4；验证 → Task 2。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`buildFromMotif(motif, opts)` 新增 `breathe` 布尔项，其余 opts 不变。
