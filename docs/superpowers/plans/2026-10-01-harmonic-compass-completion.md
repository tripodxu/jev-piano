# 和声罗盘补完（轮次 49 · 前端）Implementation Plan

> 接续 [2026-09-30-harmonic-compass.md](2026-09-30-harmonic-compass.md)。
> 上次的内容缺陷：① 尺寸不可读（96×48px 盒内半径 ~12px）；② 工作区无罗盘；③ 触屏无读数。
> 本次**通过「一个共享叶子的两个视图」一次性解决**，而不是单独修尺寸。

## 交付内容

| # | 交付 | 落点 |
|---|---|---|
| D1 | `CompassCard` 改为**分量重排**：罗盘占满卡片宽度（宽高各 ≥120px → R ≥ 48px），读数行跟随 | `public/js/ui.js`（draw）、`public/styles.css`（:686 附近） |
| D2 | 读数行 + 空状态：「第 N 小节 · 和弦名 · 功能 · 同音/五度/远跳」，`compassStatLine` 纯函数 | `public/js/ui.js` |
| D3 | 响应式：≥980px 并排（motif 0.9 : compass 1.1）、<980px 堆叠，两者都 ≥120px | `public/styles.css` |
| D4 | **工作室接入**（能力做一次，界面各自认领）：`drawCompassCard(ctx, …)` 纯绘制 + `CompassCard` 渲染委托给它；工作室卷帘头部新增罗盘块（`COMPASS_H = 132`） | `public/js/ui.js`、`public/js/studio.js` |
| D5 | 图例半成品补齐：`LEGEND_ITEMS` 罗盘 swatch 非空（新 `lg-sw.compass`）+ 行内图例加「罗盘」项 | `public/js/ui.js`、`public/index.html`、`public/styles.css` |
| D6 | `CompassCard` 生命周期测试（mock canvas，仿 audio.test 的 mock 思路） | `test/ui.test.mjs` |
| D7 | 可见性硬验收：把「半径 ≥48px」写进测试可断言的纯函数 `compassRadius(w, h)` | `public/js/ui.js`、`test/ui.test.mjs` |
| D8 | 文档同步：AGENTS.md 行数表 / README 测试数 / MEMORY 记忆与任务板 | 三份文档 |

## 明确不做（并写明理由）

- **触屏 hover 读数**：罗盘本体（最近 16 小节轨迹）本来就是常驻读数，hover 只是锦上添花；
  触屏设备上引入 pointer 查询的复杂度收益不成比例。**如实记录，不假装做了。**
- **`compassPoints` 的 API 变更**：现有单测断言「点到圆心距离恒为 0.42」，
  改为「支持每点半径」会直接打破该断言——而 **§5.4 禁止删测试**。
  工作室复用路线走 **D4 的共享绘制函数**（渲染逻辑搬一次），而不是改数据契约。

## 关键设计判断

1. **尺寸不能只改 CSS**：盒高由 canvas 的 CSS 高度决定，`min-height` 撑开即可；
   但 `.now-bar`（`aria-live="polite"`）会被 RoI 音量计**每帧改写**，
   所以罗盘读数**不能**与它共用节点，必须新开 `.compass-readout`。
2. **对齐是构造出来的**（轮次 6/15 的教训）：工作室罗盘与卷帘音符区**共用 `ZOOM` 与 `rollwrap`**，
   横轴天然对齐、滚动天然同步——零同步代码。
3. **功能色单一来源**：点色走 `FN_COLOR`（与功能轨/图例同源），不新造调色板。

## 验收

- `npm test` 全绿（178 → 更多，只增不减）
- `node --check` 改动文件全过
- 12 种子 `npm run gate` 指标**逐位不变**（纯展示层）
- 几何核对：`compassRadius(x, 132) ≥ 48`（有测试断言）
- 人眼可读：本地 http server + 浏览器实际查看截图
- 三处图例同源：`LEGEND_ITEMS` / 行内图例 / 抽屉，swatch 非空
