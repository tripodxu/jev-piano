# 音频 voices 生命周期审计与修复（轮次 32 · 优化）Implementation Plan

> **轮次 32 · 优化**。方法论：先量再改——审计全项目定时器/内存压力点，只修实测有害的。

## 审计结论（逐项）

| 项 | 实测 | 处置 |
|---|---|---|
| **audio voices 清理** | **每音 1 个 setTimeout**；后台标签页定时器节流 ≥1s，voices 堆积靠 32 上限硬挤（200 音实测 200 个定时器） | **修复**：主振荡器 `onended` 事件驱动移除——音频线程时钟驱动，不受页面可见性影响 |
| player.records 无上限增长 | 3 小时会话 ≈ 24 万条 ≈ 50MB——真实但属于长会话边界 | 保留（MIDI 导出需要完整记录）；记入轮次 35 的 README「已知限制」 |
| undo/redo JSON 快照 | 32 小节 ~110KB × 上限 50 = ~5.5MB 封顶 | 保留（trimUndo 有界） |
| Fall notes | 上限 500 ✓ 已有 | 无恙 |
| tensionCache / nctCache | invalidateTension 六处路径齐 ✓（轮次 6 验证过） | 无恙 |
| drawRoll 全量重绘 | 拖拽期逐 move 重绘——大曲目有抖动风险，但属架构级重构 | 保留，不为微优化动卷帘架构 |

## 修复设计

`PianoAudio.play()`：删除每音一个的 `setTimeout` 清理，改挂在**主振荡器的 `onended`**（`oscs[0].stop(stopAt + 0.1)` 到点时音频线程回调）。附带收益：清理时机与实际发声结束精确同步（旧实现是估算的 `stopAt + 150ms`）。

## 验证

- TDD：mock AudioContext 单测——play 两音 → 手动触发 `onended` → 对应 voice 被移除、另一音保留（测试 150→**151**）。
- npm test 全绿；`node --check`。
