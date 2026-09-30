# composer.js 拆分（轮次 25 · 优化）Implementation Plan

> **轮次 25 · 优化**。composer.js 830 行，超过 ADR-0004 第 4 条自设上限（**每个文件 ≤800 行**）。

**拆分设计**：按「决策器 vs 渲染内核」的既有职责线切（AGENTS.md 代码地图里 composer.js 的职责注释早已写明「七问 + 渲染内核」，但物理上没分家）：

- 新建 `public/js/render.js`：**纯渲染内核**——`CONTOUR_STEPS`、`DEVELOP_OPS`、`velFor`、`scaleNext`、`sigOf`、`snapLastToChord`、`insertPassing`、`compressRhythm`、`mutateMelody`、`melodyIntervals`、`buildFromPrev`、`breatheDelay`、`buildFromMotif`、`varyPattern`、`renderMelody`、`renderLH`。全部是「给定计划/和弦/rng → 音符」的纯函数（rng 注入），只依赖 music.js。
- `composer.js` 保留：计划装配（buildPlan/sanitizeSections）、决策器（Composer/七问/候选集消费/归因）、强度连续化常量、`mulberry32`。从 render.js 导入渲染函数。
- **测试契约零改动**：测试只导入 `buildPlan, Composer`；`render.js` 的函数经由 composer 间接被全部既有测试覆盖，之后可直接对 render.js 写针对性测试（本模块行数 ~210，处于健康区间）。

**验收**：
1. npm test 全绿（138，只增不减）；
2. **12 种子指标逐位不变**——纯代码搬移是重构的唯一硬验收；
3. composer.js ≤800 行；`node --check` 全过；
4. AGENTS.md 代码地图同 commit 更新（新增 render.js 行、composer.js 行数与职责描述）。
