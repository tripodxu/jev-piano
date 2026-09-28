# 2026-09-28 · 段落可见化（迭代轮次 9 · 前端）

> 计划：[../superpowers/plans/2026-09-28-section-visibility.md](../superpowers/plans/2026-09-28-section-visibility.md)
> skill：`ui-ux-pro-max`（chart 域查询，给出了"不依赖颜色"的硬性依据）

## 做了什么

让轮次 8 引入的**段落结构在界面上可见**，四处同时：

| 位置 | 表达 |
|---|---|
| 计划卡 | 纯文本清单：`曲式 A 8 小节 · B 8 小节 · A' 8 小节 · Coda 8 小节` |
| 和声功能轨 | 段落首小节插入 `.fnsec` 标记（虚线竖线 + 段落名） |
| 张力对照带 | 段落边界画虚线竖线 + 段落名（canvas） |
| 钢琴卷帘头部 | 段落竖线贯穿头部 + 段落名（canvas，与音符区共用 ZOOM） |

## 关键设计依据（来自 skill 查询）

`ui-ux-pro-max` 的 chart 域查询直接命中：

> "Mark anomalies with a distinct shape and text annotation as well as color. **Do not rely on color alone.**"
> "use line styles or markers in addition to color"

所以段落边界一律用**两种独立于颜色的线索**：**虚线竖线**（形状/线样式）+ **段落名文字**（文本）。颜色只做辅助，不承担信息。

这条约束对本项目尤其重要——功能轨本身就是**用颜色编码和声功能**的（T 黄铜 / S 冷青 / D 猩红 / Tp 旧金）。如果段落边界也只用颜色区分，灰度或色觉障碍下整条轨会退化成不可读。文字通道让它在任何情况下都能读。

## 验证

- `npm test` 96 → **99** 全绿
- `node --check` 全过
- 元素 id 契约 76/76（本轮**未新增任何 id**）
- **决策指标 12 种子逐位不变**（`chords 9.42 / entropy 2.51 / lh 28.33 / madj 0 / ladj 0`）——纯展示层的直接证明
- 新增测试锁住"不依赖颜色"的不变量：`planLine` 必须是**纯文本**（断言 `!line.includes('<')`，防止有人日后改回 HTML 拼色块）、`sectionLabel` 对数字 id 也要能显示

## 反思

- **skill 的价值不在于它给了什么审美，而在于它给了什么约束。** `ui-ux-pro-max` 的数据库里对这个项目的审美（午夜音乐厅）多半没有对应条目——但它那条"标注不能只靠颜色"是硬规则，而且我确实已经用颜色编码了整个功能轨。**工具给出的约束比工具给出的风格更值钱。**
- **"纯文本等价物"是可以测的。** 我给 `planLine` 加了一条 `assert.ok(!line.includes('<'))` —— 这看着像小题大做，但它把"这是一条无障碍通道"从注释变成了**测试**。注释会被后人删掉，测试不会。
- **三处 canvas + 一处 DOM，共享同一份 `sectionLabel`**。段落名只在一个函数里产生，所以四处显示不可能不一致——**单一真相源在 UI 层和乐理层一样重要。**
- 一个小决定：`pushFnSegment` 的上限计算要给段落标记留出格子（`RIBBON_MAX + min(8, sections.length)`），否则标记会把功能段挤掉。这是个容易漏的细节——如果没做，段落一多功能轨就会变短。

## 下一步候选

- 把 `position.section` / `is_section_start` 喂进 Jev 的 `state`，让模型在段落边界主动收束（任务板已有）
- 段落首小节的和声语义：优先主和弦、段落末用终止式
