# CONTEXT.md — 领域模型与术语表

> 本项目统一语言。**写代码、写文档、写 prompt 都用这里的词**，不要自造同义词。
> agent 按需查阅：改和声/乐理时读 §1–2，改决策流时读 §3，改界面时读 §4。

---

## 1. 产品域（这个项目是什么）

| 术语 | 定义 |
|---|---|
| **jev-piano** | 本项目。一句话灵感 → 现场编曲 → 现场弹奏的即兴钢琴 |
| **Jev** | TypeSafe 的"系统一"结构化决策模型。输入文本 state + 一组类型化问题，输出每个问题的选择/评分。延迟 70–500ms，输入计费、输出免费 |
| **每小节一次请求** | 核心节奏：一个小节 = 一次 Jev 请求 = 6 个并行问题。成本 ~$0.00005/小节 |
| **决策透明** | 每小节的选择、概率/置信度、延迟、tokens、费用全部展示在 UI——每个音符可溯源 |
| **两个界面** | 「实时即兴」（边决策边演奏，不可预知）与「工作室」（批量生成→钢琴卷帘编辑→导出） |
| **lookahead 调度** | 提前 2 小节做决策，把 0.4–2s 的 API 延迟藏在小节时长（0.86–4s）里，演奏不断流 |

## 2. 乐理域（候选集的词汇）

| 术语 | 定义 |
|---|---|
| **候选集（candidate set）** | 代码按乐理+风格生成的有限选项集合，Jev 只能在其中选择。**非法和声不可表示** |
| **罗马数字和弦** | `I/ii/V7/bVI/bVII/V 7sus4/i m9` 等，`music.js` 的 `parseRoman` 解析为 `{rootPc, shape}` |
| **Plan（乐章计划）** | 一次演奏的全局配置：title/styleId/mode/keyPc/bpm/arc/swing/density/brightness/mood/notes/seed。所有模块只读 |
| **arc（弧线）** | 情绪曲线：flat/rise/arch/fall，映射到 intensity 曲线 |
| **phrase（乐句）** | 8 小节一句；`is_phrase_end` 小节终止式加权（V/I） |
| **动机（motif）** | 第 2–3 小节固化的节奏型+走向；之后每小节通过"发展手法"统一或变化 |
| **发展手法** | 第 7 问：承袭/模进/倒影/装饰/新句 |
| **指纹护栏** | onset+绝对音高指纹；与近两小节撞车时迭代变形（移调/加经过音/倒影）直到避开全部已存指纹 |
| **根音疲劳断路器** | 根音疲劳值随使用累计、×0.93 衰减，超 2.0 即从候选集剔除；三和弦循环最多 6 小节必被打断 |
| **LH 织体** | 左手伴奏型 11 种：block/ballad/alberti/arp/broken/waltz/shell/stride/walk/octave/pad；每种带逐小节变体（重击/空拍/翻转/换位/经过音/抬升） |
| **节奏型 / 走向** | RH 的 onset 模式（r0 稀疏/r1 中/r2 密/motif）与音高轮廓（stay/rise/fall/arch/wave） |
| **intensity / breathe** | 强度 0–3（score 问）；这小节旋律是否呼吸（noul 问） |
| **fixture** | 无 API 时的确定性种子决策器：**与真实 Jev 同候选集、同权重**，同构兜底，UI 标注"离线随机" |

## 3. 技术域（代码的词汇）

| 术语 | 定义 |
|---|---|
| **NoteEvent** | `{midi, startBeats, durBeats, vel, hand:'R'\|'L'}`——渲染产物，时间以拍计 |
| **BarResult** | `Composer.nextBar()` 的输出：index/loop/label/chord/notes/intensity/decision |
| **decision** | BarResult 里的决策元信息：provider/fixture/ms/inputTokens/usd/answers |
| **渲染内核** | composer.js 里把"选择"变成 NoteEvent 的确定性代码（和弦声位、旋律生成、LH 织体、swing） |
| **六问** | chord/lh/rhythm/contour/intensity/breathe（+第 7 问发展手法），一次请求并行 |
| **四渠道** | fixture（默认零 key）/ typesafe 直连 / openrouter 直连 / 同源代理（worker） |
| **stripPrivate** | 发送前剥离 `_` 前缀字段（`_fixture` 权重不发给真实 API） |
| **后端链式降级** | worker 的 /api/jev：Workers AI 绑定 → TYPESAFE_API_KEY → OPENROUTER_API_KEY，逐个尝试 |
| **封闭转发** | /api/llm 只转发服务端 env 配置的端点，忽略请求体凭据——防开放中继 |
| **确定性编辑** | 工作室的编辑操作（增/移/缩放/删/撤销）全是不调模型的纯函数 |
| **Jev 路由的修改** | 工作室里自然语言修改由 Jev 从封闭编辑命令集（加密/稀疏/移调/力度）中选择一个执行 |
| **SMF Type-1** | 导出的 MIDI 格式：tempo track + 左右手双轨，division=480 |

## 4. 协作域（agent 的词汇）

| 术语 | 定义 |
|---|---|
| **AGENTS.md** | 项目宪法，所有 agent 第一站；含阅读地图与接力协议 |
| **MEMORY.md** | 项目记忆压缩索引，最新在最上，完成任务必写 |
| **接力条** | 任务未完成时留下的标准交接格式（目标/进度/下一步/已知坑/验收/领地） |
| **领地** | 一个任务涉及的文件清单；并行 agent 的领地禁止交集 |
| **收尾三件事** | 完成任务必须：写 MEMORY.md 顶部条目 + 需要时建 docs/memory/ 当日条目 + 契约变更时补 ADR |
| **ADR** | 架构决策记录：为什么这样设计、被否决的方案是什么 |

---

*本文件随领域演进而更新；引入新概念时在此登记，保持全项目用一种语言。*
