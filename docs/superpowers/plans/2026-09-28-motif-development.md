# 动机发展真正落地 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：让「承袭 / 模进 / 倒影」三种发展手法**真的作用在动机上**——目前它们要么渲染成全新旋律（`repeat`），要么作用在**上一小节**而不是动机（`sequence`/`inversion`）。项目的核心承诺「动机统一」在渲染层从未实现。

**Architecture**：`this.motif` 扩展为同时保存**旋律素材**（音程序列 + 节奏网格 + 走向）；新增 `buildFromMotif()`（`buildFromPrev` 的推广：从动机素材出发，可移调/倒影，锚定到当前和弦）。四种手法各走各的路径，`new` 才生成全新旋律。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖。

---

## 证据（动手前先量）

承袭小节共 70 个（12 种子 × develop='repeat'）：

| 指标 | 值 |
|---|---|
| 旋律与动机音程序列**完全相同** | 2/70 = **2.9%** |
| 旋律形状接近（平均音程差 ≤1） | 2/70 = 2.9% |
| **平均音程差** | **3.76 半音**（约小三度——完全不同的轮廓） |
| 和声根音与动机相同 | 12.9% |

## 根因

```js
// composer.js nextBar()
const usePrev = !breathe && !!this.prevMelody && (dev === 'sequence' || dev === 'inversion');
```

- **`repeat` 不在列表里** → 选「承袭」时走 `renderMelody`，与选「新句」**同一条路径**，什么都没承袭。
- `sequence` / `inversion` 作用在 `this.prevMelody` 上，那是**上一小节**的旋律，不是动机。模进/倒影应该作用在动机上。
- `this.motif` 只存了 `{ rhythmId, contourId, pattern }`——**只有节奏，没有旋律素材**，所以根本无法「重述」。

这是第 1 轮「死参数」那一类缺陷的放大版：接口与文档都在，实现不在。

## 设计

| develop | 语义 | 素材来源 | 变换 |
|---|---|---|---|
| `repeat` 承袭 | 在新和声里重述动机 | **动机** | 不变（只重新锚定到当前和弦） |
| `sequence` 模进 | 动机移一个音级 | **动机** | ±1 音级 |
| `inversion` 倒影 | 动机镜像 | **动机** | 音程取反 |
| `ornament` 装饰 | 动机加经过音 | **动机** | 加经过音 |
| `new` 新句 | 全新想法 | — | 全新渲染 |

`buildFromMotif(motif, opts)`：沿用 `buildFromPrev` 的骨架（强拍锚到和弦音、末音按乐句尾加长），但**素材换成动机**并支持 `transpose`/`invert`。

**张力所在**：动机统一与旋律多样性天然冲突。当前 `melody_unique_bars ≈ 31.9/32`，改动后可能显著下降。缓解手段：和弦锚定让每次陈述的绝对音高都不同；指纹护栏会撞车时变形。**门：`melody_unique_bars ≥ 28`**（当前 31.9，可接受约 12% 的下降换取真正的动机统一）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/composer.js` | Modify | 动机捕获旋律素材；`buildFromMotif`；五种手法分流 |
| `test/composer.test.mjs` | Modify | 承袭/模进/倒影真的作用在动机上 |

---

### Task 1: 动机捕获旋律素材（TDD）

- [ ] **Step 1: 写失败测试**

```js
test('动机被真正记住：承袭的旋律音程序列应与动机一致（而非全新生成）', async () => {
  for (const seed of [2026, 2027, 2031]) {
    const { composer } = await makeComposer({ styleId: 'romantic', seed, bars: 32 });
    const bars = [];
    for (let i = 0; i < 32; i++) bars.push(await composer.nextBar());
    const mInt = intOf(bars[1]);
    const repeats = bars.filter((b) => b.decision.develop === 'repeat');
    if (!repeats.length) continue;
    const exact = repeats.filter((b) => JSON.stringify(intOf(b)) === JSON.stringify(mInt)).length;
    assert.ok(exact / repeats.length >= 0.8, `seed ${seed} 承袭 ${repeats.length} 次，只有 ${exact} 次音程与动机一致`);
  }
});
```

（`intOf` 取右手相邻音程序列，辅助函数放测试内。）

- [ ] **Step 2: 运行确认失败** → 断言不成立（现状 ~3%）

---

### Task 2: `buildFromMotif` + 五种手法分流

- [ ] **Step 1: 实现动机素材捕获**

`nextBar()` 中原本只存节奏的地方，扩成同时存旋律素材：

```js
    if (!this.motif && pos.bar === 1) {
      this.motif = {
        rhythmId: ans.rhythm?.value ?? 'r0', contourId: contour, pattern: rhythmEntry.pat,
        midis: rh.map((n) => n.midi),          // 旋律素材：音高序列（承袭/模进/倒影的原料）
        onsets: rh.map((n) => n.startBeats),   // 节奏素材
      };
    }
```

> 位置很重要：必须在 `this.prevMelody` 赋值之后、`this.motif` 判定的那行原处。

- [ ] **Step 2: 实现 `buildFromMotif`**（放在 `buildFromPrev` 之后）

```js
/**
 * 从**动机**素材出发构建旋律，而不是从上一小节。承袭/模进/倒影/装饰都走这里。
 *  transpose: 整体移调（音级数，正=上移）；invert: 音程取反（倒影）。
 *  强拍与末音仍锚定到当前和弦——「同一想法，新的和声」正是这样成立的。
 */
function buildFromMotif(motif, { chord, scale, meterNum, intensity, isPhraseEnd, rng, transpose = 0, invert = false, ornament = false }) {
  const midis = motif.midis ?? [];
  if (!midis.length) return null;
  const steps = meterNum * 4;
  const onsets = motif.onsets?.length ? motif.onsets : midis.map((_, i) => Math.round((i * steps) / midis.length));
  let cur = midis[0];
  for (let i = 0; i < Math.abs(transpose); i++) cur = scaleNext(cur, Math.sign(transpose), scale);
  const sig = invert ? -1 : 1;
  const acc = [];
  const notes = midis.map((m, k) => {
    if (k > 0) acc[k] = (acc[k - 1] ?? 0) + (m - midis[k - 1]) * sig;
    let midi = clamp(cur + (acc[k] ?? 0), 60, 84);
    const strong = onsets[k] % 4 === 0 || k === midis.length - 1;
    if (strong) midi = nearest(midi, chordMidis(chord.rootPc, chord.shape, 58, 86));
    return { midi, startBeats: onsets[k], durBeats: 0, vel: velFor(Math.round(onsets[k] * 4), intensity, rng), hand: 'R' };
  });
  notes.forEach((n, k) => {
    const nextO = k < notes.length - 1 ? onsets[k + 1] : steps;
    let d = ((nextO - onsets[k]) / 4) * 0.9;
    if (k === notes.length - 1 && isPhraseEnd) d *= 2;
    n.durBeats = d;
  });
  return ornament ? insertPassing(notes, scale, rng) : notes;
}
```

- [ ] **Step 3: 分流**

把

```js
const usePrev = !breathe && !!this.prevMelody && (dev === 'sequence' || dev === 'inversion');
let rh = usePrev ? buildFromPrev(...) : renderMelody({...});
if (!usePrev && dev === 'ornament') rh = insertPassing(rh, scale, this.rng);
```

改为

```js
// 四种"发展"手法都从动机素材出发；只有 new 才是全新想法。
// 动机尚未诞生（第 0 小节）或本小节要呼吸时，退回全新渲染。
const motifReady = !!this.motif?.midis?.length && !breathe;
const fromMotif = motifReady && (dev === 'repeat' || dev === 'sequence' || dev === 'inversion' || dev === 'ornament');
let rh = fromMotif
  ? (buildFromMotif(this.motif, { chord, scale, meterNum: plan.meterNum, intensity, isPhraseEnd: pos.isPhraseEnd, rng: this.rng,
      transpose: dev === 'sequence' ? (this.rng() < 0.5 ? 1 : -1) : 0, invert: dev === 'inversion', ornament: dev === 'ornament' }) ?? [])
  : renderMelody({ plan, chord, contourId: contour, pattern: varied, breathe, intensity, isPhraseEnd: pos.isPhraseEnd, startHint, rng: this.rng });
if (!rh.length) rh = renderMelody({ plan, chord, contourId: contour, pattern: varied, breathe, intensity, isPhraseEnd: pos.isPhraseEnd, startHint, rng: this.rng });
```

- [ ] **Step 4: 运行确认通过** → `npm test` 全绿

---

### Task 3: 回归门

- [ ] **Step 1:** 承袭相似度实测（`tmp-theme` 口径）：旋律与动机完全一致的比例应从 2.9% 显著上升。
- [ ] **Step 2:** 决策指标 12 种子。**门**：`madj = 0`（硬）、`ladj = 0`（硬）、**`melody_unique_bars ≥ 28`**、其余同前（`chords ≥ 8.5`、`lh ≥ 26.0`、`entropy ≥ 2.30`）。
  **`melody_unique_bars` 是本轮最可能受损的指标**——动机统一与旋律多样性天然冲突。低于 28 则把 `sequence` 改回作用在 `prevMelody`（模进本就可以基于前一乐句），只保留 `repeat`/`inversion` 基于动机。
- [ ] **Step 3:** 删临时脚本；同步文档；一个 commit。

---

## 自检

- **规格覆盖**：动机捕获 → Task 2 Step 1；四种手法 → Task 2 Step 2/3；验证 → Task 3。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`this.motif` 扩为 `{rhythmId, contourId, pattern, midis, onsets}`；`buildFromMotif` 返回 `note[] | null`（素材缺失时 null，调用方已做 `?? []` 与 `renderMelody` 兜底）。
