# jev-piano 仓库规范加固实施计划

> **For agentic workers:** 本计划按 superpowers:writing-plans 规范撰写，复选框 `- [ ]` 跟踪进度。执行方式：**inline（本会话逐任务执行）或 subagent 逐任务，每任务一次 git commit**。配套 skill：superpowers:executing-plans / superpowers:subagent-driven-development。执行前必读 [AGENTS.md](../../../AGENTS.md)（项目宪法）与 [MEMORY.md](../../../MEMORY.md)（最新记忆）。

**Goal:** 修复文档一致性问题（行数口径/错别字/计划归档），补齐仓库规范缺口（LICENSE / engines / CI），完成两处低风险代码修正（自动保存失败提示、死导出清理），并建立真实 Jev 的重复度基线——全部改动不动决策内核与音频链路。

**Architecture:** 纯增量加固，零行为风险：文档任务只改 Markdown；代码任务限定在 `studio.js` 一个新增纯函数 + `composer.js` 删除死代码（有全量 grep 证据）；CI 利用"零依赖 + node --test 直跑"特性免安装。反重复核心机制（候选集/权重/渲染）不在本计划内改动。

**Tech Stack:** 原生 ES Modules + node --test（无需 npm install）；GitHub Actions（ubuntu + Node 22）；MIT LICENSE。

---

## Phase 0: 已核实事实（文档发现产出，2026-09-28）

> 以下事实均由只读子代理实地取证（文件:行号 + 实跑命令），计划中的每个数字与代码片段以此为准，**执行时无需重新调研**。

| # | 事实 | 证据 |
|---|---|---|
| F1 | AGENTS.md 代码地图行数混用两种口径：music/jev/audio/player/midi/ui/settings 标注=非空行，composer/main/studio 标注=总行数。总行数实测：music 278、jev 211、composer 774、audio 133、player 116、midi 56、ui 187、main 273、studio 641、settings 20 | AGENTS.md:53-62 vs `(Get-Content f).Count` 实测 |
| F2 | MEMORY.md:19 错别字「节奏变典深化」；MEMORY.md:26「studio.js 641 行」= 总行数口径，与 F1 总行数一致 | MEMORY.md:19,26 |
| F3 | MVP 计划文档 42 个复选框全部 `[x]`，无任何"已完成/归档"标识 | plan:1-5 + 全文扫描 |
| F4 | 仓库无 LICENSE 文件（README 声称 MIT）；无 `.github/`；无任何 lockfile；`node_modules` 不存在；`node --test` 无依赖完整通过（46/46 实跑） | 根目录列举 + 实跑 |
| F5 | 仓库内唯一 Node 版本声称是计划文档「Node ≥ 18」（plan:9）；package.json 无 `engines`；本地 Node v24.9.0 | plan:9 / package.json |
| F6 | `scripts/analyze-repetition.mjs` 的 `--real` **已实现**（:8,18,46）：key 读 env→`.dev.vars` 正则回退；输出 13 项指标 JSON；花费 ≈ bars × $0.00006 | analyze-repetition.mjs:1-21,45-57 |
| F7 | studio 自动保存失败被 `catch { /* */ }` 静默吞掉，无用户提示；`toastify(msg)` 包装已存在（studio.js:196）；测试文件只测 8 个纯函数、无 DOM/localStorage mock、注入式可测 | studio.js:488-495 / test/studio.test.mjs:2-7 |
| F8 | `chordCriteria`（composer.js:217-219）全仓库零引用（nextBar 在 :654 内联构造）；composer.js 的 `STYLES`、`chordPcs` 为未用 import（:4-5）；composer.test.mjs:4 的 `mulberry32` 导入未使用 | 全仓 grep |
| F9 | composer.js 拆分的硬事实：4 条注释横幅分 5 区；候选函数在 117–262，6 问装配在 nextBar 内 616–693，渲染出口 385–528 依赖 264–383 的 8 个私有 helper；唯一集成点是 `nextBar()`；外部仅 `buildPlan`/`Composer` 被引用（main.js:2、studio.js:5、probe-bar.mjs:4、analyze-repetition.mjs:5、player.test.mjs:5） | composer.js 全文 + 全仓 grep |

**Allowed APIs（本计划可用）**：`node --test`（Node ≥18）、`actions/checkout@v4`、`actions/setup-node@v4`、`node --check <file>`、`git`、PowerShell `(Get-Content f).Count`。
**Anti-pattern 禁令**：不得发明 wrangler/GitHub Actions 不存在的参数；不得在 CI 里 `npm ci`（无 lockfile，F4）；不得改候选集/权重/渲染逻辑（本计划范围外）。

---

## Phase 1: 文档一致性（Task 1–2）

### Task 1: 统一 AGENTS.md 代码地图行数口径 + 修 MEMORY.md 错别字

**Files:** Modify `AGENTS.md`（§2 代码地图表 + 表头约定注）；Modify `MEMORY.md:19`

- [x] **Step 1: 重算总行数（建立单一口径）**

Run（PowerShell，工作目录 = 仓库根）：

```powershell
Get-ChildItem public\js\*.js | ForEach-Object { "{0}: {1}" -f $_.Name, (Get-Content $_.FullName).Count }
```

Expected: 输出十行，数字与 F1 的总行数列一致（music.js: 278 / jev.js: 211 / composer.js: 774 / audio.js: 133 / player.js: 116 / midi.js: 56 / ui.js: 187 / main.js: 273 / studio.js: 641 / settings.js: 20）。若某文件数字与 F1 不符，**以实跑值为准**并同步修正本计划后续步骤中的数字。

- [x] **Step 2: 替换 AGENTS.md 代码地图表**

将 AGENTS.md §2 表格的「行数」列整体替换为总行数口径，删除 `~` 前缀。替换后该表（职责列与高危区列原样保留，此处仅列需改的行）：

```markdown
| `music.js` | 278 | 乐理内核：罗马数字解析、和弦声位、音阶、8 种曲风预设、关键词计划 | `STYLES` 完整性被 `theory.test.mjs` 全量断言，改预设必跑测试 |
| `jev.js` | 211 | 四渠道客户端（fixture/typesafe/openrouter/proxy）、归一化、429/529 退避重试、fixture 采样、LLM 扩写 | `stripPrivate`：发送前剥离 `_` 前缀字段 |
| `composer.js` | 774 | **核心**：`buildPlan`、`Composer.nextBar()`（候选集 + 6 问 + 音符渲染 + 反重复六层机制） | 候选集权重、指纹护栏、根音疲劳断路器 |
| `audio.js` | 133 | 合成钢琴（三角波+泛音+包络+低通+生成式混响）、录音 | `envFor` 纯函数有单测 |
| `player.js` | 116 | lookahead 调度器（提前 2 小节），`now/setIntervalFn` 可注入 | 时钟注入契约被测试锁定 |
| `midi.js` | 56 | SMF Type-1 双轨导出 | 字节格式有单测 |
| `ui.js` | 187 | 键盘 DOM、下落音符 canvas、决策日志、计划卡、toast | — |
| `main.js` | 273 | 实时即兴接线：设置持久化、渠道探测、开始/停止/导出 | 元素 id 契约见 `index.html` |
| `studio.js` | 641 | 工作室界面：批量生成 job、钢琴卷帘编辑、Jev 路由的自然语言修改、JSON 导入导出 | 确定性编辑纯函数有单测 |
| `settings.js` | 20 | localStorage 设置读写 | — |
```

- [x] **Step 3: 在表格后追加口径约定**

在 §2「### 其他」之前插入：

```markdown
> 行数口径：**总行数**（`wc -l` 或 PowerShell `(Get-Content f).Count`，含空行）。改任何源文件后同步本表——这是 AGENTS.md 维护约定的一部分（见文末）。
```

- [x] **Step 4: 修 MEMORY.md 错别字**

`MEMORY.md:19`：「节奏变典深化」→「节奏变奏深化」。

- [x] **Step 5: 验证 + 提交**

Run: `git diff --stat` → 预期仅 `AGENTS.md`、`MEMORY.md` 两个文件。
Run: `npm test` → 预期 46/46 通过（文档任务不碰代码，作为回归确认）。

```bash
git add AGENTS.md MEMORY.md
git commit -m "docs: unify code-map line-count basis (total lines) and fix MEMORY typo"
```

**Anti-pattern 守卫**：不得把非空行与总行数混在同一张表；不得顺手改职责描述列（本次只碰行数）。

### Task 2: 归档 MVP 计划文档

**Files:** Modify `docs/superpowers/plans/2026-09-28-jev-piano-mvp.md:3`

- [x] **Step 1: 在文件头 blockquote 后插入状态横幅**

在 plan 第 3 行（`> **For agentic workers:** ...`）之后插入：

```markdown

> **状态：已完成并归档（2026-09-28，42/42 项复选框已勾选）。** 本文档是 MVP 的设计契约历史存档；新任务从 [AGENTS.md](../../../AGENTS.md) 与 [MEMORY.md](../../../MEMORY.md) 出发，不要把本文当活动计划执行。
```

- [x] **Step 2: 验证 + 提交**

Run: `grep -c "\[x\]" docs/superpowers/plans/2026-09-28-jev-piano-mvp.md` → 预期 `42`（确认横幅插入未破坏复选框计数）。
Run: `head -8 docs/superpowers/plans/2026-09-28-jev-piano-mvp.md` → 预期第 4-5 行为新横幅。

```bash
git add docs/superpowers/plans/2026-09-28-jev-piano-mvp.md
git commit -m "docs: archive completed MVP plan with status banner"
```

---

## Phase 2: 仓库规范缺口（Task 3–5）

### Task 3: 添加 MIT LICENSE

**Files:** Create `LICENSE`

- [x] **Step 1: 写 LICENSE（标准 MIT 文本）**

```text
MIT License

Copyright (c) 2026 tripodxu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [x] **Step 2: 验证 + 提交**

Run: `git add LICENSE && git status --short` → 预期 `A  LICENSE`；`grep -c "MIT License" LICENSE` → `1`。

```bash
git add LICENSE
git commit -m "chore: add MIT LICENSE (README already claims MIT)"
```

### Task 4: package.json 声明 engines

**Files:** Modify `package.json:4-6`

- [x] **Step 1: 插入 engines 字段**

将：

```json
  "private": true,
  "version": "0.1.0",
  "type": "module",
```

改为：

```json
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=18"
  },
```

（依据 F5：计划文档声称 Node ≥ 18 仅用于跑测试；不声明 wrangler 版本，因其只在部署时用。）

- [x] **Step 2: 验证 + 提交**

Run: `node -e "const p=require('./package.json'); if(!(p.engines&&p.engines.node)) process.exit(1); console.log('engines ok:', p.engines.node)"` → 预期 `engines ok: >=18`。
Run: `npm test` → 预期 46/46。

```bash
git add package.json
git commit -m "chore: declare engines node >=18 (tests need node:test)"
```

### Task 5: 添加 CI workflow（语法检查 + 单测）

**Files:** Create `.github/workflows/test.yml`

- [x] **Step 1: 写 workflow**

```yaml
name: tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # 零依赖项目：node --test 不需要 npm install（无 lockfile，测试零环境变量依赖，见计划 Phase 0 F4）
      - name: Syntax check (all JS/MJS)
        run: |
          for f in public/js/*.js src/worker.js scripts/*.mjs test/*.mjs; do
            node --check "$f" || exit 1
          done
      - name: Unit tests
        run: node --test
```

（Node 22 选型理由：engines 声明的下限是 18，22 是覆盖下限与本地开发版 v24 之间的 LTS 折中；若未来测试需要依赖，再补 `npm install` 并提交 lockfile。）

- [x] **Step 2: 本地预演 CI 的两个命令**

Run: `for f in public/js/*.js src/worker.js scripts/*.mjs test/*.mjs; do node --check "$f" || exit 1; done; echo "syntax ok"` → 预期 `syntax ok`（pwsh 下可用 `Get-ChildItem public\js\*.js, src\worker.js, scripts\*.mjs, test\*.mjs | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit 1 } }; echo "syntax ok"` 等价执行）。
Run: `node --test` → 预期 46/46。

- [x] **Step 3: 提交**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run syntax check + node --test on push/PR (zero-dependency, no npm install)"
```

- [x] **Step 4: 推送后验证 CI 实际变绿**（在 Task 9 统一推送后执行）

Run: `git push origin main` 后打开 `https://github.com/tripodxu/jev-piano/actions` → 预期 `tests` workflow 对最新 commit 显示绿勾；若红，点开日志按报错修复（最常见：某文件 `node --check` 语法错）。

**Anti-pattern 守卫**：不得加 `npm ci`/`npm install`（无 lockfile 必红）；不得用 `actions/setup-node` 的 `node-version-file`（package.json 无该字段语义）。

---

## Phase 3: 低风险代码修正（Task 6–7）

### Task 6: studio 自动保存失败提示（TDD）

**Files:** Modify `public/js/studio.js`（autosave 区）；Test `test/studio.test.mjs`

- [x] **Step 1: 写失败测试**

在 `test/studio.test.mjs` 的 import 列表（:2-7）中加入 `savePiece`：

```js
import {
  keywordAction, densifyHand, sparserHand, transposeNotes, scaleVel,
  chordAt, applyAction, validatePiece, savePiece,
} from '../public/js/studio.js';
```

在文件末尾追加：

```js
test('savePiece: 存储可用时写入并返回 true；不可用时返回 false 不抛错', () => {
  const ok = { setItem(k, v) { this.k = k; this.v = v; } };
  assert.equal(savePiece({ version: 1, notes: [] }, ok), true);
  assert.equal(ok.k, 'jevpiano.studio.v1');
  assert.equal(JSON.parse(ok.v).version, 1);
  const boom = { setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(savePiece({ version: 1, notes: [] }, boom), false);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/studio.test.mjs` → 预期 FAIL：`savePiece is not a function`（或 SyntaxError: does not provide an export named 'savePiece'）。

- [x] **Step 3: 实现 savePiece 并接入 autosave**

在 `public/js/studio.js` 的 `toastify` 定义（:196）之后插入：

```js
/** 自动保存写入：存储不可用（隐私模式/配额满）时返回 false，由调用方提示用户 */
export function savePiece(piece, storage) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(piece));
    return true;
  } catch {
    return false;
  }
}
```

将 autosave 的定时器体（:491-494）：

```js
  saveTimer = setTimeout(() => {
    if (!piece) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...piece, bpm: Number(els.bpm.value) })); } catch { /* */ }
  }, 500);
```

改为：

```js
  saveTimer = setTimeout(() => {
    if (!piece) return;
    if (!savePiece({ ...piece, bpm: Number(els.bpm.value) }, localStorage)) {
      toastify('自动保存失败：浏览器存储不可用（隐私模式或空间已满），请及时导出 JSON 备份');
    }
  }, 500);
```

（恢复路径 :188-193 的静默 catch **不动**：损坏的旧存档静默弃之、干净起步是刻意选择。）

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/studio.test.mjs` → 预期全部 PASS（含新测试）。
Run: `npm test` → 预期 **47/47**（46 + 新增 1）。

- [x] **Step 5: 提交**

```bash
git add public/js/studio.js test/studio.test.mjs
git commit -m "feat(studio): surface autosave storage failures via toast (savePiece, tested with injected storage)"
```

**Anti-pattern 守卫**：`savePiece` 的 storage 参数**不给默认值**（Node 无 `localStorage` 全局，默认值会在测试里抛 ReferenceError）；不得在本任务顺手改 restore 路径或编辑变换。

### Task 7: 清理 composer.js 死导出与未用 import

**Files:** Modify `public/js/composer.js`（:3-7 import、:216-219）；Modify `test/composer.test.mjs:4`

- [x] **Step 1: 先证明是死代码（grep 证据）**

Run: `grep -rn "chordCriteria" --include="*.js" --include="*.mjs" --include="*.html" .` → 预期仅 `public/js/composer.js:217` 定义行一处（无调用方）。
Run: `grep -n "STYLES\|chordPcs" public/js/composer.js` → 预期仅 :4-5 import 行（无使用）。

- [x] **Step 2: 删除 chordCriteria 函数**

删除 `public/js/composer.js:216-219`：

```js
/** 和弦音功能描述（Jev criteria / fixture 共用） */
export function chordCriteria(cands) {
  return Object.fromEntries(cands.map((c) => [c.sym, c.desc]));
}
```

（nextBar 在 :654 已内联同样逻辑；git 历史保留可恢复。）

- [x] **Step 3: 收紧 import**

将 composer.js:3-6：

```js
import {
  STYLES, STYLE_BY_ID, LH_DEFS, RHYTHM_POOLS, NOTE_NAMES,
  parseRoman, chordLabel, chordPcs, chordMidis, scaleMidis, nearest, lhVoicing, midiName, keywordPlan,
} from './music.js';
```

改为：

```js
import {
  STYLE_BY_ID, LH_DEFS, RHYTHM_POOLS, NOTE_NAMES,
  parseRoman, chordLabel, chordMidis, scaleMidis, nearest, lhVoicing, midiName, keywordPlan,
} from './music.js';
```

- [x] **Step 4: 删测试文件里的未用导入**

将 `test/composer.test.mjs:4`：

```js
import { buildPlan, Composer, mulberry32, detectLoop, chordCandidates } from '../public/js/composer.js';
```

改为：

```js
import { buildPlan, Composer, detectLoop, chordCandidates } from '../public/js/composer.js';
```

（`mulberry32` 在测试体内未使用；`test/rng-shim.mjs` 的同名实现供 theory 测试用，二者关系见其文件头注释，不合并。）

- [x] **Step 5: 验证 + 提交**

Run: `node --check public/js/composer.js && node --check test/composer.test.mjs && echo ok` → 预期 `ok`。
Run: `npm test` → 预期 47/47。
Run: `grep -rn "chordCriteria" --include="*.js" --include="*.mjs" .` → 预期 0 匹配。

```bash
git add public/js/composer.js test/composer.test.mjs
git commit -m "refactor(composer): drop dead chordCriteria export and unused imports (STYLES, chordPcs)"
```

---

## Phase 4: 真实 Jev 重复度基线（Task 8，计费 ~$0.002）

### Task 8: 运行 --real 并记录基线

**Files:** Modify `README.md`（反重复表）；Create `docs/memory/2026-09-28-real-jev-repetition-baseline.md`；Modify `MEMORY.md`（顶部新条目）

- [x] **Step 1: 确认 key 可用**

Run: `node -e "const k=process.env.TYPESAFE_API_KEY; console.log(k?'env key ok':'no env key')"` → 有 env key 走 Step 2；否则确认 `.dev.vars` 含 `TYPESAFE_API_KEY=`（脚本 :13-16 会自动回退读取）。
**若两者都没有：跳过 Step 2–3，只在 MEMORY.md 记一条「真实基线待补（无 key）」，其余步骤全部完成，本任务标记为阻塞待补。**

- [x] **Step 2: 跑真实 Jev 重复度分析**

Run: `node scripts/analyze-repetition.mjs 32 2026 random --real` → 预期输出一行 JSON，含 `channel:"typesafe"` 与 13 项指标（`melody_unique_bars`/`melody_adjacent_repeat`/`lh_unique_bars`/`unique_chords`/`interval_entropy`/`leap_ratio` 等；字段定义见脚本 :45-57）。花费 ≈ 32 × $0.00006 ≈ $0.002。

- [x] **Step 3: 记录基线**

把 Step 2 的 JSON 中六个核心指标追加到 `README.md`「反重复设计（量化验证）」表格之后，作为新行：

```markdown
真实 Jev 渠道复测（`--real`，2026-09-28）：旋律唯一小节 <值>/32 · 左手唯一小节 <值>/32 · 和弦种类 <值> · 音程熵 <值> · 跳进占比 <值> · 相邻字面重复 <值>。
```

（尖括号用实测值替换；任一指规划级恶化——相邻重复 >0 或和弦种类 <8——先停下在 MEMORY.md 记阻塞，不要继续提交。）

- [x] **Step 4: 写记忆条目并提交**

新建 `docs/memory/2026-09-28-real-jev-repetition-baseline.md`（格式见该目录 README）：记录命令、完整 JSON、与 fixture 口径的差异结论。在 `MEMORY.md` 顶部（最新在上）加压缩条目。

```bash
git add README.md docs/memory/2026-09-28-real-jev-repetition-baseline.md MEMORY.md
git commit -m "docs: real-Jev repetition baseline (analyze-repetition --real)"
```

---

## Phase 5: 验证与收尾（Task 9）

### Task 9: 全量验证 + 推送 + 记忆闭环

- [x] **Step 1: 全量测试**

Run: `npm test` → 预期 **47/47** 通过、0 fail。

- [x] **Step 2: 反模式扫描**

Run: `git status --short` → 预期无 `.dev.vars`、无 `node_modules`、无 `__pycache__` 被追踪/暂存。
Run: `grep -rn "TODO\|FIXME\|TBD" LICENSE .github AGENTS.md MEMORY.md docs/adr docs/CONTEXT.md` → 预期 0 匹配（本计划产物不留占位符）。
Run: `git log --oneline -8` → 预期本计划 7 个 commit 按序在顶（docs: unify / docs: archive / chore: LICENSE / chore: engines / ci: / feat(studio) / refactor(composer) / docs: real-jev）。

- [x] **Step 3: 推送并验证 CI**

Run: `git push origin main` → 预期 `main -> main`。
Run: 打开 `https://github.com/tripodxu/jev-piano/actions` → 预期最新 commit 的 `tests` 绿勾（Task 5 Step 4 的闭环）。

- [x] **Step 4: 记忆闭环（AGENTS.md 收尾三件事）**

在 `MEMORY.md` 顶部（最新在上）追加本计划完成条目：做了什么（7 commit 清单）/ 为什么 / 坑（口径混用、--real 已存在、死导出）/ 验证（47/47 + CI 绿 + --real 基线值）/ 下一步（composer 拆分独立计划、P3 待办）。

```bash
git add MEMORY.md
git commit -m "docs: memory entry for repo-hardening batch"
git push origin main
```

---

## 不在本计划内（已评估，明确 defer）

### A. composer.js 拆分 → 建议独立计划

事实依据 F9：候选函数（117–262）、6 问装配（nextBar 内 616–693）、渲染出口（385–528，依赖 264–383 的 8 个私有 helper）三块交织，唯一集成点是 `nextBar()`；外部只依赖 `buildPlan`/`Composer`。
**建议的独立计划形状**（届时再写，不在本计划执行）：拆出 `composer-candidates.js`（候选函数 + ROMAN_BY_PC + ROOT_ROLE/ARC_CURVES）与 `composer-render.js`（8 个私有 helper + renderMelody/renderLH + CONTOURS），`composer.js` 保留 `buildPlan`/`Composer` 并**再导出**两侧符号——再导出 shim 保证 main.js/studio.js/scripts/test 的 import 一行不改，13 个 composer 测试 + player 测试先行全绿后再逐块迁移。触发条件：composer.js 再增长 ~100 行，或下次需要改候选权重时顺手拆。

### B. P3 待办（记录进任务板即可）

- PR/issue 模板（`.github/PULL_REQUEST_TEMPLATE.md` 等）——多人多 agent 协作时再加
- `dev-proxy.py` 测试覆盖——Python 侧零覆盖，价值低于 CI 已覆盖的 JS 侧

---

## Self-Review（写计划后自查）

1. **Spec 覆盖**：P0 三项（行数口径✓Task 1、错别字✓Task 1、pycache 本地残留→删本地文件即可，ignore 已生效无需 commit）→ P1 四项（LICENSE✓Task 3、CI✓Task 5、engines✓Task 4、计划归档✓Task 2）→ P2 三项（拆分→独立计划 A、autosave 提示✓Task 6、真实基线✓Task 8）→ P3→B。全部有着落。
2. **占位符扫描**：无 TBD；每个代码步骤有完整代码；每个命令有预期输出。（Task 8 的 `<值>` 是**记录槽位**而非计划占位符——由实跑结果填充，已写明。）
3. **类型/命名一致性**：`savePiece(piece, storage)` 在测试、实现、调用点三处签名一致；`toastify` 用既有包装（studio.js:196）；测试数从 46→47 在 Task 6/9 两处一致；`chordCriteria` 删除后全仓 0 引用有 grep 验证步骤。
4. **与项目宪法一致性**：每任务 1–3 文件、一任务一 commit、收尾三件事（Task 9 Step 4）——符合 AGENTS.md §3.2。
