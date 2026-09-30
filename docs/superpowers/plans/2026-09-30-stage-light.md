# 舞台灯光随张力呼吸（轮次 31 · 创意）Implementation Plan

> **轮次 31 · 创意**。skill：延续 `impeccable` craft-floor（午夜音乐厅世界的既定视觉语言优先）。

## 创意核心

午夜音乐厅有了曲式、张力、问答、速度——但舞台本身不动。让**舞台灯光**随音乐张力呼吸：张力升起时顶部黄铜顶光变暖变亮（属功能的猩红区），回落时底部冷青地光透出来（主功能的安定）。这是**纯展示层**——只读 `barTension`，不参与决策；已有的第三套通道原则不破坏（灯光是氛围，不承载任何必须读到的信息——所有信息仍有文字/形状通道）。

## 设计

- `ui.js` 纯函数 `stageLightFor(tension)` → `{ warm, cool }`（暖顶光/冷地光的不透明度）：warm = 0.05 + t×0.16，cool = 0.16 − t×0.10；脏输入降级中性 0.5。上界 ≤0.21——**氛围不该抢戏**（delight：重复一百次还讨喜）。
- `index.html`：`.stage` 头部插入两个 `aria-hidden` 灯光层（暖=黄铜径向顶光、冷=冷青径向地光，`mix-blend-mode: screen`），id `stageWarm`/`stageCool`（契约 87→89）。
- CSS：`.stage-light { transition: opacity 1.4s ease }`——小节间的渐变就是「呼吸」；`prefers-reduced-motion` 已有全局豁免（0.01ms）。
- `main.js` onBar：复用已算的 `barTension(bar)` 设两层透明度。不碰决策层，12 种子指标逐位不变。

## 验证

npm test 全绿 · stageLightFor 单测（端点/夹取/脏输入/单调）· id 契约 89 · node --check。
