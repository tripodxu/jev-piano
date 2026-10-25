# 2026-10-25 · 轮次 51–58 上线部署 + 核验（迭代轮次 59 · 部署）

## 做了什么

用户指令「部署，并测试」。把轮次 51–58 共 8 轮改动推上生产边缘。

1. **核验清单先行**：`scripts/verify-deploy.mjs` 的 CHECKS 从轮次 50 状态同步到轮次 58——保留 48/49/50 的关键现场（决策预算/布局常量/工作室记账），新增 6 个文件的片段：cadence.js（55）、canvas.js（52+56）、studio-roll.js（54+55+57）、ui.js 的 keyEchoText/markDiff（55/57）、music.js 的 blues（58）、index.html 的回声条与蓝调选项。11 个文件条目 + probe + jev。
2. **部署**：`npx wrangler deploy` → Version `bb200a98-4464-4654-b8ea-f3760d029129`，10 个资产全部上传（含 3 个新文件 cadence.js / canvas.js / studio-roll.js），Worker 启动 2ms。
3. **核验（内容层全过）**：`node scripts/verify-deploy.mjs --no-api` 退出码 0——**11/11 文件片段全命中 + /api/probe 200**。边缘上跑的确实是轮次 58 的代码。
4. **核验（真渠道异常，已定性）**：`/api/jev` 返回 502 `all jev backends failed: upstream 451`，重试仍复现——**持续性、非网络抖动**。451 是上游的策略性拒绝。排查：`wrangler secret list` 显示 TYPESAFE_API_KEY 仍在；worker.js 自轮次 43 未改过；轮次 50 同端点同 key 是通的（jev-1.13.0，560–1676ms）。**结论：上游侧变更**（对 Cloudflare Workers 出口的地区封锁，或 key 被回收/限制），不是本次部署的回归。

## 影响与现状

- **部署内容正确性已证**：磁盘 = 边缘，逐片段命中。
- **真实 Jev 渠道当前不可用**：前端会走设计好的兜底——toast 一次性告知「真实渠道暂时不可用，由离线随机接管」，播放永不中断（红线 7）。工作室/实时界面对用户仍完全可用，只是决策来自 fixture（不产生费用，台账显示 0 tok——这正是轮次 50 修的口径）。
- **修复路径在仓库外**：需要新的 TYPESAFE_API_KEY，或上游解除对 Workers 出口的封锁；换渠道（openrouter 直连）也可绕开——`settings` 里用户可自行配置 OpenRouter key，无需重部署。

## 验证

- 部署前 `npm test` 216/216 全绿（轮次 58 收官状态）。
- 部署后：11/11 片段 + probe 全过（exit 0）；/api/jev 451 复现两次（含 --no-api 复跑对照）。
- 浏览器端到端冒烟未做（本环境无浏览器）：新 UI 功能（跟弹三件套/终止式/和弦键/蓝调选项）建议用户硬刷新 https://jevpiano.logicc.top/ 自行过一遍；接线均有单测。

## 下一步（任务板）

- **[进行中] 真实 Jev 渠道 451**：等新 key 或上游解封；用户也可在设置里配 OpenRouter key 自行绕开。上游恢复后重跑 `node scripts/verify-deploy.mjs` 确认。
