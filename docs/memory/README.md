# docs/memory/ — 项目记忆库

> **最新在最上。** 本目录存放每次会话/里程碑的详细记忆；压缩版在根 [MEMORY.md](../../MEMORY.md)。
> 命名：`YYYY-MM-DD-<主题>.md`。同一天多个主题用后缀区分。本 README 是索引，新条目加在表格顶部（表内按日期倒序）。

## 索引（最新在上）

| 日期 | 条目 | 一句话 |
|---|---|---|
| 2026-10-18 | [canvas-render-budget](2026-10-18-canvas-render-budget.md) | 静止画布按需重绘 + `draw()` 不逐帧读布局：clearRect 47.6→29.9/s、布局读取 47→0/s |
| 2026-09-30 | [tempo-visibility](2026-09-30-tempo-visibility.md) | 速度弧线的三个可见通道：计划卡速度行、实时 BPM 读数、张力带 hover 十字线 |
| 2026-09-30 | [tempo-arc](2026-09-30-tempo-arc.md) | 给曲式补时间轴：tempoMultAt 每小节速度乘数（尾段 rit. 1.0→0.8） |
| 2026-09-30 | [real-channel-regression-2](2026-09-30-real-channel-regression-2.md) | 真渠道回归打破硬不变量（相邻重复 6）：承袭无强拍不锚定 + 变形空间耗尽 |
| 2026-09-30 | [phrase-role-visibility](2026-09-30-phrase-role-visibility.md) | 问/答标记进功能轨第三槽（文字+形状双通道，不占功能色） |
| 2026-09-30 | [phrase-question-answer](2026-09-30-phrase-question-answer.md) | 引入古典 period：前四小节半终止发问、后四小节全终止回答 |
| 2026-09-30 | [keypc-harmony-fix](2026-09-30-keypc-harmony-fix.md) | 修复一级正确性 bug：移调只移旋律不移和声（相对/绝对音级分离） |
| 2026-09-30 | [docs-count-drift](2026-09-30-docs-count-drift.md) | 文档漂移清理：行数/测试数/八问/限流值一次对齐（宪法表格集体冻结） |
| 2026-09-30 | [decision-budget-two-bars](2026-09-30-decision-budget-two-bars.md) | 解决「只能弹两小节」：决策时间由音频时钟封顶 + 迟到小节顺延（根因是决策无界） |
| 2026-09-28 | [visual-redesign](2026-09-28-visual-redesign.md) | 午夜音乐厅视觉重设计（胡桃木/黄铜/衬线/节目单式日志） |
| 2026-09-28 | [tension-band](2026-09-28-tension-band.md) | 张力对照带：五分量加权张力 + 实际曲线 vs 计划弧线对照 |
| 2026-09-28 | [studio-view](2026-09-28-studio-view.md) | 工作室界面：生成→钢琴卷帘编辑→自然语言修改→导出 |
| 2026-09-28 | [studio-timeline](2026-09-28-studio-timeline.md) | 工作室卷帘时间轴：张力/功能/和弦名与音符区共用 ZOOM，对齐是构造出来的 |
| 2026-09-28 | [studio-quantize-velocity](2026-09-28-studio-quantize-velocity.md) | 卷帘量化（支持部分量化）+ 力度轨（与卷帘共用像素/拍） |
| 2026-09-28 | [section-visibility](2026-09-28-section-visibility.md) | 段落可见化：纯文本曲式清单 + 虚线竖线 + 段落名（不依赖颜色） |
| 2026-09-28 | [section-semantics](2026-09-28-section-semantics.md) | 段落边界有了和声与动机语义：段落首承袭率 16.7%→45.8% |
| 2026-09-28 | [review-pass-hardening](2026-09-28-review-pass-hardening.md) | 审查加固：SSRF 防护/限流/重试/a11y/canvas 性能 |
| 2026-09-28 | [real-jev-repetition-baseline](2026-09-28-real-jev-repetition-baseline.md) | 真实 Jev 重复度基线：熔断（和弦种类 6<8，实为曲风词汇上限） |
| 2026-09-28 | [real-channel-regression](2026-09-28-real-channel-regression.md) | 真实渠道回归 + 一个被否决的优化（压缩提示词不划算，已回退） |
| 2026-09-28 | [non-chord-tones](2026-09-28-non-chord-tones.md) | 非和声音分析（Kostka-Payne）：实测非和弦音 37.6%，音乐是调性健康的 |
| 2026-09-28 | [mvp-build](2026-09-28-mvp-build.md) | MVP 一天建成：Tasks 0–11，含 e2e 实测发现的三处坑 |
| 2026-09-28 | [motif-map](2026-09-28-motif-map.md) | 动机地图：主题轮廓曲线 + 回归计数 + 发展手法字（三套独立通道） |
| 2026-09-28 | [motif-development](2026-09-28-motif-development.md) | 动机发展真正落地：「承袭」此前走的是与新句相同的渲染路径 |
| 2026-09-28 | [loop-lock-breaker](2026-09-28-loop-lock-breaker.md) | 循环锁死断路器接线（发现 recentRoots 是死参数，JDOC 承诺的机制从未运行） |
| 2026-09-28 | [legend-onboarding](2026-09-28-legend-onboarding.md) | 图例与首用引导：不新增可视化，只补读法（标记图例与真实标记同源） |
| 2026-09-28 | [intensity-continuity](2026-09-28-intensity-continuity.md) | 强度连续化：整数档→相对计划弧的偏移 + 速率限制，跳≥2 档 26.9%→0% |
| 2026-09-28 | [harmonic-theme-rejected](2026-09-28-harmonic-theme-rejected.md) | 和声主题（被证伪并回退）：池内加权撬不动，需替换候选级机制 |
| 2026-09-28 | [harmonic-ribbon-frontend](2026-09-28-harmonic-ribbon-frontend.md) | 和声功能轨 + 前端精修：第 2 轮的和声语义第一次可见 |
| 2026-09-28 | [harmonic-function-layer](2026-09-28-harmonic-function-layer.md) | 和声功能层：候选来源换成调式全色板，新增第 7 问「和声功能」 |
| 2026-09-28 | [form-sections](2026-09-28-form-sections.md) | 段落/曲式规划：A–B–A'–Coda 四段式，段落感知的 intensityTarget |
| 2026-09-28 | [docs-agent-system](2026-09-28-docs-agent-system.md) | 文档与多 agent 记忆体系建立（AGENTS.md/MEMORY/ADR/CONTEXT） |
| 2026-09-28 | [chord-spelling](2026-09-28-chord-spelling.md) | 和弦拼写（降号侧）：C 小调 bVI 从 G# 变 Ab，14/32 记谱错误→0 |
| 2026-09-28 | [breathe-cancels-restatement](2026-09-28-breathe-cancels-restatement.md) | 呼吸取消承袭（归因撒谎）：24.2% 的「承袭」实际没承袭 |
| 2026-09-28 | [breathe-cancels-all-transforms](2026-09-28-breathe-cancels-all-transforms.md) | 把呼吸取消的修复推广到全部变形手法（呼吸是时值指令不是否决指令） |
| 2026-09-28 | [anti-repetition-overhaul](2026-09-28-anti-repetition-overhaul.md) | 反重复大修：根音疲劳/候选集强制/替换和弦，真实 Jev 验证通过 |
| 2026-09-28 | [anti-repetition-kernel](2026-09-28-anti-repetition-kernel.md) | 反重复内核：指纹护栏/发展手法/音区漂移 + jevthoven 对齐 |

## 条目格式（新条目照此写，最新在最上）

条目**必需**的是内容，不是版式——两种写法都在用（早期用 `- **做了什么**` 列表，近轮多用 `## 做了什么` 小节），
只要下面五件事说清楚，agent 就能接得住：

```markdown
# <主题（轮次 N · 类型）> · <日期>

> （可选）一段「本轮教训」引文，把最该被记住的那一句提到最前

## 做了什么 / 为什么 / 坑 / 验证 / 下一步
```

| 要素 | 要求 |
|---|---|
| **做了什么** | 具体到 commit / 文件 / 行为变化——不写「优化了 X」这种空话 |
| **为什么** | 动机 + **被否决的替代方案及否决理由**（失败的路也是结论） |
| **坑** | 实测踩坑与修复，写给下一个 agent |
| **验证** | 跑了什么命令、指标如何（含**未验证项**，如外网被拦） |
| **下一步** | 未尽事项，可被任务板拾取 |

## 维护规则

1. 完成任务**当天**写条目（AGENTS.md §3.2 收尾三件事之一）。
2. 条目只记**跨会话有价值**的事：决策、坑、指标、契约。琐碎过程不记。
3. 与 [MEMORY.md](../../MEMORY.md) 的关系：MEMORY.md 是压缩索引（agent 必读），本目录是详情（按需读）。
4. 与 [docs/adr/](../adr/) 的关系：本目录记"发生了什么"，ADR 记"为什么这样设计"。
5. **建条目必须同时登记本索引**——索引曾长期停在 10 条而目录已 35 条（2026-10-01 补齐）。
   核对命令：`ls docs/memory/*.md | grep -v README | wc -l` 应等于表内数据行数。
