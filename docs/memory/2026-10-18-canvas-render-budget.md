# canvas 渲染预算：静止画布不再自我重绘 + draw 不再逐帧读布局（轮次 51 · 优化） · 2026-10-18

> **静止的像素每 120ms 重画一次，不会有任何测试报红——它不是 bug，是账单。**
> 一个"没人看也在画"的画布，和一行死代码的区别是：死代码不耗电。

## 做了什么（领地 `public/js/ui.js` / `public/js/studio.js` + `test/ui.test.mjs`）

三处改动，都是把「每帧无条件做一次的工作」换成「只在必要时做」：

1. **尺寸缓存**（`ui.js` Fall / TensionGraph / MotifCard 的 `_resize`）：三个类本来就各有一个 `ResizeObserver`，
   但 `draw()` 里仍然每帧读 `canvas.clientWidth/clientHeight`。现在把宽高在 `_resize` 里存进 `this.w/this.h`，
   `draw()` 只用缓存（0 时早退）。`Fall` 30fps、另两个 8fps —— 合计 **~47 次/秒的强制同步布局**变成 0。
2. **静止画布按需重绘**：`TensionGraph.draw()` 完全静态（只依赖 actual/target/sections/meta/totalBars/hoverX，
   而这些入口——`push`/`setTarget`/`setSections`/`setTotalBars`/`reset`/`pointermove`/`_resize`——本来都各自调了 `draw()`），
   却由 `start()` 起了个 `setInterval(draw, 120)` 常驻重绘。现在 `start()` 只画一帧。
   `MotifCard` 唯一需要动画的是「承袭后 900ms 的强调描边」，于是改成**窗口内有限次自排程**（`_pulse()`）：
   窗口一关闭就停手并补一帧常态描边。判据抽成纯函数 `pulseActive(pulseAt, now, ms)`，时钟可注入。
3. **工作室播放头（`studio.js` `drawPlayhead()`，30Hz）**：原来先写 `els.playhead.style.left` 再读
   `els.rollWrap.clientWidth`/`scrollLeft` —— **写后读 = 每帧一次强制 reflow**。改成「先读完布局再写」；
   并且 `els.chord.textContent` 只在和弦真的变了才写（原来每帧写同一个字符串，30 次/秒触发样式失效）。

## 为什么这么做（以及被否决的做法）

- **切入点来自一次实测，不是猜测**：注入计数后发现播放中每秒 `clearRect` 47.6 次
  （Fall 30.3 + 张力带 8.3 + 动机卡 8.3），其中 **16.7 次/秒画的是完全没变的内容**。
- **被否决：换回 rAF**。AGENTS.md 早就写明「动画类 canvas 用 setInterval 而非 rAF——标签页遮挡时 rAF 会被浏览器暂停」，
  这条对 `Fall` 依然成立。真正的错误不是用了 setInterval，而是**给静止内容也安排了节拍**。
- **被否决：给 `Fall` 降帧**。它是真动画，30fps 是它该有的成本。
- **没写 ADR**：这是展示层的能耗/布局纪律，落在 AGENTS.md §2 的「修改高危区」就有约束力；
  架构级决策（ADR）留给"模型选、代码写"这类不可动摇的东西。

## 坑（都给下一个 agent）

1. **我差点因为指标选错而放过它**。第一反应是"这会不会卡"，于是用 `PerformanceObserver('longtask')` 测 6 秒——
   **0 个长任务**。修完再测，还是 0 个长任务。差别的正确量度是「每秒重画次数」和「每秒布局读取次数」，不是掉帧。
   **同一个现象，选错指标就会得出"不用修"的结论。**
2. **这台 harness 上 ego 浏览器的 Performance/Profiler 域不可用**：`Profiler.enable` 之后 `Profiler.start` 仍报
   `Profiler is not enabled`，并且**直接把 ego-browser 进程带走**（exit 1，页面掉回 `about:blank`）。
   可用替代：在页面里自建 instrumentation —— 给 canvas 实例打 `clearRect` 计数、
   用 `Object.defineProperty` 在目标元素上覆盖 `clientWidth`/`clientHeight` 计数 getter。**实测数字一样拿得到。**
3. **`pulseAt` 的哨兵值**：原来是 `0` 表示「没有强调」，配 `this.pulseAt && ...`。时钟一旦可注入，
   `0` 就是合法时间戳——测试里 `now = 0` 会让强调静默失效。改成 `null`，判据走 `pulseAt != null`。
   **「用 0 当空」在数字世界里迟早出事**，只是因为 `Date.now()` 不会返回 0 才一直没暴露。
4. **一次失败的 `ego_click`（元素不存在）会终止 ego-browser 进程**，连带后台的 dev-proxy 任务一起消失；
   恢复流程 = 重起 `python dev-proxy.py --port 8011` → `ego_navigate` → `Page.reload {ignoreCache:true}`。
   改前端后**务必用 ignoreCache 硬刷新**，否则量到的是旧模块。
5. 顺带修掉 `ui.js` 里一处既有的乱码注释（`画成一���「形状」` → `画成一条「形状」`）。

## 验证

| 关卡 | 结果 |
|---|---|
| `npm test` | **189 → 194 全绿**（新增 `test/ui.test.mjs` 5 条：`pulseActive` 窗口边界 / TensionGraph 不起 setInterval 且 push+setSections 仍重绘 / 三块 canvas 的 `draw()` 读布局次数为 0 / MotifCard 强调窗口内自排程且自动停手 / `stop()` 清在途排程） |
| `node --check` | `ui.js` `studio.js` 通过 |
| `npm run gate` | 12 种子均值 **9.08 / 2.54 / 32.00 / 31.58，相邻重复 0**——与轮次 48 基线逐位一致（纯展示层，无音乐输出变化） |
| 浏览器实测（播放中） | `clearRect` **47.6/s → 29.9/s**（Fall 27.7 仍在动画；张力带 8.3→1.2；动机卡 8.3→1.0）；三块 canvas 的布局读取 **~47/s → 0/s** |
| 浏览器实测（工作室播放头） | 和弦文本写入 **30/s → 0.3/s**；布局读取仍在，但已全部移到写之前，不再每帧强制 reflow |
| 回归 | 实时视图 / 张力带 / 工作室卷帘截图逐一比对无视觉差异；`window.__errs` 为空、`__jevDebug()` 正常（`ctxState:running`、`fallErrs:[]`、音符与队列持续增长），状态栏 tok/费用/延迟照常累加 |

测试手法（供复用）：`test/ui.test.mjs` 里用**假 canvas**（`getContext` 返回 Proxy no-op 的 2d 上下文并给 `clearRect` 计数；
`clientWidth/clientHeight` 用计数 getter）+ 假 `ResizeObserver` + **同步替换** `setInterval`/`setTimeout` 后立刻还原。
于是「不读布局」「不起常驻定时器」这两条**能耗契约**第一次有了红绿灯，而不是只能靠人盯着看。

## 下一步（都可被任务板拾取）

- `Fall` 仍有 30fps 的空档重绘（`notes` 为空时也 clear + 遍历）。收益小于改动风险，先记着。
- 桌面端 `Fall` 的 `shadowBlur`（`lite` 只在 ≤980px 关闭）在 HiDPI 大画布上仍是单帧最大成本，可用实测决定是否按音符数降级。
- `audio.js` 每音 3 个振荡器 + 每个 voice 一个 BiquadFilter：复音 32 时是 ~128 个节点，值得量一次。
