# Jev 即兴钢琴（jev-piano）

> **Jev 每小节实时决策，边作曲边演奏的钢琴。** 你给一句话，它现场编曲、现场弹。
> 零框架、零构建、零运行时依赖的纯静态前端，一条 `wrangler deploy` 部署到 Cloudflare Workers。

架构参考 [cocktailpeanut/jevthoven](https://github.com/cocktailpeanut/jevthoven) 的"模型选、代码写"模式：**Jev**（TypeSafe 系统一模型）每小节一次请求、6 问并行，从乐理合法的候选集里选出下一小节的**和弦 / 左手织体 / 节奏型 / 旋律走向 / 强度 / 是否呼吸**；确定性代码把每个选择渲染成音符；Web Audio lookahead 调度器边决策边演奏。没有音频生成模型，没有隐藏曲库，每个音符都能溯源到一条决策。

```
一句话灵感 ──▶ LLM 扩写（可选，BYOK）──▶ 乐章计划（风格/调/速/弧线）
                                              │
                    ┌─────────────────────────┘
                    ▼
   ┌─────────── 每小节一次 Jev 请求（6 问并行）───────────┐
   │ state: 曲风/情绪/当前和弦/近 4 小节/动机/弧线位置      │
   │ choice: 下一和弦 · 左手织体 · 节奏型 · 旋律走向        │
   │ score: 强度 0-3        noul: 这小节要呼吸吗            │
   └──────────────────────┬─────────────────────────────┘
                          ▼
        确定性渲染内核：左手 11 种织体 + 旋律（和弦锚定/摇摆/人味）
                          ▼
        lookahead 调度器（提前 2 小节决策）──▶ Web Audio 合成钢琴
                          ▼
            键盘高亮 + 下落音符 + 决策日志（概率/延迟/费用）
```

## 运行

### 本地（零配置即可玩）

```bash
python dev-proxy.py --port 8000     # 或 npm run dev
# 打开 http://127.0.0.1:8000 → 默认「离线随机」渠道，无需任何 key
```

无 key 时使用与真实 Jev **同构**的本地种子决策器（jevthoven 的 fixture 模式）：同一候选集、同一权重，确定性可复现。

### 部署到 Cloudflare Workers

```bash
npx wrangler login
npx wrangler deploy                 # npm run deploy
```

部署后 Jev 决策三种后端（自动探测，见 `src/worker.js`）：

| 后端 | 配置 | 特点 |
|---|---|---|
| **Workers AI**（默认） | `wrangler.toml` 里 `[ai]` 绑定（已开启） | 零 key，`@cf/typesafe/jev`，账号开箱即用 |
| TypeSafe 官方 | `npx wrangler secret put TYPESAFE_API_KEY` | 官方源，`jev-latest` |
| OpenRouter | `npx wrangler secret put OPENROUTER_API_KEY` | `typesafe/jev-1.13` |

LLM 扩写代理（可选）：`wrangler.toml` 里取消 `[vars]` 注释 + `npx wrangler secret put LLM_API_KEY`，或前端设置面板里用户自带 key 直连任意 OpenAI 兼容端点。

Worker 安全边界：`/api/llm` 只转发服务端 env 配置的端点（忽略请求体里的 baseUrl/apiKey，杜绝开放中继）；`/api/jev`、`/api/llm` 共享每 IP 限流（`RATE_LIMIT_PER_MIN`，默认 30 次/分钟，isolate 内存计数，多实例部署时为尽力而为）。

> 注意：TypeSafe 官方 API 不允许浏览器跨域直连（实测 CORS 拦截），所以**直连渠道仅适用于允许 CORS 的端点**；生产环境请走同源代理（本 Worker）。

## 成本（实测口径）

- 每小节一次请求：**~1100 input tokens ≈ $0.00005**（输出免费），一次 32 小节演奏 ≈ **$0.0016**
- 决策延迟 0.4~2s，被"提前 2 小节"的决策管线完全藏住；速度 ≤140 BPM 时演奏不断流
- 离线随机渠道：$0

## 测试

```bash
npm test          # 30 个单测：乐理内核 / Jev 客户端 / 决策器 / 调度器 / SMF 导出
node scripts/probe-jev.mjs   # 真实 API 冒烟（需 TYPESAFE_API_KEY，单次 ~$0.00002）
node scripts/probe-bar.mjs   # 真实 API 跑 3 个小节的生产路径决策
```

## 目录

```
public/            纯静态前端（index.html + 8 个 ES Module）
  js/music.js      乐理内核：罗马数字解析、和弦声位、8 种曲风预设
  js/jev.js        Jev 四渠道客户端（归一化/重试/超时）+ fixture 采样 + LLM 扩写
  js/composer.js   决策器：候选集构造、6 问设计、音符渲染内核、动机记忆
  js/audio.js      合成钢琴（泛音+包络+低通+生成式混响）、录音
  js/player.js     lookahead 调度器 + 决策管线（now/setTimer 可注入，可单测）
  js/midi.js       SMF Type-1 双轨导出
  js/ui.js, main.js 键盘可视化、下落音符、决策日志、设置
src/worker.js      CF Worker：静态资产 + /api/probe|jev|llm
dev-proxy.py       本地开发：静态服务 + 模拟/真实转发
docs/superpowers/plans/   实施计划（本项目的完整设计文档）
```

## 设计说明

- **决策透明**：每小节在"Jev 的实时决策"面板展示选择、置信度、延迟、tokens 与费用——每个音符可溯源。
- **永不中断**：真实 Jev 不可用（无 key / CORS / 断网 / 超时 10s）时，同构 fixture 决策器无缝接管，UI 标注"兜底"。
- **动机统一**：第 2 小节的节奏型与走向被记为动机，之后每小节 Jev 可在"重现动机 / 新材料"间选择，保证即兴的统一性。
- **和声安全**：候选集只含本调罗马数字与终止式加权（乐句尾 V/I 加权 1.0、进行池延续 +1.2），非法和声不可表示。
- **音色**：默认合成钢琴（三角波+两枚正弦泛音+包络+低通+生成式混响），零下载即开即响；升级路线：@tonejs/piano（Salamander 采样，数 MB）。

## 远期路线图：从钢琴到乐团

1. **多轨**：`renderLH/renderMelody` 已是"轨"的形状——加贝斯/打击/弦乐垫合成器，每轨独立渲染内核。
2. **每轨每小节并行决策**：Jev 单请求并行评估的特性使"5 轨 × 6 问 = 30 问/小节"仍然一次往返（jevthoven 的 lane 模型）。
3. **LLM 指挥**：曲式级规划（段落/配器/情绪起伏）交给 LLM（系统二），小节级选择交给 Jev（系统一）——正是两者定位的分工。
4. **MIDI 已就绪**：导出的 SMF 双轨可直接进 DAW 编排真实乐器。

## 已知限制

- 和弦显示统一用升号（C minor 的 Ab 显示为 G#）；曲名与升/降号的美化留待后续。
- 合成钢琴偏电钢质感；追求原声钢琴请走采样方案。
- OpenRouter 的 `v1/systemone` 端点与官方体格式一致（board-games 项目实测口径），但未在本项目实测（无 key）。

---
由 TypeSafe **Jev** 驱动 · 调研笔记见 `../research/` · MIT
