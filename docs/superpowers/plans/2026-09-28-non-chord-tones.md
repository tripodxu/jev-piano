# 非和声音分析（Non-Chord Tone）Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：把「旋律音与当前和弦的关系」变成可测可看的分析——延续第 5 轮张力分析、第 2 轮功能层、第 12 轮动机卡这条「让内部状态可见」的线。

**Architecture**：新建 `public/js/nct.js`（**分析层**，与 `tension.js` 平级、无决策副作用）；`studio.js` 的卷帘头部加一条**契合度带**；实时界面的读数行补「和弦音 xx%」。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖。

---

## 证据

12 种子 384 小节 / 1892 个旋律音：

| 类别 | 占比 |
|---|---|
| 和弦音 | **62.4%** |
| 经过音（passing） | 6.0% |
| 邻音（neighbor） | 7.0% |
| 倚音（appoggiatura） | 3.1% |
| 其它非和弦音 | 21.6% |
| **非和声音合计** | **37.6%** |
| 不在调内音阶上 | 9.6% |

**非和声音 37.6% 落在古典语汇的 20–40%** —— 音乐是**调性健康的**，所以这是一个「解释性」的分析而不是警报。这也给用户一个此前没有的读数：**为什么这首曲子听起来是调性的**。

**取证的插曲**：第一版脚本把 midi 号当成了音级类，报出「和弦音 0.0%」这种荒谬数字。**一个荒谬到应该立刻被怀疑的结果，差点被我当成重大发现。**

---

## 算法（Kostka-Payne《Tonal Harmony》的标准分类）

对每个旋律音，先看是否属于当前和弦的音级类；不是则按**进出方式**分类：

| 判据 | 类别 |
|---|---|
| 音级 ∈ 和弦音集 | `chord` 和弦音 |
| 进与出都是级进（≤2 半音）且**同向** | `passing` 经过音 |
| 进与出都是级进且**反向** | `neighbor` 邻音 |
| 出为级进且**下行**（进为跳进） | `appoggiatura` 倚音 |
| 其余 | `other` 其它非和弦音 |

`barHarmonyFit(bar)` 返回 `{kinds, fit, nct}`，`fit` = 和弦音占比。

---

## 设计

### ① 契合度带（工作室卷帘头部）
在已有的「张力 / 功能带 / 和弦名」之外，再加一条**按小节的和弦音占比**条形带：越高越「在调上」。与卷帘共用 `ZOOM`，横轴天然对齐——第 6 轮起第四次复用这个手法。

### ② 实时读数
张力读数行补「和弦音 xx%」，与均值/跨度并列。

### ③ 音符标记（工作室卷帘）
旋律里的非和弦音加一道**亮边**（左手不动）。**一维一通道**：手别=填色，非和音=描边。承袭沿用功能轨的做法（形状/文字），这里同理。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/nct.js` | Create | `classifyNote` / `barHarmonyFit` / `NCT_ZH`（纯函数，可单测） |
| `public/js/studio.js` | Modify | 契合度带绘制 + 非和音描边 |
| `public/js/main.js` | Modify | 读数行补和弦音占比 |
| `test/nct.test.mjs` | Create | 分类正确性 + 边界 + 脏输入 |

---

### Task 1: 分类纯函数（TDD）

- [ ] **Step 1: 写失败测试**（`test/nct.test.mjs`）

```js
test('classifyNote: 和弦音 / 经过音 / 邻音 / 倚音 的标准判据', () => {
  const C = new Set([0, 4, 7]);           // C 大三和弦
  assert.equal(classifyNote(0, 4, 7, C), 'chord', '和弦音');
  assert.equal(classifyNote(4, 5, 7, C), 'passing', '4→5→7 同向上行级进 = 经过音');
  assert.equal(classifyNote(4, 5, 4, C), 'neighbor', '4→5→4 折返 = 邻音');
  assert.equal(classifyNote(0, 8, 7, C), 'appoggiatura', '跳进到 8 再级进下行解到 7 = 倚音');
  assert.equal(classifyNote(0, 10, 4, C), 'other', '其余归 other');
});

test('classifyNote: 首尾音没有邻居时不得误判为经过/邻音', () => {
  const C = new Set([0, 4, 7]);
  assert.equal(classifyNote(null, 5, 7, C), 'other', '缺前邻 → other');
  assert.equal(classifyNote(4, 5, null, C), 'other', '缺后邻 → other');
});

test('classifyNote: 脏输入不崩', () => {
  const C = new Set([0, 4, 7]);
  for (const bad of [null, undefined, new Set(), 0, 'x']) {
    const t = classifyNote(0, 4, 7, bad);
    assert.ok(typeof t === 'string' && t.length, `脏和弦集 ${String(bad)} → ${t}`);
  }
});

test('barHarmonyFit: fit 恒在 0..1，空旋律按 1 处理', () => {
  const bar = { chord: { rootPc: 0, shape: '' }, notes: [
    { midi: 60, hand: 'R', startBeats: 0, durBeats: 1, vel: .5 },
    { midi: 64, hand: 'R', startBeats: 1, durBeats: 1, vel: .5 },
    { midi: 61, hand: 'R', startBeats: 2, durBeats: 1, vel: .5 },
  ] };
  const f = barHarmonyFit(bar);
  assert.equal(f.kinds.length, 3);
  assert.ok(f.fit > 0.6 && f.fit <= 1, `fit=${f.fit}`);
  assert.equal(f.nct, 1, '61(C#) 不在 C 大三和弦里');
  assert.equal(barHarmonyFit({ chord: { rootPc: 0, shape: '' }, notes: [] }).fit, 1);
  assert.equal(barHarmonyFit(null).fit, 0, '脏输入返回 0 而不是崩');
});
```

- [ ] **Step 2: 运行确认失败** → 模块不存在
- [ ] **Step 3: 实现** `public/js/nct.js`

```js
// nct.js — 非和声音分析：把「旋律音与当前和弦的关系」变成可测可看的数。
// 分析层：只读已生成的小节，不参与决策（与 tension.js 同级、无耦合）。
import { chordPcs } from './music.js';

export const NCT_ZH = { chord: '和弦音', passing: '经过音', neighbor: '邻音', appoggiatura: '倚音', other: '非和弦' };

export function classifyNote(prevPc, pc, nextPc, chordTones) {
  if (!chordTones || typeof chordTones.has !== 'function') return 'other';
  if (chordTones.has(pc)) return 'chord';
  if (prevPc == null || nextPc == null) return 'other';
  const d1 = pc - prevPc, d2 = nextPc - pc;
  if (Math.abs(d1) <= 2 && Math.abs(d2) <= 2) return Math.sign(d1) === Math.sign(d2) ? 'passing' : 'neighbor';
  if (Math.abs(d2) <= 2 && d2 < 0) return 'appoggiatura';
  return 'other';
}

export function barHarmonyFit(bar) {
  if (!bar || !Array.isArray(bar.notes) || !bar.chord) return { kinds: [], fit: 0, nct: 0 };
  const tones = new Set(chordPcs(bar.chord.rootPc ?? 0, bar.chord.shape ?? ''));
  const mel = bar.notes.filter((n) => n.hand === 'R').sort((a, b) => a.startBeats - b.startBeats);
  if (!mel.length) return { kinds: [], fit: 1, nct: 0 };
  const pc = (n) => ((n.midi % 12) + 12) % 12;
  const kinds = mel.map((n, k) => classifyNote(mel[k - 1] ? pc(mel[k - 1]) : null, pc(n), mel[k + 1] ? pc(mel[k + 1]) : null, tones));
  const chordCount = kinds.filter((t) => t === 'chord').length;
  return { kinds, fit: chordCount / kinds.length, nct: kinds.length - chordCount };
}
```

- [ ] **Step 4: 运行确认通过** → `npm test` ≥115

---

### Task 2: 两处呈现

- [ ] **Step 1:** `studio.js`：`drawTimeline` 增加**契合度带**（每小节一根竖条，高度 ∝ fit，用黄铜；与卷帘共用 `ZOOM`）；卷帘音符绘制时，旋律的非和弦音加 1px 亮边。契合度数据走 `pieceTension` 同款的缓存 + `invalidateTension()` 旁路作废。
- [ ] **Step 2:** `main.js`：`onBar` 里把 `barHarmonyFit(bar).fit` 并入 `tensionStat` 读数（`… · 和弦音 63%`）。
- [ ] **Step 3:** `main.js` import 新模块。

---

### Task 3: 验证

- [ ] **Step 1:** `npm test` 全绿
- [ ] **Step 2:** `node --check`
- [ ] **Step 3:** 元素 id 契约（本轮**不新增 id**）
- [ ] **Step 4:** 决策指标 12 种子**逐位不变**（分析层不参与生成）
- [ ] **Step 5:** 同步 `AGENTS.md` / `MEMORY.md` / `README.md`

---

## 自检

- **规格覆盖**：分类 → Task 1；契合度带 + 音符描边 + 读数 → Task 2；验证 → Task 3。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`classifyNote(prevPc, pc, nextPc, chordTones) → 'chord'|'passing'|'neighbor'|'appoggiatura'|'other'`；`barHarmonyFit(bar) → {kinds, fit, nct}`。分析层不 import 决策层，与 `tension.js` 的边界一致。
