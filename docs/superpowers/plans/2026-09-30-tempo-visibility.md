# 时间维可见化（轮次 21 · 前端）Implementation Plan

> **轮次 21 · 前端**。skill：`ui-ux-pro-max`（chart 域）。
> 目标：轮次 20 给了计划一根时间轴，但界面上任何地方都看不到它——计划卡没有速度信息，演奏中看不到渐慢正在发生，张力带 hover 无读数。

**设计**（三个通道，零新增 id、零新增 canvas）：

1. **计划卡**：`renderPlan` 速度行 `速度 92 BPM · 尾段渐慢至 74`（74 = round(bpm × tempoMultAt(末小节))；末小节乘数 ≈1 时省略后半）。纯文本通道，与「曲式 A 8 小节 · …」同级。新纯函数 `planTempoLine(plan)`。
2. **实时读数**（nowBar）：演奏中显示当前小节的实际速度 `第 25 小节 A1 · 强度 2.3 · 速度 86`——Coda 渐慢时数字当着用户的面掉下去，rit. 从「计划里的一句话」变成「正在发生的事」。
3. **张力带 hover**：`TensionGraph` 加 crosshair + 画布内读数（`第 N 小节 · 张力 0.63 · 计划 0.58 · Cm7 · 速度 86`）。每小节元数据（和弦名、速度乘数）由 main.js 在 `onBar` 时 `pushMeta`。

**skill 规则的落点**：
- *"Relying on hover only" 是反模式* → 无 hover 的读法已存在（tensionStat 文本行 + aria-label），hover 只做增强；触屏拖动等同 hover。
- *"Mark … with text annotation as well as color"* → crosshair 读数全部是文字。
- 克制（延续轮次 18 onboard 原则）：不弹 tooltip 组件、不加 DOM 层——读数画在 canvas 里，指针离开即消失。

**测试**：`planTempoLine`（有/无 rit、脏输入）、`hoverBarAt`（命中/边缘/空数据）。验证：npm test 全绿、12 种子指标逐位不变（纯展示层）、id 契约不新增。
