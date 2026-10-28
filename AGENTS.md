# AGENTS.md — 给所有协作 Agent 的项目宪法

> **本文件是所有 agent（人类或 AI）接触本仓库的第一站，也是唯一必读文件。**
> 读完这里，按「阅读地图」只读你任务需要的部分——**不要全量阅读项目**。
> 人的快速入口是 [README.md](README.md)；领域词汇查 [docs/CONTEXT.md](docs/CONTEXT.md)；
> 历史决策查 [docs/adr/](docs/adr/)；项目记忆查 [MEMORY.md](MEMORY.md) / [docs/memory/](docs/memory/)（最新在最上）。

---

## 0. 30 秒认识这个项目

jev-piano 是一个**零框架、零构建、零运行时依赖**的纯静态前端：用户给一句话，LLM（可选）扩写成乐章计划，**Jev 模型每小节做一次结构化决策**（8 问并行），确定性代码把决策渲染成音符，Web Audio 边决策边演奏。一条 `wrangler deploy` 部署到 Cloudflare Workers。

核心架构模式（**不可动摇**）：**模型只做选择，代码只做渲染**——Jev 永远在代码生成的有限候选集里挑选，非法和声/非法着法不可表示。完整架构见 README「架构」一节与 [docs/adr/0001](docs/adr/0001-model-chooses-code-writes.md)。

```text
public/js/music.js       乐理内核（候选集的来源：罗马数字/声位/音阶/曲风/和声功能/调式色板）
public/js/render.js      渲染内核（旋律/左手织体/动机发展/反重复护栏，纯函数）
public/js/candidates.js  候选集构造（给模型的可选域 + 两条反重复断路器 + 声部进行加权）
public/js/composer.js    决策器（八问 + 渲染内核 + 动机记忆 + 双声部指纹护栏）
public/js/jev.js         Jev 客户端（4 渠道 + fixture 同构兜底）
public/js/player.js      lookahead 调度器（提前 2 小节决策）
public/js/audio.js       合成钢琴
public/js/ui.js/main.js/studio.js  三个界面层（功能轨、段落标注、决策日志、图例、台账）
public/js/studio-roll.js  工作室卷帘视图（绘制/指针交互/hover/分析缓存；只画不决策）
public/js/canvas.js      canvas 可视化三件套（下落音符/张力对照带/动机卡；零 import，只画不决策）
public/js/tension.js     分析层：音乐张力（只读，不参与决策）
public/js/nct.js         分析层：非和声音分类（只读，不参与决策）
public/js/cadence.js     分析层：终止式识别（只读，不参与决策）
public/js/kbd.js          电脑键盘弹奏（A–L 白键/上行黑键/ZX 换八度；两界面共用）
src/worker.js            生产 Worker（静态资产 + /api/probe|jev|llm）
```

---

## 1. 阅读地图（按任务取书，禁止全量阅读）

| 你的任务 | 必读 | 按需 |
|---|---|---|
| 改乐理/曲风/和弦候选 | `public/js/music.js`、`public/js/candidates.js`、`test/theory.test.mjs`、`test/candidates.test.mjs` | `docs/CONTEXT.md` §2 乐理域 |
| 改曲式/段落/弧线 | `public/js/candidates.js`（`FORM_TEMPLATES`/`deriveSections`/`sectionAt`/`intensityTarget`/`developCandidates`）、`public/js/composer.js`（`buildPlan`/`sanitizeSections`/段落标志） | `public/js/jev.js`（LLM 提示词的 `sections` 字段） |
| 改决策器/渲染内核 | `public/js/composer.js`、`test/composer.test.mjs`、`docs/adr/0003` | `docs/superpowers/plans/2026-09-28-jev-piano-mvp.md` §三 |
| 改 Jev 客户端/渠道 | `public/js/jev.js`、`test/jev.test.mjs`、`src/worker.js` | `docs/research/jevthoven-调研.md` |
| 改实时播放/调度 | `public/js/player.js`、`test/player.test.mjs` | — |
| 改音频/音色 | `public/js/audio.js`、`test/audio.test.mjs` | — |
| 改实时界面 | `public/js/ui.js`、`public/js/main.js`、`public/index.html` | `public/js/canvas.js`（下落音符/张力带/动机卡）、`test/ui.test.mjs`（canvas 能耗契约与转出契约都在这里）、`public/styles/`（分层样式，见 §2.1）、`test/style-contract.test.mjs`（设计系统契约）、`candidates.js`（`planTargetSeries`/段落）、`composer.js`（`plan.sections`） |
| 改样式 / 设计语言 | **`public/styles/tokens.css`（先改这里）**，再动对应层文件 | `test/style-contract.test.mjs`（变量定义、层序、裸值、类名四道红灯）、`public/js/*.js`（类名来源） |
| 改工作室界面 | `public/js/studio.js`（状态与工作流）、`public/js/studio-roll.js`（卷帘视图）、`public/js/studio-core.js`、`test/studio.test.mjs`、`test/studio-roll.test.mjs`、`docs/memory/2026-09-28-studio-view.md` | `public/js/tension.js`（张力）、`public/js/nct.js`（非和声音 id）、`public/js/music.js`（`functionOfPc`） |
| 改 Worker/部署 | `src/worker.js`、`wrangler.toml`、`.dev.vars.example` | README「部署」 |
| 修重复/听感问题 | `public/js/candidates.js`、`scripts/analyze-repetition.mjs`、`docs/memory/2026-09-28-anti-repetition-overhaul.md` | `composer.js` 渲染内核 |
| 加"看得见"的音乐分析 | `public/js/tension.js`、`public/js/nct.js`、`public/js/cadence.js` | 对应 `test/*.test.mjs`、`ui.js` 渲染、`main.js` 喂数 |
| 纯文档任务 | 本文件 + `README.md` + `MEMORY.md` | — |

> **经验法则：一个任务动 1–3 个源文件 + 对应测试，就够了。** 动第三个以上文件时，回读本表确认没有漏掉契约方。

---

## 2. 代码地图（职责锁定，改动前先认领）

### public/js/ — 前端 ES Modules（浏览器，无构建）

| 文件 | 行数 | 职责 | 修改高危区 |
|---|---|---|---|
| `music.js` | 386 | 罗马数字解析、和弦声位、音阶、9 种曲风预设（含蓝调，轮次 58）、关键词计划、**和声功能分类 + 调式全色板**（`functionOf`/`functionOfPc`/`modePalette`）、**和声拼写约定**（`PREFERRED_NAME`）、**和弦角色**（`chordRole`：和弦音按位置（根/三/五/七/九音）、外音按音程——轮次 55 跟弹回声的内核） | `STYLES` 完整性被 `theory.test.mjs` 全量断言，改预设必跑测试；`PALETTE_QUALITY` 决定色板的"质"，改它等于改全项目词汇；`PREFERRED_NAME` 是和弦显示的唯一真相源——**但 `midiName` 必须保持升号**（它标的是琴键的物理键名，钢琴上没有 Ab 键） |
| `candidates.js` | 357 | **候选集构造**（= 给模型的可选域）+ **曲式**：两条断路器、声部进行加权、功能转移矩阵、`FORM_TEMPLATES`/`deriveSections`/`sectionAt`/段落感知 `intensityTarget`/`planTargetSeries`、速度弧线 `tempoMultAt`、**`developCandidates`（段落首偏承袭）** | 兜底判据是「候选够用 ≥3」不是「非空」；`W_SMOOTH` 锁在 0.5；断路器取舍先放疲劳、留锁死；**`rise` 曲式的 Coda level 必须高于 A**；**段落首 `repeat += 1.6` / `new *= 0.3` 是锁值**（改了 A→A' 的再现关系就没了） |
| `render.js` | 403 | **渲染内核**：旋律渲染（轮廓/锚定/摇摆/人味）、左手 11 种织体（block/ballad 带声部抽稀变体）、动机发展四手法、反重复护栏（指纹/变形）；全部纯函数（rng 注入），只依赖 `music.js` |
| `jev.js` | 229 | 四渠道客户端（fixture/typesafe/openrouter/proxy）、归一化、429/529 退避重试、fixture 采样、LLM 扩写（**系统二：可选的 sections 字段 = 曲式规划**） | `stripPrivate`：发送前剥离 `_` 前缀字段；**提示词的曲风/调式清单从 STYLES 派生，禁止字面量**（轮次 62 前字面量漏了 blues，LLM 扩写永远选不了蓝调）；`expandPlan` 有默认 12s 超时（挂住的端点不再楔死 buildPlan） |
| `composer.js` | 551 | **决策器**：`buildPlan`（**曲式 `sections`**）、`Composer.nextBar()`（八问 + 强度连续化 + 段落边界语义 + 动机调度 + **决策预算**）、动机记忆、决策归因字段（软层指纹 `SIG_MEMORY_CAP`=2000 上限，轮次 64——长会话护栏）；渲染细节在 `render.js` | 候选集与曲式都不在本文件；旋律护栏必须在乐句尾锚定**之后**判定碰撞；`INTENSITY_DEV`/`INTENSITY_SLEW` 锁值；**发展手法的素材来源有分工**：`repeat` 用动机、其余用 `prevMelody`；**「呼吸」是时值指令（`breatheDelay` 延后进入）不是否决指令**——四条变形手法在有呼吸时也必须用上素材，兜底走 `fresh()` 后**归因强制改为 `new`**；左手护栏重试 6 次仍撞车则去掉末音；**实时 `nextBar({budget})` 把决策时间交给音频时钟封顶**——预算先耗尽则该小节 fixture 顶替（`decision.deadlineMiss`），下一小节重试真实渠道；**只有预算耗尽才走 fixture，真实答案先到必须用真实的** |
| `audio.js` | 136 | 合成钢琴（三角波+泛音+包络+低通+生成式混响）、录音 | `envFor` 纯函数有单测；voices 由主振荡器 `onended` 事件驱动清理（不靠 setTimeout） |
| `player.js` | 186 | lookahead 调度器（提前 2 小节），`now/setIntervalFn` 可注入 | 时钟注入契约被测试锁定；**展示层异常不得炸调度循环**（轮次 47）；**决策预算由本文件的音频时钟给出**（`_decisionBudget`/`_settleBudgets`，只用注入的 `now()`，不起新定时器；暂停/停止时结算掉未兑现预算）；**迟到小节必须顺延到现在**——Web Audio 对排程在过去乐曲是立即发声，整小节会炸成一声；`stop()` 后不得再排程；`records` 封顶 `RECORDS_CAP`=20000 丢最旧（轮次 64——连续即兴数小时的内存护栏） |
| `midi.js` | 88 | SMF Type-1 双轨导出 | 字节格式有单测 |
| `ui.js` | 563 | 界面原语：键盘 DOM（含**和弦键亮起** `mark`/`keyMarks`/`markDiff`，轮次 57：diff 更新只动变化的键）、**可弹奏键盘接线**（`attachPlayableKeyboard`，轮次 69）、**和声功能轨** + 段落标注、决策日志（`addDecision`/`decisionGuards`）、**图例**（`LEGEND_ITEMS`/`renderLegend`）、**计费台账**（`emptyLedger`/`accumulateLedger`/`ledgerPills`/`refreshStatusPills`/`CHANNEL_LABEL`）、**键盘试听回声**（`keyEchoText`，轮次 55）、计划卡、toast | **`attachPlayableKeyboard` 的 `enabled` 是必填守卫**——两个界面的监听器都常驻 window，不查视图会双触发（双发声，轮次 68）；刷新顶栏 pill 一律走 `refreshStatusPills`（两个界面共用同一份 DOM 与同一套口径）；功能轨的类名映射有单测锁住；`chordFn` 缺失/非法必须降级为主功能；**颜色归功能、形态归手法**；段落/手法标注都必须有文字通道；**`LEGEND_ITEMS` 必须与真实标记同源**（标记改了图例没改，比没图例更糟，有测试守）；**归因标记一律走 `decisionGuards()` 纯函数**（断路/驳回/复读/超预算四类，返回描述符而非 HTML）——加标记必须同时加图例条目与关键词断言；canvas 三件套的能耗契约见 `canvas.js` 行；**台账是 tokens/费用/延迟的唯一口径**，两个界面共用（工作室此前完全不记账）；`setStatus` 同时接受裸数值与已格式化字符串——**格式化只做一遍** |
| `canvas.js` | 419 | **canvas 可视化三件套**（轮次 52 从 `ui.js` 拆出）：下落音符 `Fall`（含**跟弹用户音符**：紫色 + 近白描边，轮次 56）、张力对照带 `TensionGraph`、动机卡 `MotifCard`，外加它们专用的纯辅助（`motifShape`/`pulseActive`/`sectionLabel`/`chorusView`/`hoverBarAt`/`LOW`·`HIGH`）。**零 import** | **能耗契约**：动画类（`Fall`）用 setInterval 而非 rAF（标签页遮挡时 rAF 会暂停）；**静止类（`TensionGraph`/`MotifCard`）只在数据变化与强调窗口内重绘，`start()` 不得起常驻定时器**；三者尺寸一律由 `ResizeObserver` 缓存，**`draw()` 里禁止读 `clientWidth`**（每帧读 = 每帧强制同步布局），全部有单测守；**`.font` 赋值禁止 CSS 变量**——canvas 不解析 `var()`，赋值被静默忽略（轮次 56 修复三处并加契约测试）；`ui.js` 对它**只做转出**，调用方 import 路径不变（有单测锁同一绑定）；`LOW`/`HIGH` 是键盘与键跨度的共同真相源 |
| `dom.js` | 24 | **与业务无关的 DOM 原语**（零 import，两个界面共用）：`escapeHtml`（唯一的 HTML 注入面）、`byId`、`downloadBlob`（导出路径，此前在 main/studio 逐字节重复两份） | 任何拼进 `innerHTML` 的动态文本必须过 `escapeHtml`；别在界面层再写一份 `download()` |
| `main.js` | 483 | 实时即兴接线：设置持久化、渠道探测、开始/停止/导出、张力/功能轨/动机卡喂数、**图例抽屉开合与「不再提示」记忆**、**两种兜底的分别告知**、**跟弹回声与乐句末终止式读数**（轮次 55）、**跟弹音符进下落可视化**（轮次 56）、**和弦键亮起**（轮次 57）、**曲风 chips 的方向键导航 + tab 的 aria-selected 同步**（轮次 69） | 元素 id 契约见 `index.html`；**兜底必须分因**：`deadlineMiss`（渠道跟不上，设计在保节奏）与渠道故障（429/断网/CORS/无 key）是两件事，toast 文案与状态栏后缀都不同（`·跟不上` vs `·兜底`），各自一次性告知、恢复即复位 |
| `studio.js` | 506 | 工作室界面的**状态与工作流层**（轮次 54 拆出卷帘视图）：批量生成 job、回放（lookahead 调度 + 播放头 + 循环）、撤销/重做/自动保存、量化、Jev 路由的自然语言修改、JSON/MIDI 导入导出、键盘跟弹回声与**和弦键亮起**（`chordCtx`/`syncKeyMarks`，轮次 55/57）；持有 piece/撤销栈/回放/台账等状态，经 deps 闭包喂给卷帘视图（studio-roll.js） | **`drawPlayhead()` 跑在 30Hz 上：必须「先读完布局再写」，写后再读会让浏览器每帧强制一次 reflow；和弦文本只在真的换和弦时才写 DOM**（和弦键亮起挂在同一分支）；张力与 `nonChordIds` 两份缓存的**作废入口**仍是本文件的 `invalidateTension()`（缓存本体住在 studio-roll.js）；**布局常量（`ZOOM`/`ROW`/`VEL_H`/`HEADER` 等）住在 studio-core.js**——轮次 38 拆分时漏了导出，让卷帘整条绘制路径死了 10 轮，见 MEMORY 轮次 49；**生成循环必须逐小节 `accumulateLedger`**——顶栏 pill 与实时界面共用同一份 DOM，不记账用户就看不到一次生成花了多少钱 |
| `studio-roll.js` | 409 | **工作室钢琴卷帘视图**（轮次 54 从 studio.js 拆出）：卷帘与力度轨的绘制、指针交互（移动/缩放/双击删音/拖力度）、hover 逐小节读数（含乐句末终止式（轮次 55）与**悬停音符角色**（轮次 57））、时间轴头部（张力面积/功能带/段落界/契合度带）、张力/非和声音/契合度三份分析缓存（契合度带缓存：轮次 64——逐小节 fit 是 O(bars×notes)，hover 重绘不该反复付）；**空态也要画**（轮次 66：ensureStudio 无存档时不调 drawRoll/drawVelLane，canvas 停在默认 300×150，力度轨 CSS 底色显出浅斑）。**只画不决策**：piece 单一真相源在 studio.js，经 `createRollView(deps)` 闭包读取 | **与 studio.js 的 deps 契约（`els`/`getPiece`/`playing`/`pushUndo`/`onCommit`/`muted`）——少传一个，那条交互路径就静默失效**（studio-roll.test.mjs 守接线与绘制路径）；**力度轨与卷帘同在 `.rollwrap` 内，播放头 `top:0/bottom:0` 自动覆盖两条轨——不要另建同步**；卷帘头部四段与音符区**共用 `ZOOM`**（常量住在 studio-core.js） |
| `settings.js` | 21 | localStorage 设置读写（含 `legendHintOff`：图例提示记不记） | — |
| `kbd.js` | 72 | **电脑键盘弹奏**（轮次 65）：`e.code` 物理键位 → 钢琴键（A–L 白键、W/E/T/Y/U/O/P 黑键、`;` 跨三半音、Z/X 换八度）；`shouldHandle` 守卫（重触/组合键/表单焦点不弹）；两界面经 `attachKeyboard` 共用，`renderKeyboard.setKeyHints` 画键位字母 | **base 只落在 C 上**（`OCTAVE_BASES`=36/48/60——17 键跨度与键盘音域 LOW..HIGH 共同决定，72 作 base 会让 `;` 顶到 88）；与琴键点击同走 pressKey 一条路——新入口不得另开回声/下落的账；**两界面监听器都常驻 window，`enabled` 谓词按激活视图路由**（轮次 68 修复双触发：开过工作室后实时页每次按键双发声） |

### 2.1 样式架构（轮次 69：单体 styles.css → public/styles/ 分层）

七个文件，由 `index.html` 按序 `<link>`；**层序只在 `tokens.css` 里用 `@layer` 声明一次**，其余文件按名归入：

| 文件 | 行数 | 内容 |
|---|---|---|
| `tokens.css` | 130 | **唯一的设计令牌真相源**（颜色/文字/字号/字距/间距/圆角/阴影/动效/z-index）+ `@layer` 层序声明 |
| `base.css` | 107 | 归零、排版、浏览器表面（选中/光标/滚动条/焦点环）、`.sr-only`/`.skip-link`/`.hidden`、高对比度偏好 |
| `layout.css` | 97 | 顶栏、视图栅格、页脚、断点（1200/980/720/520） |
| `components.css` | 273 | 按钮/tab/chip/pill/表单/抽屉/toast/图例/进度条 |
| `stage.css` | 413 | 舞台、灯光、和弦区、动机卡、功能轨、写实钢琴、计划卡、决策日志、张力带 |
| `studio.css` | 35 | 卷帘、力度轨、播放头、走带条 |
| `motion.css` | 57 | **唯一允许写 `@keyframes` 的文件** + `prefers-reduced-motion` 豁免 |

**三条硬规则（由 `test/style-contract.test.mjs` 守成红灯）**：
1. 改视觉**先改 `tokens.css`**；组件层出现裸十六进制色值或裸 `font-size: Npx` 即红（琴键/琴毡的写实渐变在 `stage.css`，属允许的"画出来的材质"）。
2. `var(--x)` 引用的变量必须在 `tokens.css` 有定义——打错变量名会**静默回退到初始值，不报错**。
3. 层序只在 `tokens.css` 声明；新增文件必须把自己写进已声明的层，且必须被 `index.html` 引用（少 link 一个 = 整层静默消失）。

### 分析层

| 文件 | 行数 | 职责 | 修改高危区 |
|---|---|---|---|
| `studio-core.js` | 268 | **工作室纯函数层**（轮次 38 拆出）：确定性编辑变换、自然语言→编辑命令、项目 JSON 校验、时间轴分析（`pieceTension`/`barFunction`/`barIndexAt`）、非和声音 id（`nonChordIds`）、卷帘命中查询（`findNoteAt`）；studio.js 对其再导出（对外契约不变） | 新搬来的纯函数**不带缓存**——缓存是界面层状态：`nctCache` 门面自轮次 54 起随绘制路径住在 studio-roll.js |
| `tension.js` | 76 | **音乐张力分析**（只读已生成的小节，不参与决策）：`shapeTension` 音程不协和度、`barTension` 五分量加权、`smooth`/`tensionStats` | 与决策层**无耦合**——`FUNCTION_TENSION` 是分析用的另一张表，别和 `candidates.js` 的 `FN_NEXT`（决策用）混；脏输入必须降级而非抛错。**「计划弧线」由 `candidates.js` 的 `planTargetSeries` 提供**（它描述计划而非已生成的音乐，放在这里会造成反向耦合） |
| `nct.js` | 53 | **非和声音分析**（只读）：`classifyNote` 按「进出方式」分和弦音/经过音/邻音/倚音（Kostka-Payne 判据）、`barHarmonyFit`、`harmonySummary` | **pc 是音级类 0..11 不是 midi**——传错会让「和弦音 0%」这种荒谬结果出现；首尾音无邻居一律 `other`（把「4→5」判成经过音是错的）；脏输入降级为 `other` 绝不抛错 |
| `cadence.js` | 47 | **终止式识别**（只读，轮次 55）：`cadenceAt` 纯进行判据（功能归因 + 根音运动：V→I 完全 / IV→I 变格 / V→vi 阻碍）、`cadenceIntoBar` 乐句末门槛 + 半终止、`pieceCadences` 整曲扫描；`CADENCE_ZH` 中文名单一真相源 | **判据三要素缺一不可**——功能对了根音没走（V→V）不是终止式；**乐句位置是门槛**，句中同型进行不判（读出来就是噪音）；脏输入降级 null/[]，绝不抛 |

> 行数口径：**总行数**（`wc -l` 或 PowerShell `(Get-Content f).Count`，含空行）。改任何源文件后同步本表——这是 AGENTS.md 维护约定的一部分（见文末）。
> **上限**：ADR-0004 定的「每个文件 ≤800 行」由 `test/limits.test.mjs` **盯着**（`node --test` 与 CI 都会跑，越线即红——轮次 53 落地）。轮次 52 的教训是它此前只写在文档里：`ui.js` 已涨到 842 行才被拆出 `canvas.js`。**逼近 800 行时就该规划拆分，而不是等它越线**。核对命令：`Get-ChildItem public/js/*.js | ForEach-Object { $_.Name + ' ' + (Get-Content $_.FullName).Count }`。

### 其他

| 路径 | 职责 |
|---|---|
| `src/worker.js` | CF Worker：静态资产 + `/api/probe` `/api/jev` `/api/llm`；Jev 后端链式降级；每 IP 限流；**同源防护 `checkSameOrigin`（轮次 63）**：Content-Type 强制 application/json + Sec-Fetch-Site/Origin/Referer 核对——掐掉 text/plain 简单请求这个盲 CSRF 载体；`/api/llm` 封闭转发（防 SSRF，只认服务端 env） |
| `test/*.test.mjs` | `node --test`，共 236 个。**纯逻辑可测；浏览器行为靠人工冒烟** |
| `scripts/probe-jev.mjs` `scripts/probe-bar.mjs` | 真实 API 冒烟（需 key，计费） |
| `scripts/verify-deploy.mjs` | **部署后核验**：拉线上的 js/api，断言刚改的代码片段真的在边缘上（`npm test` 只证明磁盘对，不证明线上对）；退出码可接 CI。**每次 `wrangler deploy` 后必跑**。默认打生产自定义域 `https://jevpiano.logicc.top`，可传 URL 参数或 `VEV_BASE` 覆盖。**只对网络异常重试 3 次；HTTP 非 200 与片段缺失立即判失败**——把「可重试的噪声」与「确定性的信号」分开，退出码才有意义 |
| `scripts/regression-gate.mjs` | **决策指标回归门**（`npm run gate`）：12 种子多样性均值 + 相邻重复硬不变量；门槛单一真相源 `GATE_CONFIG`，CI 每次推送执行 |
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
   a. npm test                        全绿（236 个，只增不减）
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
npm test                                  # 236 个单测（node --test）
npm run gate                              # 12 种子决策指标回归门（CI 同步执行）
python dev-proxy.py --port 8000           # 本地开发（或 npm run dev）→ http://127.0.0.1:8000
node scripts/analyze-repetition.mjs 32 2026 random   # 重复度指标（结论至少 12 种子求均值）
node scripts/probe-jev.mjs                # 真实 API 冒烟（需 TYPESAFE_API_KEY）
npx wrangler deploy                       # 部署（或 npm run deploy）→ https://jevpiano.logicc.top/
node scripts/verify-deploy.mjs            # 部署后核验（默认打生产域；--no-api 跳过计费那一发）
```

---

*维护约定：本文件随架构演进而更新；任何对 §2 代码地图的修改必须在同一次 commit 完成，避免地图腐化。*
