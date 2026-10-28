# 2026-10-28 · 轮次 71：琴键与声音同步（以音频时钟为唯一时间基准）

## 一、根因：两套时钟

琴键亮起走的是**挂钟 `setTimeout`**，而音频走 `AudioContext` 精确排程。全项目共 4 处：

| # | 位置 | 写法 |
|---|---|---|
| 1 | `main.js`（AI 演奏） | `setTimeout(() => kb.flash(...), (ev.t - currentTime) * 1000)` |
| 2 | `ui.js`（`flash` 内部） | `setTimeout(() => el.classList.remove('on'), Math.max(80, durSec * 1000))` |
| 3 | `ui.js`（点击反馈） | `setTimeout(() => key.classList.remove('on'), 240)` |
| 4 | `studio.js`（回放） | 同 #1 + #2 的组合 |

对照：`canvas.js` 的 `Fall`（下落音符）用的却是 `audio.ctx.currentTime`。
**同一个音的两套视觉，一个准一个不准。**

## 二、七条具体后果

| | 后果 |
|---|---|
| A | 事件循环拥塞 / 后台标签页节流 → 键晚亮，且**误差逐音累积** |
| B | 固定轮询粒度 30ms → 每个音最多晚一个 tick（16 分音符 125ms 下肉眼可见） |
| C | 亮灭用 `ev.dur`，声音却响到 `t0 + max(dur,0.12) + release(0.28)` → **键永远比声音早灭约 300ms** |
| D | 排程被 `max(whenSec, currentTime+0.005)` 推迟时，键仍按**请求**的 `ev.t` 亮 |
| E | 未补偿 `outputLatency`（蓝牙 200ms+） |
| F | **用户点击琴键没有任何按下视觉**（只有回声文字） |
| G | 力度（vel）不体现在琴键上 |

## 三、方案

### 3.1 `audio.js`：让声音的真实起止成为唯一真相源

```js
play(midi, whenSec, durSec, vel) {
  const t0 = Math.max(whenSec, this.ctx.currentTime + 0.005);  // 可能被推迟
  const stopAt = t0 + Math.max(durSec, 0.12) + release;        // 含 release 尾巴
  ...
  return { midi, t0, offAt: stopAt, vel };
}
outputLatencySec() { ... }  // baseLatency + outputLatency，夹在 [0, 0.25]
```

### 3.2 `keysync.js`（新，149 行）：音频时钟驱动的状态机

- `clock()` **必填，不传就抛错** —— 不给"忘了接音频时钟"静默退化成挂钟的机会
- **定时到下一个事件本身**（`_scheduleWake`），而非固定 30ms 轮询；
  **判定一律用音频时钟** → 定时器抖动只影响本次唤醒，不累积
- 无音符时**不起定时器**（静止类能耗契约）
- 长卡顿后**过期事件不补亮**（`if (ev.offAt <= now) continue`）—— 否则键盘回放一串迟到动画
- 连奏重叠：`offAt` 取更晚者，键不被前一个音顶灭
- `advance(now)` 是**纯函数**（不碰 DOM、不读时钟）→ 可在 node 里用假时钟逐毫秒验证

### 3.3 接线

- `player.js`：`onNoteCb(ev, voice)` 把真实起止传出去
- `ui.js`：`renderKeyboard` 删 `flash`、加 `syncLit(changes)`；`attachPlayableKeyboard` 内建 `KeySync` 并挂在返回句柄上
- `main.js` / `studio.js`：AI 演奏与回放的音符都走 `kb.keySync.schedule(v.midi, v.t0, v.offAt, v.vel)`
- **两个界面共用一个 KeySync** —— 各建一个会互相抢同一个键的熄灭时刻

### 3.4 力度

`syncLit` 把 `vel` 写进 CSS 变量 `--kvel`，`.wk.on` / `.bk.on` 用 `calc()` 调制
`brightness` 与 `translateY` —— 视觉强弱与音量同源。`--kvel` 登记在 `tokens.css`
（运行时变量区），否则 style-contract 的「var() 必须有定义」会红。

## 四、踩坑

1. **删 `flash` 时漏了 `studio.js:272`** —— 只 grep 了自己改的路径。语法检查过得去、**运行时才崩**。
   改共享导出必须全项目 grep 调用点。
2. **假时钟的坐标系**：harness 起始 `now = 1000` 却按 `t = 10` 排程，时间根本推不动。
   起点与测试用的时刻必须同一坐标系（后来改成可传 `now0`，默认 0）。
3. **轮询粒度暴露的设计问题**：第一版用固定 30ms 轮询，测试断言"误差为零"直接红——
   这不是断言太严，是**实现真的不够好**，于是改成定时到事件本身。

## 五、测试 247 → 260

`test/keysync.test.mjs` 13 条，全部假时钟：基本时序、长音、16 分音符连奏（逐音精确对账）、
力度、输出延迟补偿、大跳不补亮、能耗（无音符不起定时器）、`stop`/`clear`、
以及与 `audio.js` 真实起止的三条对账（含"迟到排程"与"熄灭时刻 = 声音停止时刻"）。

**变异验证**：去掉延迟补偿 → 红；去掉过期跳过 → 红。

## 六、验证要点（人工）

| 场景 | 怎么测 | 期望 |
|---|---|---|
| 快速连奏 | 16 分音符密集段（或电脑键盘狂敲） | 键与声一一对应，不丢音、不提前灭、无累积延迟 |
| 长音 | 低音持续 4 秒 | 键整段亮着，不在中途掉 |
| 延音尾巴 | 短音（0.1s） | 键灭的时刻与"听不见"的时刻一致（不再早灭 300ms） |
| 卡顿恢复 | 播放中切到别的标签页几秒再切回 | 不回放一串迟到动画，回来即与当前声音一致 |
| 力度 | 同一旋律不同 vel | 键的下压幅度与提亮程度随力度变化 |
| 输出延迟 | 戴蓝牙耳机 | 键与耳朵听到的对齐（视觉已提前 outputLatency） |
| 停止 | 演奏中点停止 | 键立即全灭，不在停止后自己亮起来 |

## 七、数据

- 测试 **247 → 260**，全绿
- `npm run gate` 12 种子均值 **9.08 / 2.54 / 32.00 / 31.58** —— 与改动前逐位一致（乐理逻辑未动）
- 部署 Version ID `3eaf2e24-ec6c-4c60-9490-8f15cac27a17`，`verify-deploy` **21/21**

## 八、未完成

项目**没有踏板**功能（`audio.js` 只有 `release = 0.28` 的松键尾巴，无 sustain 概念）。
`KeySync` 已留 `sustainSec` 接口——接踏板时只改这一个数，不必再动状态机。
当前"延音"= 音符时值 + release 尾巴，已由 `offAt` 精确覆盖。
