# MEMORY.md — 项目记忆（最新在最上）

> **本项目唯一的持久记忆。** 新条目**一律追加到最顶部**（倒序时间）。
> 每条 = 一次会话/里程碑的压缩记忆：做了什么、为什么、坑在哪、下一步。
> 详细版在 [`docs/memory/`](docs/memory/)（同日文件名，格式相同）；本文件只放压缩条目 + 任务板。
> 写入规范见 [AGENTS.md §4](AGENTS.md)；本文件由每个完成任务的 agent 维护——**完成任务不写记忆 = 未完成**。

---

## [完成] 2026-09-28 · 仓库规范加固批次（9 任务，docs:agent-system 之后）

- **做了什么**：按 docs/superpowers/plans/2026-09-28-repo-hardening.md 完成 9 任务——文档一致性（AGENTS.md 行数统一总行数口径、MEMORY 错别字、MVP 计划归档横幅）；仓库规范（LICENSE、engines>=18、CI workflow）；代码小修（studio autosave 失败 toast，TDD 47 测试；composer 死导出/未用 import 清理）；真实 Jev 重复度基线（熔断，见下条阻塞条目）。
- **为什么**：修复多 agent 协作地基——CI 把"测试全绿"红线自动化；LICENSE 补上法律完备性；代码地图行数口径统一避免腐化。
- **坑**：① .gitignore 对已追踪文件无效（上轮已处理 __pycache__）；② 计划文本的相对链接少一级（plans/ 到根是 ../../../，已修）；③ fixture 口径达标≠真实渠道达标（本次最大发现，见阻塞条目）；④ AGENTS.md 行数需随代码改动同 commit 同步（Task 6/7 各欠一笔，本任务补齐）。
- **验证**：npm test 47/47；node --check 全过；CI（push 后 GitHub Actions 实测，结果见 Task 9 Step 5）；git 历史 9+ commit 按序。
- **下一步**：① 阻塞条目——真实渠道和弦多样性加固（调根音疲劳参数，需先排除抽样波动）；② composer.js 769 行逼近 ADR-0004 自设 800 行上限，按计划 §A 独立拆分；③ P3：PR/issue 模板、dev-proxy 测试。

## [阻塞] 2026-09-28 · 真实 Jev 重复度基线：和弦多样性未达标（已熔断，待加固）

- **目标**：`node scripts/analyze-repetition.mjs 32 2026 random --real` 建立真实 Jev 渠道重复度基线并记入 README 反重复表。
- **进度**：已实跑（~$0.002，typesafe(jev-1.13) 真实渠道）。**触发熔断**：unique_chords=6 < 8 且前 8 小节字面 Cm-Fm-G 三和弦循环；interval_entropy=1.41 亦低于 fixture 下限 2.4。合格项：相邻字面重复 0、左手唯一 27/32、跳进 10%、旋律唯一 30/32。README 未改、工作树干净。
- **下一步（接力）**：先排除抽样波动（可再跑 seed 2027，~$0.002，需 owner 批准）；若确认系统性偏差，开新任务调候选集/权重——方向：真实渠道加强根音疲劳（阈值 2.0/衰减 0.93 是为 fixture 分布调的）或进一步压缩模型可复选空间。验收：真实渠道 unique_chords ≥ 8 且相邻重复 = 0，然后补 README 真实渠道行与本条目的完成态。
- **已知坑**：fixture 口径达标 ≠ 真实渠道达标——两者同构的是候选集与权重，但真实模型选择分布更集中；反重复大修（a085f4f）宣称的 "real-Jev verified" 仅是 probe-bar 3 小节冒烟，未做 32 小节量化，这是本次才发现 gap 的根因。
- **验收**：README 反重复表追加真实渠道行 + 记忆条目转完成态。
- **领地**：README.md、docs/memory/2026-09-28-real-jev-repetition-baseline.md、MEMORY.md（纯文档，未动代码）。

## [完成] 2026-09-28 · 文档与多 agent 记忆体系建立

- **做了什么**：新建 `AGENTS.md`（agent 宪法：阅读地图/代码地图/协作协议/接力协议/红线）；新建 `MEMORY.md` + `docs/memory/`（本体系，最新在上）；新建 `docs/adr/`（4 篇关键决策）；新建 `docs/CONTEXT.md`（领域模型+术语表）；`docs/research/` 收编原先在仓库外的调研笔记；README 增加文档导航并修正测试计数（44→46）；`.gitignore` 此前已扩充（密钥/agent 本地状态/运行产物），本次 `git rm --cached` 了误追踪的 `__pycache__/dev-proxy.cpython-310.pyc`。
- **为什么**：此前项目知识只存在于各 agent 的本地会话里（`.workbuddy/` 等，不入库），新 agent 被迫全量阅读项目；调研笔记在仓库外，克隆者看不到。
- **坑**：`.gitignore` 加了 `__pycache__/` 但文件已被追踪，ignore 不生效——必须先 `git rm --cached` 再提交。
- **下一步**：无（体系已自洽）。后续 agent 按 AGENTS.md §3.2 收尾三件事维护。

## [完成] 2026-09-28 13:51 · 反重复大修（真实 Jev 验证通过）

- **做了什么**（commit `a085f4f`，详见 [docs/memory/2026-09-28-anti-repetition-overhaul.md](docs/memory/2026-09-28-anti-repetition-overhaul.md)）：根音疲劳断路器、候选集强制、替换和弦、左手逐小节变体、旋律跳进、节奏变奏深化。指标（fixture 4 种子均值）：音程熵 2.2→2.4-2.8；跳进占比 4-9%→8-21%；左手唯一小节 15-18/32→26-28/32；和弦种类 6→8-10；相邻字面重复→0。
- **为什么**：修复前 32 小节曲目存在可闻的循环感（4 和弦循环、左手复读、旋律等长机械）。
- **坑**：修局部重复会引入别处重复——指纹护栏变形后必须**再检查全部已存指纹**；真实 Jev 会用标签（如 `"chord"`）或报被排除和弦来着数，**答案不在候选集内一律拒绝并回落最高权重候选**。
- **下一步**：和弦显示统一升号的美化（Ab 显示为 G#）仍未做。

## [完成] 2026-09-28 08:40 · 工作室界面（第二界面）

- **做了什么**（commit `9229a45`，详见 [docs/memory/2026-09-28-studio-view.md](docs/memory/2026-09-28-studio-view.md)）：jevthoven 式"生成→编辑"工作流——整曲批量生成 job（进度/取消/生成中预览）、钢琴卷帘编辑（增/移/缩放/删除/撤销重做，全部确定性不调模型）、循环播放、分轨静音、Jev 路由的自然语言修改、JSON 导入导出、localStorage 自动保存。`studio.js` 641 行，编辑变换为纯函数有单测。
- **为什么**：对齐 jevthoven 功能面，从"只能实时听"扩展到"可精修可导出"。
- **坑**：studio 与实时即兴共享 composer/jev/audio 单例——改共享内核时必须回归两个界面。
- **下一步**：钢琴卷帘的量化(quantize)与力度编辑未做。

## [完成] 2026-09-28 08:12 · 反重复内核 + jevthoven 功能对齐

- **做了什么**（commit `21c0270`）：旋律指纹护栏、发展手法第 7 问（承袭/模进/倒影/装饰/新句）、节奏变奏、音区漂移、演奏指示（director_note）、暂停/继续、移调。
- **为什么**：动机统一与变化的平衡；实时交互对齐 jevthoven。
- **坑**：暂停靠挂起 AudioContext 冻结时钟，恢复后调度需重新对齐——player 的时间基准只有一个来源（注入的 now）。

## [完成] 2026-09-28 07:51 · 审查加固轮

- **做了什么**（commit `83fbe46`）：worker 加固（`/api/llm` 封闭转发防 SSRF、每 IP 限流 30/min、后端链式降级）；实时韧性（重试次数/超时 10s）；a11y（对比度/focus-visible/aria）；canvas 性能（lite mode、音符上限）。
- **坑**：CF 浏览器直连 TypeSafe 官方 API 被 CORS 拦截——直连渠道只适合允许 CORS 的端点，生产走同源代理。

## [完成] 2026-09-28 07:37 · 视觉重设计

- **做了什么**（commit `66d000a`）：午夜音乐厅世界——胡桃木钢琴、黄铜点缀、衬线标题、programme log（节目单式决策日志）。

## [完成] 2026-09-28 06:26–06:59 · MVP 建成（Tasks 0–11 全部完成）

- **做了什么**（commits `c9c1936`…`d672bd6`，计划见 [docs/superpowers/plans/2026-09-28-jev-piano-mvp.md](docs/superpowers/plans/2026-09-28-jev-piano-mvp.md)）：按计划一天建成——乐理内核、Jev 四渠道客户端、决策器、合成钢琴、lookahead 调度器、SMF 导出、页面与主题、UI 接线、CF Worker + wrangler + dev-proxy、e2e 验证、README。
- **为什么这样设计**：见 [docs/adr/](docs/adr/) 四篇——"模型选代码写"、fixture 同构兜底、候选集强制、零框架。
- **坑（e2e 实测发现，commit `f905feb`）**：① 程序化填充不触发 `change`——文本框设置用 `input` 事件保存；② Jev 请求 10s 超时是刚需（不断流的关键）；③ dev-proxy 转发要用标准库 requests 式实现，避免引入依赖。
- **下一步**：见 README「远期路线图」（多轨/每轨并行决策/LLM 指挥）与「已知限制」。

---

## 任务板（进行中 / 待办）

| 状态 | 任务 | 领地 | 验收 |
|---|---|---|---|
| 待办 | 和弦显示升/降号美化（C minor 的 Ab 现显示 G#） | `composer.js`/`music.js` + 测试 | 测试全绿 + 试听无回归 |
| 待办 | 音质升级评估：@tonejs/piano 采样（数 MB，违背轻量，需 ADR） | — | ADR 结论 |
| 待办 | 钢琴卷帘量化与力度编辑 | `studio.js` + `test/studio.test.mjs` | 测试全绿 |

> 格式约定：完成任务 → 条目移入上部「完成」区（最新在上）；新接任务 → 按下条格式写接力条：
> `[进行中] 任务名 · 日期` + 目标/进度/下一步/已知坑/验收/领地（完整格式见 AGENTS.md §4.2）。
