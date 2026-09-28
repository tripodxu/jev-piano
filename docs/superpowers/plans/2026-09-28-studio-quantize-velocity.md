# 卷帘量化 + 力度编辑 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。
> **模式**：impeccable **Operate**（用户在完成任务，扫读性 > 表达）

**Goal**：钢琴卷帘能**修正时值**（量化）并**直接编辑力度**（力度轨）。前者从第 1 轮就挂在任务板上；后者是第 7 轮「强度连续化」之后自然的下一步——动态终于连续了，但用户还改不动它。

**Architecture**：两个纯函数（`quantizeNotes` / 力度命中与赋值）承载全部逻辑并可单测；UI 在既有 `.rollwrap` 里**新增一条力度轨 canvas**，与卷帘共用 `ZOOM` 像素/拍——播放头是 `top:0;bottom:0` 的绝对定位元素，**天然覆盖两条轨，不需要任何同步代码**（第 6 轮「卷帘时间轴」用过的同一个手法）。

---

## 证据

10 种子 3854 个音符：

| | 值 |
|---|---|
| 偏离 1/4 网格 | **54.3%** |
| 偏离 1/8 网格 | 25.8% |
| 偏离 1/16 网格 | 0.9% |
| 力度跨度 | 0.21 – 0.87（中位 0.37） |
| 时长跨度 | 0.06 – 6.08 拍 |

生成的小节带摇摆（`plan.swing` ≤ 0.35）与时长人味，卷帘目前**完全无法修正**。

---

## 设计

### ① 量化
`quantizeNotes(piece, { grid, strength, hands })`：把 onset 吸到网格。`strength` 支持部分量化（0.5 = 只走一半），这是 DAW 惯例，也让人可以「收一半」而不是二选一。返回**被移动的音符数**，UI 要给反馈。

网格：1/4（1 拍）、1/8（0.5）、1/16（0.25）。

### ② 力度轨
卷帘下方一条 54px 高的 canvas：每个音符一根竖条，底部对齐、高度 ∝ 力度、颜色随手别（与卷帘一致）。拖动竖条改力度。命中测试复用卷帘的 `noteAt` 逻辑。

**为什么放进同一个 `.rollwrap`**：播放头与横向滚动因此自动正确。这正是第 6 轮「对齐是构造出来的，不是同步出来的」的延续。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/studio.js` | Modify | `quantizeNotes`（纯函数）；`VEL_H` 与力度轨绘制；`bindVelLane`（指针）；量化控件；播放头覆盖两条轨 |
| `public/index.html` | Modify | 新增 `#stVel` canvas 与量化控件 |
| `public/styles.css` | Modify | 力度轨样式 |
| `test/studio.test.mjs` | Modify | `quantizeNotes` 的网格/强度/手别/边界测试 |

---

### Task 1: 量化纯函数（TDD）

- [ ] **Step 1: 写失败测试**（`test/studio.test.mjs`）

```js
test('quantizeNotes: 吸附到网格，strength 控制部分量化，hands 限定手别', () => {
  const mk = () => ({
    notes: [
      { id: 1, midi: 60, startBeats: 0.37, durBeats: 1, vel: 0.5, hand: 'R' },
      { id: 2, midi: 48, startBeats: 1.62, durBeats: 1, vel: 0.5, hand: 'L' },
    ],
  });
  const p = mk();
  const moved = quantizeNotes(p, { grid: 0.5, strength: 1 });
  assert.equal(moved, 2, '两个都应被移动');
  assert.equal(p.notes[0].startBeats, 0.5, '0.37 → 0.5');
  assert.equal(p.notes[1].startBeats, 1.5, '1.62 → 1.5');

  const half = mk();
  quantizeNotes(half, { grid: 0.5, strength: 0.5 });
  assert.ok(Math.abs(half.notes[0].startBeats - 0.435) < 1e-9, '部分量化只走一半');

  const onlyR = mk();
  quantizeNotes(onlyR, { grid: 0.5, strength: 1, hands: ['R'] });
  assert.equal(onlyR.notes[0].startBeats, 0.5, 'R 被量化');
  assert.ok(Math.abs(onlyR.notes[1].startBeats - 1.62) < 1e-9, 'L 不受影响');
});

test('quantizeNotes: 不产生负时间、不动时长与力度、脏输入不崩', () => {
  const p = { notes: [
    { id: 1, midi: 60, startBeats: 0.1, durBeats: 0.5, vel: 0.4, hand: 'R' },
    { id: 2, midi: 60, startBeats: 0, durBeats: 0.5, vel: 0.4, hand: 'R' },
  ] };
  const before = JSON.stringify(p.notes);
  quantizeNotes(p, { grid: 0.5, strength: 1 });
  for (const n of p.notes) assert.ok(n.startBeats >= 0, '不得为负');
  assert.equal(p.notes[0].durBeats, 0.5, '时长不应被改');
  assert.equal(p.notes[0].vel, 0.4, '力度不应被改');
  assert.ok(before.length > 0);
  assert.equal(quantizeNotes({ notes: [] }, { grid: 0.5 }), 0);
  assert.equal(quantizeNotes(null, { grid: 0.5 }), 0);
});
```

- [ ] **Step 2: 运行确认失败** → `quantizeNotes is not a function`
- [ ] **Step 3: 实现**

```js
/** 把 onset 吸附到网格。strength ∈ [0,1] 支持部分量化（DAW 惯例：可以「收一半」而不是二选一）。
 *  只动 onset —— 时长与力度是另外两个独立的编辑维度，量化不该顺手改它们。返回被移动的音符数。 */
export function quantizeNotes(piece, { grid = 0.25, strength = 1, hands = null } = {}) {
  if (!piece || !Array.isArray(piece.notes) || !piece.notes.length) return 0;
  const g = Math.max(1 / 64, Number(grid) || 0.25);
  const s = clamp(Number.isFinite(strength) ? strength : 1, 0, 1);
  if (s === 0) return 0;
  const only = Array.isArray(hands) && hands.length ? new Set(hands) : null;
  let moved = 0;
  for (const n of piece.notes) {
    if (only && !only.has(n.hand)) continue;
    const target = Math.max(0, Math.round(n.startBeats / g) * g);
    const next = n.startBeats + (target - n.startBeats) * s;
    if (Math.abs(next - n.startBeats) > 1e-9) moved++;
    n.startBeats = Math.max(0, next);
  }
  return moved;
}
```

- [ ] **Step 4: 运行确认通过**

---

### Task 2: 力度轨 UI

- [ ] **Step 1:** `index.html`：`.rollwrap` 内卷帘 canvas 之后加 `<canvas id="stVel" height="54">`；`.rolltransport` 加「量化」按钮与网格下拉。
- [ ] **Step 2:** `styles.css`：`#stVel` 与 `#stRoll` 同宽同缩放；`#stRoll { cursor: crosshair }` 保持。
- [ ] **Step 3:** `studio.js`：
  - `const VEL_H = 54`；`drawVel()` 画力度条（与 `drawRoll` 同样用 `piece.notes` 与 `ZOOM`）
  - `bindVelLane()`：`pointerdown` → `noteAt(beat, pitch)` 命中（y 范围用力度轨）→ 拖动时 `n.vel = clamp((laneBottom - y)/laneH, 0.15, 1)`；`pointerup` 走既有 `commit()`（自带 undo + autosave + `invalidateTension`）
  - 量化按钮 → `quantizeNotes(piece, {...})` 后 `invalidateTension(); drawRoll(); drawVel(); autosave()`，并把「移动了 N 个音符」放进 `stInfo`
- [ ] **Step 4:** 播放头：`.playhead` 已是 `top:0;bottom:0`，**无需改动**即覆盖两条轨。
- [ ] **Step 5:** 所有 `drawRoll()` 调用点旁边补 `drawVel()`（`commit` / `doUndo` / `doRedo` / `setPiece` / 回放开始）。

---

### Task 3: 验证

- [ ] **Step 1:** `npm test` 107 → **≥111**
- [ ] **Step 2:** `node --check`
- [ ] **Step 3:** 元素 id 契约（本轮新增 `stVel`、`stQuant`、`stQuantGrid`）
- [ ] **Step 4:** 决策指标 12 种子**逐位不变**（纯编辑层，不参与生成）
- [ ] **Step 5:** 同步 `AGENTS.md` / `MEMORY.md` / `README.md`

---

## 自检

- **规格覆盖**：量化 → Task 1；力度轨 UI → Task 2；验证 → Task 3。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`quantizeNotes(piece, opts) → number`；力度轨与卷帘共用 `ZOOM`/`piece.notes`，不引入新坐标系统。
