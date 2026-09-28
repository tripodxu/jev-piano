# ADR-0004: 零框架、零构建、零运行时依赖

- **状态**：接受 · **日期**：2026-09-28
- **背景**：项目定位是"轻量、可直接部署、长期可维护"的即兴钢琴。引入框架/构建链的代价：依赖膨胀、构建配置腐化、CF Workers 静态部署复杂化、新人上手成本。
- **决策**：**原生 ES Modules + 原生 Web Audio API**，无任何运行时依赖；`npm test` 用 Node 内置 `node --test`；部署 = `wrangler deploy` 静态资产；本地 = `python dev-proxy.py`（stdlib only）。devDependencies 仅 wrangler（部署工具，不进浏览器）。
- **理由**：
  1. 调研结论（dev.to 300 行先例 + jevtown 实测）验证纯原生足够；
  2. 全部模块是纯函数/小类，天然可单测——不需要框架的测试生态；
  3. CF Workers assets 直接托管，无构建步骤；
  4. 每个文件 ≤800 行、职责单一，人读 agent 读都无负担。
- **被否决的方案**：
  - *React/Vue SPA*：为"键盘+canvas+几个面板"引入框架是过度工程；且工作室的确定性编辑用纯函数实现更可测，否决。
  - *Tone.js*：功能诱人（调度/音色）但本项目只需 lookahead 调度（~100 行自写）+ 合成钢琴（~120 行自写），否决为**音质升级备选**（@tonejs/piano 采样，需另立 ADR，代价数 MB）。
  - *tonal（乐理库）*：~200 行手写乐理内核已覆盖全部需求，引入依赖无收益，否决。
- **后果**：新增 npm 依赖（尤其运行时依赖）需要一篇 ADR 说服（AGENTS.md 红线一）；性能优化靠手写（canvas lite mode 等）而非换框架。
