# 审查加固轮 · 2026-09-28 07:51（commit 83fbe46）

- **做了什么**：
  - **Worker 加固**：`/api/llm` 改为**封闭转发**——只转发服务端 env 配置的端点与凭据，忽略请求体里的 baseUrl/apiKey/model（防开放中继/SSRF）；`/api/jev` 与 `/api/llm` 共享每 IP 滑动窗口限流（`RATE_LIMIT_PER_MIN` 默认 30/min，isolate 内存计数，多实例尽力而为）；Jev 后端链式降级（Workers AI 绑定 → TYPESAFE_API_KEY → OPENROUTER_API_KEY），单后端失败自动落下一个。
  - **实时韧性**：Jev 请求重试次数与 **10s 超时**；429/529 指数退避（250ms×2^n，最多 4 次，带抖动）。
  - **a11y**：对比度修正、focus-visible、aria 标注。
  - **canvas 性能**：lite mode、下落音符数量上限。
- **为什么**：e2e 通过后按"会被真实用户和真实网络攻击"的标准过一遍——开放中继等于把自己的 key 借给全世界；决策失败必须被超时兜住而不是卡死播放。
- **坑**：
  1. **CF  Workers 环境浏览器直连 TypeSafe 官方 API 被 CORS 拦截（实测）**——直连渠道仅适用于允许 CORS 的端点；生产环境走同源代理（本 Worker）。
  2. 限流是 isolate 内存计数：单实例精确，多实例部署只是下限保护——文档必须如实写"尽力而为"，不能宣称精确。
  3. 10s 超时与"提前 2 小节决策"配合才不断流：单次请求最坏 10s < 一个小节时长（60–140 BPM 下 0.86–4s）×2 提前量。
- **验证**：`npm test` 全绿；worker 语法检查（`node --input-type=module --check < src/worker.js`）。
- **下一步**：无（本轮为收尾加固）。
