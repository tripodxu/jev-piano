# AGENTS.md — 给所有协作 Agent 的项目宪法

> **本文件是所有 agent（人类或 AI）接触本仓库的第一站，也是唯一必读文件。**
> 读完这里，按「阅读地图」只读你任务需要的部分——**不要全量阅读项目**。
> 人的快速入口是 [README.md](README.md)；领域词汇查 [docs/CONTEXT.md](docs/CONTEXT.md)；
> 历史决策查 [docs/adr/](docs/adr/)；项目记忆查 [MEMORY.md](MEMORY.md) / [docs/memory/](docs/memory/)（最新在最上）。

---

## 0. 30 秒认识这个项目

jev-piano 是一个**零框架、零构建、零运行时依赖**的纯静态前端：用户给一句话，LLM（可选）扩写成乐章计划，**Jev 模型每小节做一次结构化决策**（7 问并行），确定性代码把决策渲染成音符，Web Audio 边决策边演奏。一条 `wrangler deploy` 部署到 Cloudflare Workers。

核心架构模式（**不可动摇**）：**模型只做选择，代码只做渲染**——Jev 永远在代码生成的有限候选集里挑选，非法和声/非法着法不可表示。完整架构见 README「架构」一节与 [docs/adr/0001](docs/adr/0001-model-chooses-code-writes.md)。

```text
public/js/music.js       乐理内核（候选集的来源：罗马数字/声位/音阶/曲风/和声功能/调式色板）
public/js/candidates.js  候选集构造（给模型的可选域 + 两条反重复断路器 + 声部进行加权）
public/js/composer.js    决策器（七问 + 渲染内核 + 动机记忆 + 双声部指纹护栏）
public/js/jev.js         Jev 客户端（4 渠道 + fixture 同构兜底）
public/js/player.js      lookahead 调度器（提前 2 小节决策）
public/js/audio.js       合成钢琴
public/js/ui.js/main.js/studio.js  三个界面层（含和声功能轨）
src/worker.js            生产 Worker（静态资产 + /api/probe|jev|llm）
```

---

## 1. 阅读地图（按任务取书，禁止全量阅读）

| 你的任务 | 必读 | 按需 |
|---|---|---|
| 改乐理/曲风/和弦候选 | `public/js/music.js`、`public/js/candidates.js`、`test/theory.test.mjs`、`test/candidates.test.mjs` | `docs/CONTEXT.md` §和声 |
| 改决策器/渲染内核 | `public/js/composer.js`、`test/composer.test.mjs`、`docs/adr/0003` | `docs/superpowers/plans/2026-09-28-jev-piano-mvp.md` §三 |
| 改 Jev 客户端/渠道 | `public/js/jev.js`、`test/jev.test.mjs`、`src/worker.js` | `docs/research/jevthoven-调研.md` |
| 改实时播放/调度 | `public/js/player.js`、`test/player.test.mjs` | — |
| 改音频/音色 | `public/js/audio.js`、`test/audio.test.mjs` | — |
| 改实时界面 | `public/js/ui.js`、`public/js/main.js`、`public/index.html` | `public/styles.css` |
| 改工作室界面 | `public/js/studio.js`、`test/studio.test.mjs` | `docs/memory/2026-09-28-studio-view.md` |
| 改 Worker/部署 | `src/worker.js`、`wrangler.toml`、`.dev.vars.example` | README「部署」 |
| 修重复/听感问题 | `public/js/candidates.js`、`scripts/analyze-repetition.mjs`、`docs/memory/2026-09-28-anti-repetition-overhaul.md` | `composer.js` 渲染内核 |
| 纯文档任务 | 本文件 + `README.md` + `MEMORY.md` | — |

> **经验法则：一个任务动 1–3 个源文件 + 对应测试，就够了。** 动第三个以上文件时，回读本表确认没有漏掉契约方。

---

## 2. 代码地图（职责锁定，改动前先认领）

### public/js/ — 前端 ES Modules（浏览器，无构建）

| 文件 | 行数 | 职责 | 修改高危区 |
|---|---|---|---|
| `music.js` | 344 | 罗马数字解析、和弦声位、音阶、8 种曲风预设、关键词计划、**和声功能分类 + 调式全色板**（`functionOf`/`modePalette`） | `STYLES` 完整性被 `theory.test.mjs` 全量断言，改预设必跑测试；`PALETTE_QUALITY` 决定色板的"质"，改它等于改全项目词汇 |
| `candidates.js` | 231 | **候选集构造**（= 给模型的可选域）：`detectLoop` 循环锁死检测、`chordCandidates` 两条断路器（根音疲劳 / 循环锁死）+ 声部进行加权（共同音/五度圈）、`functionCandidates` 功能转移矩阵 | 兜底判据是「候选够用 ≥3」不是「非空」；`W_SMOOTH` 锁在 0.5（调低会让旋律指纹护栏失效）；断路器取舍先放疲劳、留锁死 |
| `jev.js` | 211 | 四渠道客户端（fixture/typesafe/openrouter/proxy）、归一化、429/529 退避重试、fixture 采样、LLM 扩写 | `stripPrivate`：发送前剥离 `_` 前缀字段 |
| `composer.js` | 668 | **核心**：`buildPlan`、`Composer.nextBar()`（七问 + 音符渲染 + 反重复机制）、动机记忆、归因字段 `loopLocked`/`rejected`/`fn`/`chordFn` | 候选集**不在**本文件（在 `candidates.js`）；旋律护栏必须在乐句尾锚定**之后**判定碰撞 |
| `audio.js` | 133 | 合成钢琴（三角波+泛音+包络+低通+生成式混响）、录音 | `envFor` 纯函数有单测 |
| `player.js` | 116 | lookahead 调度器（提前 2 小节），`now/setIntervalFn` 可注入 | 时钟注入契约被测试锁定 |
| `midi.js` | 56 | SMF Type-1 双轨导出 | 字节格式有单测 |
| `ui.js` | 246 | 键盘 DOM、下落音符 canvas、**和声功能轨**（`pushFnSegment`/`fnSegClass`）、决策日志、计划卡、toast | 功能轨的类名映射有单测锁住；`chordFn` 缺失/非法必须降级为主功能 |
| `main.js` | 273 | 实时即兴接线：设置持久化、渠道探测、开始/停止/导出 | 元素 id 契约见 `index.html` |
| `studio.js` | 653 | 工作室界面：批量生成 job、钢琴卷帘编辑、Jev 路由的自然语言修改、JSON 导入导出 | 确定性编辑纯函数有单测 |
| `settings.js` | 20 | localStorage 设置读写 | — |

> 行数口径：**总行数**（`wc -l` 或 PowerShell `(Get-Content f).Count`，含空行）。改任何源文件后同步本表——这是 AGENTS.md 维护约定的一部分（见文末）。

### 其他

| 路径 | 职责 |
|---|---|
| `src/worker.js` | CF Worker：静态资产 + `/api/probe` `/api/jev` `/api/llm`；Jev 后端链式降级；每 IP 限流；`/api/llm` 封闭转发（防 SSRF，只认服务端 env） |
| `test/*.test.mjs` | `node --test`，共 74 个。**纯逻辑可测；浏览器行为靠人工冒烟** |
| `scripts/probe-jev.mjs` `scripts/probe-bar.mjs` | 真实 API 冒烟（需 key，计费） |
| `scripts/analyze-repetition.mjs` | 重复度量化分析（`node scripts/analyze-repetition.mjs 32 <seed> random [--real]`）。**单种子噪声大，结论至少取 12 个种子求均值** |
| `dev-proxy.py` | 本地开发：静态服务 + mock/真实转发（stdlib only） |
| `docs/superpowers/plans/` | 原始 MVP 实施计划（设计契约的详细出处） |

---

## 3. 协作协议（多 agent 并行）

### 3.1 任务粒度与领地

- **一个任务 = 一个可独立验证的目标**，写入 `docs/memory/` 的任务板条目（见 §4）。
- **领地声明**：任务描述里必须写明涉及的文件清单；两个 agent 的文件清单有交集时，后到者等待或合并任务——**禁止并行改同一文件**。
- 安全并行示例：A 改 `composer.js`+其测试，B 改 `studio.js`+其测试，C 写文档。

### 3.2 工作流（每个 agent 每次任务）

```text
1. 读 AGENTS.md（本文件）→ 按阅读地图读必要文件
2. 读 MEMORY.md 顶部 3 条 + 任务相关 memory 条目（最新在最上，先看有没有人踩过坑）
3. 实现：先改/加测试，再改实现（本项目测试驱动传统，见 docs/adr/0004）
4. 验证关卡（全部通过才算完成）：
   a. npm test                        全绿（74 个，只增不减）
   b. node --check 改动的新 .js        语法
   c. 涉及真实 API 的：scripts/probe-*.mjs 冒烟（可选，计费）
   d. 涉及听感/反重复的：analyze-repetition.mjs 对比指标不退化
5. git commit（ conventional 前缀，见 §3.3），一个任务一个 commit
6. 收尾三件事（缺一件不算完成）：
   - 在 MEMORY.md 顶部追加本次记忆条目（最新在最上）
   - 如有跨会话价值，在 docs/memory/ 建当日条目
   - 若改变了架构/契约，补一篇 docs/adr/
```

### 3.3 提交规范

```
<type>: <一句话摘要>            # type ∈ feat|fix|docs|refactor|test|chore
```

- 摘要用英文或中文均可，但必须**说清"改了什么行为"**，不写 "update" "fix bug" 这类空话。
- 参考 `git log --oneline` 里的历史风格（如 `feat: studio view (second interface) - ...`）。
- **绝不提交**：密钥（`.dev.vars`）、依赖、缓存、agent 本地状态（见 `.gitignore` 与 §5）。

---

## 4. 接力协议（多 agent 任务交接）

当一个 agent 的任务未完成、或需要另一个 agent 接着做时，**在任务板留下标准接力条**，而不是只在聊天里说。

### 4.1 任务板

- 位置：`docs/memory/` 目录内由当前负责人维护的「进行中」段落（MEMORY.md 顶部即任务板）。
- 每条任务：`状态`（待办/进行中/阻塞/完成）+ 负责人 + 文件领地 + 验收标准。

### 4.2 接力条格式（写入 MEMORY.md 顶部或 PR 描述）

```markdown
## [进行中] <任务名> · <日期>
- **目标**：<一句话，可验证>
- **进度**：<已完成/未完成，具体到文件与函数>
- **下一步**：<下一个 agent 第一件事做什么，精确到文件:行 或函数名>
- **已知坑**：<踩过的坑、被否决的方案及原因>
- **验收**：npm test 全绿 + <任务特有的检查>
- **领地**：<文件清单>
```

### 4.3 接力的 agent 必须

1. 先读接力条，再读其中点名的文件——**不要从头全量读项目**；
2. 继承「已知坑」，不重复踩；
3. 完成后把接力条转为「完成」并写入记忆（最新在最上），接力条可以删除或归档到 `docs/memory/` 当日条目。

---

## 5. 红线（违反即回退）

1. **禁止引入框架/构建/运行时依赖**。原生 ES Modules + Web Audio 是架构基石（ADR-0004）。新增 npm 依赖需要一篇 ADR 说服。
2. **禁止把密钥写进任何被追踪文件**。`.dev.vars` 只在本地；仓库只有 `.dev.vars.example`。
3. **禁止绕过候选集直接生成音符**。任何"让模型自由发挥"的设计都违背 ADR-0001/0003；模型永远在代码给的候选里选。
4. **禁止删测试**。测试只增不减；改行为先改测试。
5. **禁止提交 agent 本地状态**（`.workbuddy/`、`.claude/`、`.work/`、`*.agent-state.json` 等，见 `.gitignore`）。持久真相只进 `docs/` 与 `MEMORY.md`。
6. **fixture 与真实 Jev 必须同构**（同候选集、同权重，ADR-0002）。改候选权重时两边一起改。
7. **播放永不中断**：任何真实 API 失败路径必须回落到 fixture，不允许 throw 到用户界面。

---

## 6. 常用命令

```bash
npm test                                  # 74 个单测（node --test）
python dev-proxy.py --port 8000           # 本地开发（或 npm run dev）→ http://127.0.0.1:8000
node scripts/analyze-repetition.mjs 32 2026 random   # 重复度指标（结论至少 12 种子求均值）
node scripts/probe-jev.mjs                # 真实 API 冒烟（需 TYPESAFE_API_KEY）
npx wrangler deploy                       # 部署（或 npm run deploy）
```

---

*维护约定：本文件随架构演进而更新；任何对 §2 代码地图的修改必须在同一次 commit 完成，避免地图腐化。*
