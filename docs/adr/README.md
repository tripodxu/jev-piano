# docs/adr/ — 架构决策记录

> ADR（Architecture Decision Record）：记录**为什么这样设计**，以及被否决的方案。
> "发生了什么"看 [docs/memory/](../memory/)；"为什么"看这里。
> 新 ADR 编号递增，状态：提议 → 接受（或 否决/取代）。

| 编号 | 决策 | 状态 |
|---|---|---|
| [0001](0001-model-chooses-code-writes.md) | 模型只做选择，代码只做渲染（"模型选、代码写"） | 接受 |
| [0002](0002-fixture-isomorphic-fallback.md) | fixture 与真实 Jev 同构兜底 | 接受 |
| [0003](0003-candidate-set-enforcement.md) | 候选集强制：答案不在候选内一律拒绝 | 接受 |
| [0004](0004-zero-framework-static-frontend.md) | 零框架、零构建、零运行时依赖 | 接受 |

## 格式

```markdown
# ADR-NNNN: <标题>
- 状态 / 日期
- 背景：什么问题
- 决策：选了什么
- 理由：为什么
- 被否决的方案：以及为什么否决
- 后果：好的与坏的
```
