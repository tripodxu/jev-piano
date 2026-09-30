# 工作室卷帘 hover 读数（轮次 34 · 前端）Implementation Plan

> **轮次 34 · 前端**。skill：延续 `ui-ux-pro-max` chart 域既得规则（hover 只是增强、读数全文字、不依赖颜色）。

## 动机

轮次 21 给实时界面的张力带加了 hover 读数，但**工作室卷帘——编辑的主战场、最需要逐小节检视的地方——没有**。编辑者在卷帘上问的正是轮次 21 那句话：「这个低点是小节几、什么和弦、张力多少」。本轮把同一能力对齐到卷帘头部（张力曲线/功能带/和弦名/契合度带四段共用区）。

## 设计

- 卷帘画布加 pointermove/pointerleave：光标所在小节画 crosshair + 头部左上文字读数 `第 N 小节 · Cm · 张力 0.63 · 契合度 71% · 速度 86`。
- 数据全部现成：`chordAt`（和弦）、`tensionOf`（张力缓存）、`barHarmonyFit`（契合度）、`tempoMultAt`（速度）——零新数据管道。
- 纯函数 `barIndexAt(beat, meter, totalBars)` 导出并单测（边界：拍点越界/非整数/空）。
- 读数是 canvas 文字（与卷帘既有文字同风格）；crosshair 用段落虚线同款（视觉语言不新增）。

## 验证

npm test 全绿（153→155）· id 契约不新增 · node --check · 12 种子指标不变（纯展示层）。
