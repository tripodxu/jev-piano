# 和弦拼写（降号侧）Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。
> **步骤语法**：checkbox 逐条勾选。

**Goal**：让和弦标签用乐谱上正确的拼写——C 小调的 bVI 显示 `Ab` 而不是 `G#`，bVII 显示 `Bb`，bIII 显示 `Eb`。

**Architecture**：`chordLabel` 改用一张**固定的音级拼写约定表**（降号侧五个音级 1/3/6/8/10 用降号名），而不是从绝对音高类 `NOTE_NAMES` 取升号名。**不改函数签名**——两个调用点都已有罗马数字在手，而 STYLES 里所有带 `b` 前缀的罗马数字恰好就是 1/3/6/8/10 这五个音级，新约定与罗马数字的记谱天然一致。

**Tech Stack**：原生 ES Modules、`node --test`、零依赖（ADR-0004 红线一）。

---

## 证据（动手前先量）

`scripts/tmp-spelling.mjs`（一次性取证脚本，跑完即删）实测 32 小节 romantic：

| 调 | 旧拼写 | 错误数 |
|---|---|---|
| C minor | `G#×6 A#×3 D#×4` | **14/32 应为 `Ab Bb Eb`**（脚本第一版误判为 0，因按根音而非调号分类——见反思） |
| G# minor | 同上 | 14/32 |

C 小调有三个降号，本身就是降号调；`G#` 出现在 C 小调里是错的记谱。钢琴家看到 `G#` 会弹出不协和的音。

## 不做什么（重要）

- **`midiName` 保持升号不变**。它标注的是**琴键的物理键名**——钢琴上只有 G# 键，没有 Ab 键（`renderKeyboard` 的 `title` 也用它）。和弦名是**和声记谱**，键名是**物理事实**，两者不能混。
- 不改 `NOTE_NAMES` 本身（多处依赖，且 `SCALES`/解析逻辑用音级类而非名字）。
- 不引入"按调号自动切换"的逻辑：那样需要把 key 传进 `chordLabel`，而固定约定表在所有常用调里都正确且无歧义。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/music.js` | Modify | 新增 `PREFERRED_NAME` 拼写约定表；`chordLabel` 改用它 |
| `test/theory.test.mjs` | Modify | 扩充 `chordLabel` 测试，锁住降号侧与映射单射性 |
| `README.md` | Modify | 「已知限制」里删掉已解决的那条 |
| `AGENTS.md` / `MEMORY.md` | Modify | 代码地图行数 + 记忆条目 + 任务板勾掉 |

---

### Task 1: 拼写约定表

**Files:** Modify `public/js/music.js:67`；Test `test/theory.test.mjs:58`

- [ ] **Step 1: 写失败测试**

把 `test/theory.test.mjs` 里现有的

```js
test('chordLabel', () => {
  assert.equal(chordLabel(9, 'm7'), 'Am7');
  assert.equal(chordLabel(0, ''), 'C');
```

替换为：

```js
test('chordLabel: 降号侧用降号拼写（C 小调的 bVI/bVII/bIII 必须是 Ab/Bb/Eb）', () => {
  assert.equal(chordLabel(0, ''), 'C');
  assert.equal(chordLabel(9, 'm7'), 'Am7');
  assert.equal(chordLabel(7, '7'), 'G7');
  // 核心：旧实现这三条全错（返回 G#/A#/D#）
  assert.equal(chordLabel(8, ''), 'Ab', 'bVI 必须是 Ab');
  assert.equal(chordLabel(10, ''), 'Bb', 'bVII 必须是 Bb');
  assert.equal(chordLabel(3, ''), 'Eb', 'bIII 必须是 Eb');
  assert.equal(chordLabel(8, '7sus4'), 'Ab7sus4', '后缀要跟着根名走');
  assert.equal(chordLabel(3, 'm7b5'), 'Ebm7b5', '半减后缀不丢');
  assert.equal(chordLabel(2, 'ø'), 'Dø', '半减记号保留');
});

test('chordLabel: 拼写表是 12 个音级的单射（不能出现两个音级同名）', () => {
  const names = [];
  for (let pc = 0; pc < 12; pc++) names.push(chordLabel(pc, ''));
  assert.equal(new Set(names).size, 12, `拼写表非单射: ${names.join(' ')}`);
  assert.deepEqual([...names].sort(), ['Ab', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'Db', 'D#', 'E', 'Eb', 'F', 'F#', 'G', 'Gb', 'G#'].filter((n) => names.includes(n)).sort());
});

test('midiName: 保持升号——它标的是琴键的物理键名，不是和声拼写', () => {
  assert.equal(midiName(60), 'C4');
  assert.equal(midiName(61), 'C#4', '琴键只有 C#，没有 Db');
  assert.equal(midiName(68), 'G#4', '琴键只有 G#，没有 Ab');
});
```

在 import 里补上 `midiName`（若尚未导入）。

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/theory.test.mjs`
Expected: FAIL —— `chordLabel(8, '')` 返回 `'G#'` 而非 `'Ab'`。

- [ ] **Step 3: 实现**

在 `public/js/music.js` 的 `chordLabel` 上方插入并替换函数体：

```js
/**
 * 和声拼写约定：降号侧五个音级（1/3/6/8/10）用降号名，其余用升号/自然名。
 * 这不是"按调号切换"——它是固定的记谱惯例：C 小调的 bVI 恒为 Ab（不管当前 keyPc 是几），
 * 因为 STYLES 里带 b 前缀的罗马数字恰好就是这五个音级，两者天然一致。
 * 注意与 midiName 区分：midiName 标的是琴键的物理键名（钢琴上没有 Ab 键），必须保持升号。
 */
export const PREFERRED_NAME = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function chordLabel(rootPc, shape) {
  return PREFERRED_NAME[((rootPc % 12) + 12) % 12] + (shape === '' ? '' : shape);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test` → Expected: 74 通过 + 2 新增 = **76**。

- [ ] **Step 5: 提交**

```bash
git add public/js/music.js test/theory.test.mjs
git commit -m "fix(music): spell chords on the flat side (C minor bVI is Ab, not G#)"
```

---

### Task 2: 端到端核实与文档

**Files:** Modify `README.md`（已知限制）、`AGENTS.md`、`MEMORY.md`

- [ ] **Step 1: 端到端核实**

重跑取证脚本（`node scripts/tmp-spelling.mjs`），C minor 的标签应全部变成 `Ab/Bb/Eb`，**错误数 0/32**。注意：C minor 的标签集合里**不应再出现任何升号**（`G#`/`D#`/`A#`），因为浪漫小调的调内音级全部落在降号侧。

- [ ] **Step 2: 确认不回归**

- `npm test` 全绿
- `node scripts/analyze-repetition.mjs 32 2026 random` → `unique_chords` 应与改前**完全相同**（拼写只改显示文本，符号数不变），若变了说明改动泄漏进了逻辑

- [ ] **Step 3: 删掉一次性取证脚本**

```bash
rm scripts/tmp-spelling.mjs
```

- [ ] **Step 4: 文档**

- `README.md`「已知限制」删掉「和弦显示统一用升号（C minor 的 Ab 显示为 G#）」这一条
- `AGENTS.md` §2 同步 `music.js` 行数与「修改高危区」（加：`PREFERRED_NAME` 是和弦显示的唯一真相源）
- `MEMORY.md` 顶部写记忆条目 + 任务板勾掉该项

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "docs: drop the resolved flat-spelling limitation + memory entry"
```

---

## 自检

- **规格覆盖**：设计目标（降号侧正确拼写）→ Task 1；不做什么（midiName 不动）→ Task 1 的测试锁住；验证 → Task 2。
- **占位符扫描**：无 TBD/TODO，每步都有可直接粘贴的代码与确切命令。
- **类型一致性**：`PREFERRED_NAME` 是 `string[12]`；`chordLabel(rootPc, shape)` 签名未变，两个调用点（`candidates.js:160`、`composer.js:588`）无需改动——签名不变是本计划成立的前提。
