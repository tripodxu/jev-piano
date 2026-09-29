# 呼吸取消全部变形手法 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：把第 16 轮的修复从「只覆盖承袭」**推广到全部变形手法**——`sequence`/`inversion`/`ornament` 与呼吸同现时同样被静默取消，且归因仍在说谎。

**Architecture**：**「呼吸」从「门」改成「延迟」**——不再是「有呼吸就不许用素材」，而是「无论走哪条素材路径，都在末尾整体延后」。这是本轮的核心抽象，也是第 16 轮教训的一般化。

---

## 证据

审计 10 种子，只看与呼吸同现的小节（`与素材的平均音程差`；素材 = 动机 for `repeat`、上一小节 for其余）：

| 手法 | 次数 | 平均音程差 | 首音确实延后 | 判断 |
|---|---|---|---|---|
| `repeat` 承袭 | 13 | **1.43** | 100% | ✅ 第 16 轮已修 |
| `sequence` 模进 | 16 | 3.60 | 100% | ❌ 移一个音级应 ≤2 |
| `ornament` 装饰 | 7 | 3.86 | 100% | ❌ 应接近 0.5 |
| `inversion` 倒影 | 8 | 3.94 | 100% | ❌ 倒影本就是镜像，指标有歧义，但远超任何变换应有的规模 |
| `new` 新句 | 5 | 3.43 | 100% | ✅ 本就全新，预期 |

**根因**：`usePrev = !breathe && …`，把呼吸当成了**门禁**而不是**时值**。

第 16 轮只把 `repeat` 挪出这条门禁；其余三种仍被挡住。而兜底归因修正只写了 `if (dev === 'repeat')`，所以**日志继续写「模进/倒影/装饰」而音乐是新的**。

---

## 设计

`breathe` 应该是**一条时值指令**（延后进入），不是**一条否决指令**（不许用素材）。

```
breatheDelay(notes)  // 取这组音的最小相邻 onset 间距，夹在 [0.125, 0.5] 拍
```

- `repeat`：`buildFromMotif` 内部已用它 ✅
- `sequence`/`inversion`/`ornament`：`buildFromPrev` 之后统一施加
- `new`：`renderMelody` 自己处理呼吸，不变

`usePrev` 去掉 `!breathe`。兜底归因的条件从 `dev === 'repeat'` 改为**「本应使用素材却没拿到素材」**，一次覆盖全部。

---

## Task

### Task 1: 抽出行函数 + 推广（TDD）
- [ ] **Step 1: 写失败测试**（`test/composer.test.mjs`）

```js
test('呼吸不再取消任何变形手法：模进/倒影/装饰都要用上素材（只是延后进入）', async () => {
  const stat = { sequence: [], inversion: [], ornament: [] };
  for (const seed of [2026, 2027, 2028, 2029, 2030, 2031]) {
    const { composer } = await makeComposer({ styleId: 'romantic', seed, bars: 32 });
    const bars = []; for (let i = 0; i < 32; i++) bars.push(await composer.nextBar());
    const intOf = (b) => b.notes.filter((n) => n.hand === 'R').map((n, k, a) => (k ? n.midi - a[k - 1].midi : 0)).slice(1);
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i];
      if (!b.decision.breathe || !stat[b.decision.develop]) continue;
      const r = intOf(b), p = intOf(bars[i - 1]);
      const L = Math.min(r.length, p.length);
      if (!L) continue;
      let d = 0; for (let k = 0; k < L; k++) d += Math.abs(r[k] - p[k]);
      stat[b.decision.develop].push(d / L);
    }
  }
  for (const [op, arr] of Object.entries(stat)) {
    assert.ok(arr.length >= 3, `${op} 样本太少（${arr.length}）`);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    // 模进是移一个音级（≤2）；装饰是加经过音（接近 0）；倒影是镜像（用「仍来自素材」而不是逐音相等来判）
    const limit = op === 'inversion' ? 6 : op === 'ornament' ? 1.6 : 2.4;
    assert.ok(mean <= limit, `${op} 与素材的平均音程差 ${mean.toFixed(2)} 超过 ${limit} —— 该手法仍被呼吸取消`);
  }
});
```

> 倒影的判据说明：倒影后音程取反，逐音比较必然很大，所以对 `inversion` 只验「仍然来自素材」的量级（≤6），真正的强校验交给「归因不说谎」那条测试（记为 repeat/inversion 的小节必须有旋律且非空）。

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

`composer.js`：

```js
/** 呼吸的延后量：取这组音自己的最小节奏间距，夹在 [0.125, 0.5] 拍。
 *  呼吸是**时值指令**（延后进入），不是**否决指令**（不许用素材）——第 16 轮只改了 repeat，
 *  其余三种仍被 `!breathe` 挡在门外。 */
function breatheDelay(notes) {
  const ons = (notes ?? []).map((n) => n.startBeats).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const gaps = ons.slice(1).map((o, i) => o - ons[i]).filter((d) => d > 1e-9);
  return Math.max(0.125, Math.min(0.5, ...(gaps.length ? gaps : [0.5])));
}
```

- `buildFromMotif` 改为调用 `breatheDelay(base)`
- 分流处：

```js
    const usePrev = !!this.prevMelody && (dev === 'sequence' || dev === 'inversion' || dev === 'ornament');
    ...
    } else if (usePrev) {
      rh = buildFromPrev(...);
      if (dev === 'ornament') rh = insertPassing(rh, scale, this.rng);
      if (breathe && rh.length) { const d = breatheDelay(rh); rh = rh.map((n) => ({ ...n, startBeats: n.startBeats + d })); }
    }
```

- 兜底归因：条件从 `dev === 'repeat'` 改为「**本应使用素材**」：

```js
      const wantedMaterial = dev === 'repeat' || usePrev;
      if (dev !== 'new' && wantedMaterial && (dev === 'repeat' || dev === 'sequence' || dev === 'inversion' || dev === 'ornament')) {
        effectiveDev = 'new';
        this.developHistory[this.developHistory.length - 1] = 'new';
      }
```

- [ ] **Step 4: 运行确认通过** → `npm test` ≥123

### Task 2: 验证
- [ ] **Step 1:** 12 种子回归门：`madj=0`（硬）、`ladj=0`（硬）、`melody ≥ 28`、`chords ≥ 8.5`、`entropy ≥ 2.30`、`lh ≥ 26.0`
- [ ] **Step 2:** 重跑审计脚本确认三种手法的音程差都降下来
- [ ] **Step 3:** 同步文档；一个 commit

---

## 自检
- **规格覆盖**：推广修复 → Task 1 Step 3；验证 → Task 2
- **占位符扫描**：无 TBD/TODO
- **类型一致性**：`breatheDelay(notes) → number`（拍），与 `buildFromMotif` 内部的现有逻辑同源
