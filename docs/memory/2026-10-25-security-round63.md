# 2026-10-25 · 安全轮 63：Worker 计费端点同源防护（审计 S1）

## 做了什么

审计 S1（中危）的修复 + 部署。**领地**：`src/worker.js`、`test/worker.test.mjs`、`scripts/verify-deploy.mjs` + 文档。

**漏洞回顾**：`/api/jev` 与 `/api/llm` 不校验 Content-Type 与 Origin——跨站 fetch 用 `Content-Type: text/plain` 发 POST 属「简单请求」**不触发预检**，任何恶意网页都能借访问者的浏览器静默打这两个计费端点烧部署者的 key（响应无 CORS 头不可读，但上游调用已发生）。唯一缓解是每 IP 90/min 限流，且限流表是 isolate 内存级（多 isolate 放大）。

**修复（三道闸，纯函数 `checkSameOrigin(headers, host)`）**：
1. **Content-Type 强制 `application/json`**（带 charset 也认）——掐掉简单请求这个载体；违者 415；
2. **`Sec-Fetch-Site`**（现代浏览器全量发送）非 same-origin/same-site/none → 403；
3. 无 Sec-Fetch-Site 时**回退 Origin/Referer 主机核对**（老浏览器）；curl/verify-deploy/服务端调用方不带这些元数据头 → 放行。

接线在限流之后、转发之前（最便宜的拒绝路径）。自家前端两个请求都带 `Content-Type: application/json` 且同源——零影响。

## 部署与线上验证（Version `b573ed74`）

- `verify-deploy --no-api` **exit 0**：11/11 静态片段 + probe 200 + **新增负向检查**（text/plain POST → 415，同时是新 Worker 上线的行为证明——worker 源码不是静态资产，CHECKS 拉不到，行为检查是唯一途径）。
- 直打三分支：`text/plain` → **415**（载体被拒）；`application/json` 无 Origin → **502**（正确放行、撞已知的上游地区封锁——过闸但上游 451）；`evil Origin` → **403**。
- 经代理 + 合法形态 → **200，jev-1.14.0 正常回答**：合法路径端到端未受影响。

## 验证

npm test **220→223 全绿**（worker.test +3：415 载体/Sec-Fetch-Site 三态/Origin 回退与 curl 放行）；gate 均值不变。

## 设计取舍

- **不校验 Referer 缺失**（隐私设置会剥 Referer）：Sec-Fetch-Site 时代 Referer 只是回退，缺失放行——校验存在性会把开隐私模式的真实用户挡在门外，得不偿失。
- **same-site 放行**（非仅 same-origin）：给子域变体留余地，CSRF 主载体是 cross-site，挡住它就挡住了成本面。
- 盲 CSRF 只能烧钱不能读数据（响应无 ACAO），所以防护目标是「拒绝执行」而非「拒绝泄露」——415/403 在边缘挡下，不消耗上游配额。

## 下一步

轮次 64（性能）：卷帘契合度缓存、护栏 avoid 免展平、长会话状态上限、addDecision 单次 innerHTML。
