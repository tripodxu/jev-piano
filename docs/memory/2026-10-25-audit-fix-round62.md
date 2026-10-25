# 2026-10-25 · 审计修复轮 62：LLM 清单漂移 + expandPlan 超时 + 启动异常恢复 + 导入校验收紧

轮次 61 全量审计（~20 项发现）的第一批修复——四个正确性缺陷一次结清。审计报告全文见会话记录；三项低优先债务顺手清了。

## 做了什么

**领地**：`jev.js`、`main.js`、`studio-core.js`、`composer.js`、`scripts/analyze-repetition.mjs` + 三份测试（jev/theory/studio）。

1. **B2 · LLM 提示词清单漂移（产品缺陷）**：`PLAN_SYS_PROMPT` 的曲风/调式清单改为**从 STYLES 派生**（`STYLE_IDS`/`MODE_IDS`），不再写字面量。轮次 58 加蓝调时字面量漏了 `blues`/`mixolydian`——UI 与关键词路由都能选蓝调，LLM 扩写永远不能。「一处登记、多处引用」的清单必须派生，这次派生 + 对账测试都做了。
2. **B1 · expandPlan 无超时**：与 `askJev` 同纪律——默认 12s（`timeoutMs` 可配），用户主动取消（外部 signal 触发）仍原样上抛，超时走失败路径回退关键词计划。此前 LLM 端点挂住 = `buildPlan` 无限等 = 实时页卡「… 编曲中」数分钟。
3. **B3 · start() 异常恢复**：`buildPlan` 这个启动路径上唯一的外部 await 包进 try/catch——失败恢复按钮 + toast，不再让「… 编曲中」挂到刷新。
4. **B4 · validatePiece 收紧**：barChords 逐项校验（startBeat/rootPc 有限 + shape 是字符串——畸形项此前会让分析层产出脏值）；nid 类型漂移（老存档）重算而不是拒。
5. 小清理：D4 `chordSymRawRaw`→`modelChordAnswer`；D5 analyze-repetition 的陈旧 `jev-1.13` 版本标签改 `typesafe`。

## 新增守卫（3 条测试）

- jev.test：**PLAN_SYS_PROMPT 与 STYLES 同源**（每个曲风 id、每个 style.modes 调式都必须出现在提示词里——加风格漏提示词从此会红）；expandPlan 超时快速失败 + 用户取消仍上抛。
- theory.test：**STYLES 与 index.html 两处静态清单对账**（每个风格的 chip + option 都必须在——dom-contract 只对 id 不对 option，这是补上的那个洞）。
- studio.test：validatePiece 畸形 barChords 拒、非法 nid 重算。

## 坑（一个，值得记）

- **`AbortSignal.timeout` 的定时器不保持 Node 事件循环存活**（unref 语义）——测试里的假 fetch 只挂 abort 监听器时，空循环里 promise 永不落定（`cancelledByParent: Promise resolution is still pending`）。改用真 `setTimeout` 轮询 `signal.aborted` 才稳。写「超时」测试前先想清楚谁在养活事件循环。

## 验证

npm test **216→220 全绿**；gate 12 种子均值不变（fixture 路径零改动——清单只影响 LLM 路径）；行数 jev 229 / main 458 / studio-core 268 / composer 544。

## 下一步

轮次 63（安全）：worker 同源防护（Content-Type 强制 + Sec-Fetch-Site/Origin 校验）+ 部署。轮次 64（性能）：卷帘契合度缓存、avoid 免展平、长会话状态上限。
