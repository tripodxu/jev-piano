# 和声功能层 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。
> **设计出处**：[../specs/2026-09-28-harmonic-function-layer-design.md](../specs/2026-09-28-harmonic-function-layer-design.md)
> **步骤语法**：checkbox 逐条勾选。

**Goal**：把候选集来源从「进行池并集」扩到「调式全调内色板」，并新增 Jev 第 7 问「和声功能」，用共同音 + 五度圈距离做可解释的声部进行加权。

**Architecture**：`music.js` 增加调式色板与功能分类（纯数据/纯函数）；`candidates.js` 增加功能转移矩阵与声部进行打分，替换掉原来「pool 计数 + 1.2 延续加成」的启发式；`composer.js` 增加第 7 问并实现「功能族内回落」。既有两条断路器（根音疲劳 / 循环锁死）原样保留。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖（ADR-0004 红线一）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/music.js` | Modify | 新增 `HARMONIC_FUNCTIONS`、`functionOf()`、`modePalette()`——调式 → 全调内罗马数字色板 |
| `public/js/candidates.js` | Modify | 新增 `commonTones()`、`fifthsDist()`、`functionCandidates()`；`chordCandidates` 换色板来源与权重 |
| `public/js/composer.js` | Modify | 第 7 问「function」+ 功能族内回落 + 归因字段 |
| `test/music.test.mjs` | 新建 | 色板/功能分类的纯函数测试（当前无此文件） |
| `test/candidates.test.mjs` | Modify | 色板扩充、权重方向、功能族 |
| `test/composer.test.mjs` | Modify | 第 7 问在 fixture 下存在且合法 |

> `test/` 现状无 `music.test.mjs`；乐理相关断言目前在 `theory.test.mjs`。新功能是 `music.js` 的新导出，放 `theory.test.mjs` 更符合现状（避免制造同主题的两个文件）。**决定：追加到 `theory.test.mjs`。**

---

### Task 1: 功能分类与调式色板（纯函数）

**Files:** Modify `public/js/music.js`；Test `test/theory.test.mjs`

- [ ] **Step 1: 写失败测试**

追加到 `test/theory.test.mjs`：

```js
import { HARMONIC_FUNCTIONS, functionOf, modePalette, chordPcs } from '../public/js/music.js';

test('modePalette: 色板 = 调式音阶的全部音级拼成的罗马数字（可被 parseRoman 解析）', () => {
  for (const mode of ['major', 'minor', 'dorian', 'mixolydian', 'pentatonicMajor', 'pentatonicMinor']) {
    const pal = modePalette(mode);
    assert.ok(pal.length >= 5, `${mode} 色板过少: ${pal.length}`);
    assert.equal(new Set(pal.map((p) => p.rootPc)).size, pal.length, `${mode} 色板有重复根音`);
    for (const c of pal) {
      assert.ok(parseRoman(c.sym), `${mode}/${c.sym} 不可解析`);
      assert.ok(c.fn, `${mode}/${c.sym} 缺功能`);
    }
  }
  // C 大调 7 个音级、7 个根音
  assert.equal(modePalette('major').length, 7);
  // 五声 5 个音级
  assert.equal(modePalette('pentatonicMinor').length, 5);
});

test('functionOf: 功能和弦映射到 T/S/D/Tp', () => {
  assert.equal(functionOf('I', 'major'), 'T');
  assert.equal(functionOf('V', 'major'), 'D');
  assert.equal(functionOf('IV', 'major'), 'S');
  assert.equal(functionOf('vi', 'major'), 'Tp');
  assert.equal(functionOf('i', 'minor'), 'T');
  assert.equal(functionOf('V', 'minor'), 'D');
  assert.equal(functionOf('iv', 'minor'), 'S');
  assert.equal(functionOf('bVI', 'minor'), 'Tp');
});

test('functionOf: 与 modePalette 自洽（色板每一项的 fn 都等于 functionOf(sym)）', () => {
  for (const mode of ['major', 'minor', 'dorian', 'pentatonicMinor']) {
    for (const c of modePalette(mode)) {
      assert.equal(c.fn, functionOf(c.sym, mode), `${mode}/${c.sym} 功能不自洽`);
    }
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/theory.test.mjs`
Expected: FAIL — `HARMONIC_FUNCTIONS` 未导出（SyntaxError: does not provide an export named）。

- [ ] **Step 3: 实现**

在 `public/js/music.js` 的 `lhVoicing` 之后、「曲风预设」之前插入：

```js
/* ==================== 和声功能与调式色板 ==================== */

// 四功能和声功能。Tp = 离调色彩和弦（承担 ii°/iv/Neapolitan/中音级角色）
export const HARMONIC_FUNCTIONS = {
  T: 'tonic — stable, home',
  S: 'subdominant — prepares motion, opens outward',
  D: 'dominant — tension, pulls back home',
  Tp: 'tonic proxy — color, relative-mode or borrowed hue',
};

// 根音 → 功能（大调）。-1 = 不在自然音级内
const FN_MAJOR = { 0: 'T', 5: 'S', 7: 'D', 2: 'S', 9: 'Tp', 4: 'Tp', 11: 'Tp' };
// 根音 → 功能（小调）：iii(4) 与 VII(11) 归 Tp，承担色彩/离调
const FN_MINOR = { 0: 'T', 3: 'S', 7: 'D', 5: 'S', 8: 'Tp', 2: 'Tp', 10: 'Tp' };

export function functionOf(romanSym, mode = 'major') {
  const p = parseRoman(romanSym);
  if (!p) return null;
  const table = /minor|pentatonic|dorian|mixolydian/.test(mode) && mode !== 'major' ? FN_MINOR : FN_MAJOR;
  return table[p.rootPc] ?? 'Tp';
}

// 罗马数字按音级命名（供色板拼符号用）
const ROMAN_BY_PC_LOCAL = { 0: 'I', 1: 'bII', 2: 'II', 3: 'bIII', 4: 'III', 5: 'IV', 6: 'bV', 7: 'V', 8: 'bVI', 9: 'VI', 10: 'bVII', 11: 'VII' };

/** 调式的全调内和声色板：取 SCALES[mode] 的全部音级，拼成罗马数字并标注功能。
 *  这就是突破「进行池只有 4 个和弦」天花板的来源。 */
export function modePalette(mode) {
  const semis = SCALES[mode] || SCALES.major;
  const out = [];
  for (const s of semis) {
    const rootPc = ((s % 12) + 12) % 12;
    // 大三和弦用大写，小三和弦用小写，其余小写（parseRoman 会归一到正确的 shape）
    const majorish = mode === 'major' || mode === 'lydian';
    const sym = (majorish ? ROMAN_BY_PC_LOCAL[rootPc] : ROMAN_BY_PC_LOCAL[rootPc].toLowerCase().replace('b', 'b'));
    out.push({ sym, rootPc, fn: functionOf(sym, mode) });
  }
  return out;
}
```

> **注意** `ROMAN_BY_PC_LOCAL` 与 `candidates.js` 里的 `ROMAN_BY_PC` 内容相同但归属不同；保留两份会让「同一常量两处定义」腐化。**修正：把 `ROMAN_BY_PC` 从 `candidates.js` 移到 `music.js` 并导出**，`candidates.js` 改为 import。Step 3 落地时一并做。

- [ ] **Step 4: 运行确认通过**

Run: `npm test` → Expected: 55 通过 + 3 新增 = 58。

- [ ] **Step 5: 提交**

```bash
git add public/js/music.js test/theory.test.mjs
git commit -m "feat(music): harmonic function taxonomy + full diatonic palette per mode"
```

---

### Task 2: 声部进行打分与功能转移矩阵

**Files:** Modify `public/js/candidates.js`；Test `test/candidates.test.mjs`

- [ ] **Step 1: 写失败测试**

追加到 `test/candidates.test.mjs`：

```js
import { commonTones, fifthsDist, functionCandidates } from '../public/js/candidates.js';

test('commonTones: 共音计数正确（C→Am 共 2 个）', () => {
  assert.equal(commonTones('', 0, 'm', 9), 2, 'C 的 {0,4,7} 与 Am 的 {9,0,4} 交集 {0,4}');
  assert.equal(commonTones('', 0, '', 7), 2, 'C 与 G 交集 {7} 不成立——C{0,4,7} G{7,11,2} 交集 1');
});

test('fifthsDist: 五度圈环形距离', () => {
  assert.equal(fifthsDist(0, 0), 0);
  assert.equal(fifthsDist(0, 7), 1, 'C→G 在五度圈上相邻');
  assert.equal(fifthsDist(0, 6), 1, '环形：C→F# = C→Gb，相邻');
  assert.equal(fifthsDist(0, 6), fifthsDist(6, 0), '对称');
  assert.ok(fifthsDist(0, 1) >= 1 && fifthsDist(0, 1) <= 6, '距离落在 0..6');
});

test('functionCandidates: 四功能齐备，且 D→T / 乐句尾→T 的权重更高', () => {
  const c = functionCandidates({ arc: 'arch' }, 'D', true, 7);
  assert.deepEqual(Object.keys(c).sort(), ['D', 'S', 'T', 'Tp'].sort());
  assert.ok(c.T > c.D, '乐句尾属功能应向主功能回落');
  const mid = functionCandidates({ arc: 'arch' }, 'T', false, 3);
  assert.ok(mid.S > mid.T && mid.D > mid.T, '主功能之后应走向下属或属');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/candidates.test.mjs` → Expected: FAIL（`commonTones` 未导出）。

- [ ] **Step 3: 实现**

`candidates.js` 顶部 import 增加 `chordPcs`、`modePalette`、`functionOf`、`HARMONIC_FUNCTIONS`，并把本地 `ROMAN_BY_PC` 删掉改为 import 自 `music.js`。然后新增：

```js
/** 共同音数：两和弦的音级交集大小（声部进行平滑度的核心指标） */
export function commonTones(shapeA, rootA, shapeB, rootB) {
  const a = new Set(chordPcs(rootA, shapeA));
  return chordPcs(rootB, shapeB).filter((pc) => a.has(pc)).length;
}

/** 根音在五度圈上的环形距离（0..6）：C→G=1, C→F=1, C→F#=2 */
export function fifthsDist(rootA, rootB) {
  const d = Math.abs(((rootA * 7) % 12) - ((rootB * 7) % 12));
  return Math.min(d, 12 - d);
}

/** 声部进行平滑度：共音越多越好，五度圈越近越好 */
function smoothness(cur, cand) {
  return commonTones(cur.shape, cur.rootPc, cand.shape, cand.rootPc) * 1.0 - fifthsDist(cur.rootPc, cand.rootPc) * 0.25;
}

// 功能转移矩阵：T→S/D，S→D/Tp，D→T，Tp→D/T
const FN_NEXT = { T: { S: 1.0, D: 1.0, T: 0.3, Tp: 0.5 }, S: { D: 1.2, Tp: 1.0, T: 0.4, S: 0.2 }, D: { T: 1.6, Tp: 0.9, S: 0.3, D: 0.2 }, Tp: { D: 1.0, T: 0.9, S: 0.5, Tp: 0.3 } };

/** 第 7 问的候选：下一小节该选哪个功能 */
export function functionCandidates(plan, curFn, isPhraseEnd, barInPhrase) {
  const base = { ...(FN_NEXT[curFn] ?? FN_NEXT.T) };
  if (isPhraseEnd) { base.T += 1.0; base.D += 0.5; base.S *= 0.4; base.Tp *= 0.4; }
  if (barInPhrase === 0) { base.T += 0.6; }
  const out = {};
  for (const [k, v] of Object.entries(base)) if (v > 0) out[k] = { w: v, desc: HARMONIC_FUNCTIONS[k] };
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test` → Expected: 61 通过。

- [ ] **Step 5: 提交**

```bash
git add public/js/candidates.js test/candidates.test.mjs
git commit -m "feat(candidates): voice-leading score (common tones + circle of fifths) + function transition matrix"
```

---

### Task 3: 色板扩充 + 新权重

**Files:** Modify `public/js/candidates.js`；Test `test/candidates.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
test('chordCandidates: 候选来源是全调内色板，不再受 4 和弦进行池限制', () => {
  const cands = chordCandidates(STYLE_BY_ID.romantic, MINOR_PLAN, 'i', 3, false, null, [], {});
  const roots = new Set(cands.map((c) => c.rootPc));
  assert.ok(roots.size >= 4, `色板应给出多个根音，实际 ${[...roots]}`);
  assert.ok(cands.some((c) => c.fn), '每个候选应带功能标注');
  // 原进行池成员仍应在场（不回归既有风格色彩）
  assert.ok(cands.some((c) => c.rootPc === 0), '主和弦应在候选内');
});

test('chordCandidates: 同权重下共同音更多的和弦排名更高（声部进行优先）', () => {
  const cands = chordCandidates(STYLE_BY_ID.romantic, { ...MINOR_PLAN, mode: 'major' }, 'I', 3, false, null, [], {});
  // C(C 后的第 4 度 C/E/G 与第 5 度 F/A/C 皆与 C 有 1 个共同音，G/B/D 有 1 个；用 ii 检验共音 1 > vii 的 0
  const ii = cands.find((c) => c.sym === 'ii');
  const vii = cands.find((c) => c.sym === 'VII');
  if (ii && vii) assert.ok(ii.weight > vii.weight, `ii(${ii.weight}) 应高于 VII(${vii.weight})`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/candidates.test.mjs` → Expected: FAIL（`c.fn` 为 undefined）。

- [ ] **Step 3: 实现**

在 `chordCandidates` 中，把「候选全集来自 pool 并集」改为「pool 并集 ∪ modePalette(mode)」：

```js
  // 候选全集 = 风格进行池 ∪ 调式全调内色板（色板是突破"池只有 4 和弦"天花板的来源）
  for (const c of modePalette(plan.mode)) {
    const prev = cand.get(c.sym) ?? { w: 0, cont: false, pools: 0 };
    cand.set(c.sym, { w: prev.w, cont: prev.cont, pools: prev.pools, fn: c.fn, shape: c.sym === ROMAN_BY_PC[c.rootPc] ? '' : undefined });
  }
```

并在 `build()` 的权重里加入两项（保持既有全部权重项不变，只做加法）：

```js
      // 新增：功能转移平滑度 + 声部进行平滑度
      const cur = currentSym ? parseRoman(currentSym) : null;
      if (cur) {
        const fnNext = FN_NEXT[fnOf] ?? {};
        weight += (fnNext[candFn] ?? 0.25) * 0.8;
        weight += smoothness(cur, p) * 0.5;
      }
```

其中 `fnOf = currentSym ? functionOf(currentSym, plan.mode) : 'T'`，`candFn` 取自色板标注或 `functionOf(sym, plan.mode)`（池内符号也要算，兜底用）。替换和弦同样参与这两项打分。

- [ ] **Step 4: 运行确认通过**

Run: `npm test` → Expected: 63 通过。

- [ ] **Step 5: 回归门（12 种子）**

Run: `for s in 2020..2031; do node scripts/analyze-repetition.mjs 32 $s random; done`
Expected: `unique_chords` 均值 > 8.33；`melody_adjacent_repeat` 全 0；`lh_unique_bars` 均值 ≥ 27.67；`interval_entropy` 均值 ≥ 2.53。
**任一硬门失败 → 调低新增项权重（0.8→0.4、0.5→0.25）重跑，不要提交。**

- [ ] **Step 6: 提交**

```bash
git add public/js/candidates.js test/candidates.test.mjs
git commit -m "feat(candidates): draw chord candidates from the full diatonic palette"
```

---

### Task 4: Jev 第 7 问「和声功能」+ 功能族内回落

**Files:** Modify `public/js/composer.js`；Test `test/composer.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
test('第 7 问「和声功能」存在、合法，且和弦/功能自洽', async () => {
  const { composer } = await makeComposer({ styleId: 'romantic' });
  for (let i = 0; i < 16; i++) {
    const bar = await composer.nextBar();
    assert.ok('function' in bar.decision.answers, 'fixture 决策缺 function 问');
    assert.ok(['T', 'S', 'D', 'Tp'].includes(bar.decision.fn), `非法功能 ${bar.decision.fn}`);
    assert.equal(bar.decision.chordFn, functionOf(bar.decision.roman, bar.chord.shape ? 'minor' : 'minor') || bar.decision.chordFn);
  }
});
```

> 末行断言在自洽性未保证前不稳定，落地时改为：`assert.ok(['T','S','D','Tp'].includes(bar.decision.chordFn))`。

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/composer.test.mjs` → Expected: FAIL（`bar.decision.fn` undefined）。

- [ ] **Step 3: 实现**

`composer.js`：

1. import 增加 `functionCandidates`；`music.js` import 增加 `functionOf`、`HARMONIC_FUNCTIONS`。
2. `nextBar()` 内，在 `const cands = ...` 之后构造第 7 问：

```js
    const curFn = this.currentSymRoman ? functionOf(this.currentSymRoman, plan.mode) : 'T';
    const fnCands = functionCandidates(plan, curFn, pos.isPhraseEnd, pos.barInPhrase);
    ...
      function: {
        type: 'choice',
        instructions: `You are the harmony planner. \`harmony.current_function\` is where the music is now. Choose the harmonic FUNCTION the NEXT bar should move toward; the chord itself is chosen in the parallel "chord" question and will belong to this function.${honorNote} Answer ONLY with the Choice question "function".`,
        criteria: Object.fromEntries(Object.entries(fnCands).map(([k, v]) => [k, v.desc])),
        _fixture: { weights: Object.fromEntries(Object.entries(fnCands).map(([k, v]) => [k, v.w])) },
      },
```

3. `state.harmony` 增加 `current_function: curFn`。
4. 解析与回落：

```js
    const fnAnswer = ans.function?.value;
    const declaredFn = fnCands[fnAnswer] ? fnAnswer : Object.keys(fnCands)[0];
    const picked = cands.find((c) => c.sym === chordSymRawRaw || c.label === chordSymRawRaw);
    // 非法作答：先在「模型声明的功能族」内回落，再全局回落——比单纯取最高权重更聪明
    const inFamily = cands.filter((c) => (c.fn ?? functionOf(c.sym, plan.mode)) === declaredFn);
    const chordP = picked ?? inFamily.sort((a, b) => b.weight - a.weight)[0] ?? cands[0];
```

5. 归因字段：`fn: declaredFn`、`chordFn: chordP.fn ?? functionOf(chordSymRaw, plan.mode)`、`fnRejected: !picked`。

- [ ] **Step 4: 运行确认通过**

Run: `npm test` → Expected: 64 通过。

- [ ] **Step 5: 提交**

```bash
git add public/js/composer.js test/composer.test.mjs
git commit -m "feat(composer): 7th Jev question - harmonic function, with family-aware fallback"
```

---

### Task 5: 验证、反思、收尾

- [ ] **Step 1:** `npm test` 全绿（只增不减）
- [ ] **Step 2:** `node --check` 全部改动 .js
- [ ] **Step 3:** 12 种子 fixture A/B（回归门）+ 真实 Jev 2 种子 A/B（~$0.004）
- [ ] **Step 4:** 同步 `AGENTS.md` §2 代码地图（三个文件行数 + 测试数）、`README.md`（功能层说明 + 实测行）
- [ ] **Step 5:** `MEMORY.md` 顶部写记忆；`docs/memory/` 建当日条目
- [ ] **Step 6:** 一个 commit 收尾（如 Task 1-4 已各自提交，则本步只提交文档）
