# docs/memory/ — 项目记忆库

> **最新在最上。** 本目录存放每次会话/里程碑的详细记忆；压缩版在根 [MEMORY.md](../../MEMORY.md)。
> 命名：`YYYY-MM-DD-<主题>.md`。同一天多个主题用后缀区分。本 README 是索引，新条目加在顶部表格。

## 索引（最新在上）

| 日期 | 条目 | 一句话 |
|---|---|---|
| 2026-09-28 | [anti-repetition-overhaul](2026-09-28-anti-repetition-overhaul.md) | 反重复大修：根音疲劳/候选集强制/替换和弦，真实 Jev 验证 |
| 2026-09-28 | [studio-view](2026-09-28-studio-view.md) | 工作室界面：生成→钢琴卷帘编辑→自然语言修改→导出 |
| 2026-09-28 | [anti-repetition-kernel](2026-09-28-anti-repetition-kernel.md) | 反重复内核：指纹护栏/发展手法/音区漂移 + jevthoven 对齐 |
| 2026-09-28 | [review-pass-hardening](2026-09-28-review-pass-hardening.md) | 审查加固：SSRF 防护/限流/重试/a11y/canvas 性能 |
| 2026-09-28 | [visual-redesign](2026-09-28-visual-redesign.md) | 午夜音乐厅视觉重设计 |
| 2026-09-28 | [mvp-build](2026-09-28-mvp-build.md) | MVP 一天建成：Tasks 0–11，含 e2e 实测坑 |
| 2026-09-28 | [docs-agent-system](2026-09-28-docs-agent-system.md) | 文档与多 agent 记忆体系建立（AGENTS.md/MEMORY/ADR/CONTEXT） |

## 条目格式（新条目照此写，最新在最上）

```markdown
# <主题> · <日期>

- **做了什么**：<具体到 commit / 文件 / 行为变化>
- **为什么**：<动机与被否决的替代方案>
- **坑**：<实测踩坑与修复，写给下一个 agent>
- **验证**：<跑了什么命令/指标，结果如何>
- **下一步**：<未尽事项，可被任务板拾取>
```

## 维护规则

1. 完成任务**当天**写条目（AGENTS.md §3.2 收尾三件事之一）。
2. 条目只记**跨会话有价值**的事：决策、坑、指标、契约。琐碎过程不记。
3. 与 [MEMORY.md](../../MEMORY.md) 的关系：MEMORY.md 是压缩索引（agent 必读），本目录是详情（按需读）。
4. 与 [docs/adr/](../adr/) 的关系：本目录记"发生了什么"，ADR 记"为什么这样设计"。
