# jevthoven 项目调研

> 调研时间：2026-09-28 · 工具：AnySearch（webReader/extract 实抓）+ 工作区既有 Jev 资料
> 原始抓取件（README 全文）保留在工作区本地，不入仓库；上游仓库见下行链接
> 仓库：https://github.com/cocktailpeanut/jevthoven （作者 cocktailpeanut，即 dalai 的作者）

## 一句话

**jevthoven 是一个"提示词优先"的符号音乐工作室**：用一句话描述想要的音乐，由 **TypeSafe Jev 模型对每一个音乐单元逐一做结构化决策**，代码把每次决策渲染成音符，最终得到可编辑、可演奏、可导出 MIDI 的多轨作品。

README 关键声明：**没有离线作曲器、没有音频生成模型、没有隐藏曲库**——每个音符都能溯源到一条已持久化的 Jev 决策（或明确标注的 fixture/人工编辑）。

## 决策流水线（核心架构）

```
一句话 prompt
  → 计划 plan（拍号、速度、曲式、轨道 lanes）
  → 乐器选择
  → 和声 harmony
  → 乐句意图 phrase intent
  → 每轨织体参数 groove
  → 逐小节完整模式 complete-bar patterns
（以上每一层 = 一次 Jev Choice 调用；代码负责把每个"选择"确定性地渲染成音符）
```

配套机制：
- **有界滚动上下文**：每一步重发"最近几小节 + 动机 + 和声计划"，不是把全曲塞进去。
- **确定性内核**（`core/`）：候选集生成、选择渲染、时间/swing 计算、MIDI 编解码、编辑操作、请求构造——全部是纯代码，模型只做"选择"。
- **Fixture provider 模式**：确定性的合成决策器，零 API 花费，用于开发/测试——也是"离线随机模式"的来源。

## 技术形态与工程细节

| 项 | 内容 |
|---|---|
| 形态 | 本地 Node 应用（非 SaaS），`app/` 自包含 server + web + core |
| 技术栈 | Express + SQLite + React + Tone.js + TypeScript 严格类型 |
| 要求 | Node ≥ 22.16；live 模式需 `TYPESAFE_API_KEY` |
| 花费 | 约**每轨每小节一次请求** + 规划，16 小节 4 轨 ≈ 75–80 次请求 |
| 播放 | 浏览器 Tone.js，可 loop 区域，生成中可预览已完成小节 |
| 编辑 | 钢琴卷帘编辑（增/移/缩放/力度/量化）全部是**确定性命令，不调模型**；自然语言修改（"下半段贝斯密一点"）才走 Jev |
| 任务 | 生成/变奏/重生成是可暂停/恢复/取消/接受/丢弃的 job，SSE 事件流，重启可续 |
| 导出 | 项目 JSON + 标准 MIDI 文件（SMF），校验式 JSON 导入 |
| 测试 | fixture 模式跑单测+集成；`test:live` 是显式 opt-in 的单次计费调用 |
| 部署 | Pinokio 一键安装（pinokio.co）或手动 `npm run build && npm start`（127.0.0.1:4318） |

## 对本项目（jev-piano）的直接启示

1. **"模型选、代码写"是正确分工**：Jev 只在有限候选集里做 Choice，音符由确定性代码生成——非法和声不可表示，成本可控，速度快。
2. **候选集是灵魂**：曲式→和声→织体→逐小节模式的分层决策，每层候选集由乐理与风格预设生成。
3. **fixture 模式必须做**：零成本可玩、可测试，也是无 key 用户的默认体验。
4. **决策透明是卖点**：每个音符可溯源到决策（本项目将直接把每小节决策+概率+延迟+成本展示在 UI 上）。
5. **jevthoven 是"生成→编辑工作室"**，不是实时的；本项目目标不同：**边决策边演奏**（Jev 70–500ms 的延迟相对一个小节 1–3 秒的时长完全够），因此可以砍掉 SQLite/job/SSE/撤销链这些为"编辑工作室"服务的重设施，做成纯前端。
6. **jevthoven 没有 LLM 扩写**：prompt 直接进 plan。本项目加入 LLM 扩写（BYO key）正是差异化点，也符合"系统一 + 系统二"的分工叙事。

## 与本工作区已验证的 Jev API 契约（board-games/jev-client.js 实测口径）

```
POST {endpoint}   Authorization: Bearer <key>
body:   { state, model, questions }      questions: { key: {type, instructions, criteria} }
resp:   { model, answers: { key: {...} }, usage: { input_tokens, output_tokens } }
type ∈ { choice, noul, score }；criteria 是 选项id→描述 的对象
429/529 → 指数退避；401 → key 无效
```

| 渠道 | endpoint | model |
|---|---|---|
| TypeSafe 官方 | `https://api.typesafe.ai/v1/systemone` | `jev-latest` / `jev-1.13.0` |
| OpenRouter | `https://openrouter.ai/api/v1/systemone`（体格式与官方一致） | `typesafe/jev-1.13` |
| OpenRouter Decisions API（jevtown 口径） | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` |
| Cloudflare Workers AI | `env.AI.run("@cf/typesafe/jev", {state, questions})` | —（绑定制，零 key） |

背景资料见 `../jev_model_memory.md`：Jev 是 TypeSafe 2026-09-15 发布的"系统一"结构化决策模型，输入 $0.042/百万 token、输出免费、延迟 70–500ms、32K 上下文——**"每小节问一次"在成本和延迟上都绰绰有余**（单次请求约 $0.00001–0.00002）。
