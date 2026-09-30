# 键盘点击试听（轮次 40 · 前端）Implementation Plan

> **轮次 40 · 前端**。skill：延续 `impeccable` craft-floor（午夜音乐厅的钢琴应该是乐器，不是布景）。

## 设计

两个界面的键盘目前是纯可视化（`aria-hidden` 装饰）。点击琴键**立即发声**（合成钢琴同音色，0.9s、中等力度），让用户在输入灵感前后都能「摸一摸」这件乐器：

- `renderKeyboard(container, { low, high, onKey })`——签名从位置参数改为选项对象，事件**委托到容器**（49 个键一个监听器），pointerdown 命中 `data-midi` → `onKey(midi)` + 键帽瞬时 `on` 反馈。
- `main.js`：`onKey = (midi) => audio.ensure().then(() => audio.play(midi, ctx.currentTime + 0.01, 0.9, 0.7))`——点击本身是用户手势，`ensure()` 合法；未开演也能试音。
- `studio.js`：同一能力接到工作室键盘。
- 保留 `flash/clear` 原契约；`aria-hidden` 不动（指针试听是增强，完整键盘导航是独立的无障碍工程，如实记录不做）。

## 验证

npm test 全绿（渲染契约不受影响）· `node --check` · id 契约不新增。
