# 和声罗盘（轮次 45 · 创意）Implementation Plan

> **状态：部分完成（2026-09-30 诚实标注）**。已落地内核与最小可视化，但可视化本体未达到可交付标准——
> 未完成清单见下，接力条在 MEMORY.md 任务板。补完前请勿把本条目标记为完成。

## 已完成（轮次 45 实际交付）

- `fifthPos(rootPc)` = `(rootPc×7 mod 12)/12` 圆映射纯函数（有单测）：相差五度 = 圈上邻位 = 声部进行最近——轮次 2 声部进行加权的几何显形。
- `compassPoints(rootPcs)` 归一化轨迹点纯函数（有单测：圆心距恒等于半径、脏 pc 过滤）。
- `CompassCard` 类（MotifCard 骨架）：外圈刻度 + 最近 16 小节根音轨迹，挂在实时界面动机卡旁。
- 脏输入降级（NaN→顶点）、LEGEND_ITEMS「罗盘」条目（覆盖测试加了关键词）。

## 未完成清单（按优先级，证据为文件:行）

1. **尺寸不可读（阻塞项）**：`public/styles.css:686` `#compassCanvas { width: 96px; min-height: 48px }`，
   HTML 无 height 属性，被 `.motif-box`（align-items: stretch）拉到动机卡高度 ~48px——
   圆半径 `R = min(W,H)/2 − 12 ≈ 12px`，12 个刻度 + 轨迹挤在里面基本不可读。
   **修法**：罗盘不该塞在动机卡行里——独立一行，高度 ≥120px（或放到和弦区/张力带之间的空档）。
2. **轨迹点不编码功能色**：所有点一律黄铜（`CompassCard.draw`），T/S/D/Tp 四色是现成的
   （`FN_COLOR`/`fn-${fn}` 通道），罗盘点是免费的第二通道，没接。修法：push 时带上 `chordFn`，点按功能着色。
3. **工作室无罗盘**：编辑主战场没有该能力（违背轮次 34 确立的「能力做一次，界面各自认领」）。
4. **图例半成品**：`LEGEND_ITEMS` 罗盘条目 `swatch: ''`；行内图例（index.html `.fn-legend`）未加罗盘项——
   「标记改了图例没改，比没图例更糟」原则下这是欠账。
5. **无文字读数**：点不可交互；hover/读数应给出「第 N 小节 · 和弦名」（ui-ux-pro-max：hover 只是增强，
   但连增强都没有）。
6. **`CompassCard` 类零测试**：push/reset/max 截断生命周期可测（mock canvas 同 audio.test 的做法）。
7. **移动端**：84px 宽（styles.css:687）在小屏上更不可读；响应式方案未设计。

## 设计存档（补完时遵循）

- 几何：`fifthPos(pc) = ((pc×7 mod 12)+12)%12 / 12`，顶点起顺时针；**不要改**——「邻位 = 相差五度 = 声部最近」
  是这个映射的全部意义（轮次 45 曾把测试期望写成 `fifthPos(7)=7/12`，错的是期望不是公式）。
- 通道纪律：功能色归点（与功能轨同源 `FN_COLOR`），形状/文字通道另有其职；罗盘是氛围+模式层，
  不承载必须读到的信息（闭上眼睛不丢信息）。
- 骨架沿用 MotifCard（ResizeObserver + setInterval 非 rAF）。

## 验收（补完时）

- 罗盘在 961px+ 宽度下刻度与轨迹清晰可辨（半径 ≥48px）
- 点带功能色且与功能轨/图例同源（`FN_COLOR` 单一来源）
- 行内图例 + 图例抽屉 + LEGEND_ITEMS 三处同源且 swatch 非空
- `CompassCard` 生命周期有测试；`npm test` 全绿；12 种子指标不变（纯展示层）
