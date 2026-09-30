# 解决「只能弹两小节」：决策预算由音频时钟封顶 · 2026-09-30

> **本轮教训**：前两轮（46 限流、47 展示层免疫）都在修「决策失败之后」的事，而真正杀死播放的是
> **「决策太慢」**——HTTP 失败路径本来就能正确回落 fixture（本轮诊断证明了这一点），
> 无界的是**时间**。

## 症状与复现（先复现，后修）

用户原话：**「只能弹两小节」**。轮次 46 修限流、47 修展示层异常后仍在。

脚手架 `scripts/dbg-two-bars.mjs`（一次性，已删）用**虚拟时钟 + 生产形态 fetch** 驱动真实
`Composer` + `Player`，测 10 个上游场景。关键在**听党真相**指标：
`听到的时刻 = max(排程时刻, 派发时刻)`——Web Audio 对排程在过去乐曲是**立即发声**，
所以只看排程时刻会得到「OK」的假象（UI 在假装演播）。

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 0.6s 正常延迟 | OK | OK（real 15，不误伤） |
| 3s / 6s 慢于小节 | 93/93 音符爆音 / 6.04s 静音 gap | OK（fixture 顶替，节奏不断） |
| 429 / 502 / 断网 | OK（本就正确回落 fixture） | OK |
| 挂住 + 浏览器 8s 超时 | 10.3s 静音 gap | OK |
| **前两小节好后挂住**（=用户症状） | 播 2 小节后 **9.2s 静音** | 12/12 小节 OK |
| **挂住且无超时兜底** | **0 小节，管线永久楔死** | 12/12 小节 OK |

### 根因

`Player.AHEAD_BARS = 2` 是音频缓冲的全部；而 `Composer._decide` 的单次决策时间无界——
`askJev` 的 `attempts=2 × timeoutMs=8000` 让最坏 ~17s，远超一小节（60–140 BPM 下 0.86–4s）。

- 渠道慢于一小节 → 缓冲抽干 → 静音；
- 渠道挂住且超时信号不兜底（`AbortSignal.timeout` 不可用的浏览器）→ `nextBar` 永不返回 →
  `Player.deciding` 永为 `true` → 管线**永久楔死**（这就是"只能弹两小节"的终局）；
- 迟到小节的音符被排进过去 → Web Audio 立即发声 → 整小节炸成一声。

## 修法

### 1. `Composer._decide(state, questions, budget)` —— 决策预算（根因）

```js
const reqP = ask().then((out) => ({ out }), (e) => ({ err: e }));   // 两分支都接住
const budgetP = budget.then(() => ({ budgetMiss: true }));
const won = await Promise.race([reqP, budgetP]);
if (won.budgetMiss) return { ...fixtureFallback(...), deadlineMiss: true };
```

- 真实答案先到 → 用真实的；预算先耗尽 → fixture 顶替 + **`decision.deadlineMiss` 如实标记**。
- `nextBar({ budget })` 新签名；`nextBar()`（工作室）无预算走原路径。
- 两个分支都接住 `ask()`，否则预算先赢时它的迟到拒绝会变成**未处理拒绝**。

### 2. `Player` 用音频时钟产出预算（正确的界只能由音频时钟给）

```js
_decisionBudget() {
  const barMs = this.secPerBeat * this.meterNum * 1000;
  const cap = Math.min(Math.max(barMs * 1.2, MIN), MAX);     // 起播期：放行正常延迟
  if (this._enqueuedOnce) {
    const dryMs = (this._cursorSec - this._now()) * 1000;     // 队列音频还能撑多久
    if (dryMs > 0) ms = Math.min(cap, Math.max(dryMs - 300, MIN));
  }
  const until = this._now() + ms / 1000;
  return new Promise((resolve) => { this._budgets.push({ until, resolve }); });
}
```

- **只用注入的 `now()`，不起新定时器**：真实环境即 AudioContext 时钟，测试环境即假时钟，
  预算语义天然是「音频时间的界」。暂停 = 音频时钟冻结 = 无断气压力，所以 `pause` 时结算掉未兑现预算。
- 起播期（`!_enqueuedOnce`）用 1.2 小节封顶：放行正常延迟（0.4–2s），砍掉病态延迟。
- 已入队后按剩余音频收紧：决策再慢也不可能让音频断气超过 ~300ms。

### 3. 迟到小节顺延到现在

`_enqueueBar` 发现 `barStartSec < now` 时，把整小节与 `_cursorSec` 锚点平移到 now。
旧实现的"防御路径"只处理**乱序**（回退线性映射），不处理**迟到**——而迟到才是用户能听到的。

## 三个坑（写给下一个 agent）

1. **我的诊断脚手架自己吞掉了修复**：harness 包装 `composer.nextBar` 时写成
   `async () => { await origNext(); }`，**漏传 `opts`**，预算从未抵达 Composer，一度误判"修复无效"。
   教训：**造假反馈环比没有反馈环更危险**——harness 是系统的一部分，它有 bug 时你会去修对的代码。
2. **「不得有音符排进过去」不能用 `when < disp` 判**：起播期 30ms 零头会误触。判据取**量级**
   （最大迟到 ≤50ms）——旧缺陷是秒级，正常只有 tick 粒度。
3. **判断迟到要用 `max(排程, 派发)`**：Web Audio 会把过去的音立即播出，排程时刻本身是谎言。

## 验证

- `npm test` **171 → 177 全绿**（新增 6 个测试：预算内不误伤 / 超预算顶替+标记 /
  迟到真实响应被丢弃序号不错位 / 挂住不楔死 / 渠道挂住 8 小节全播 / 迟到小节顺延）。
- `npm run gate` 12 种子指标**与修复前逐位一致**：chords 9.08 · entropy 2.54 ·
  melody 32.00 · lh 31.58 · 相邻重复 0（本改动只影响"渠道不健康时走哪条路"，
  不影响健康渠道的音乐输出——这正是设计目标）。
- `node --check` 全过；诊断脚手架已删（`scripts/` 恢复 4 个文件）。

## 下一步

- UI 给 `deadlineMiss` 一个独立读数：现在与"兜底"混在一起，用户分不清
  「渠道故障」与「渠道太到跟不上」。这是前端轮的活（`main.js` 已有 fallback 提示可扩展）。
- 若线上仍偶发，先把 `decision.deadlineMiss` 的占比打点出来——它直接量化"渠道跟不上"的程度。
