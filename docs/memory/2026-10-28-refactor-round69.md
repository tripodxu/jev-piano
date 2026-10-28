# 2026-10-28 · 轮次 69：前端现代化重构 + 上线核验

## 背景与目标

全量审计现有前端后，在**保持功能与业务逻辑不变**的前提下做现代化重构：统一设计语言、
优化布局/间距/配色/字体/动效、提升响应式与可访问性、精简冗余样式与重复代码。
设计判据沿用项目既有的 `SCOPED_EXISTING_ALLOWED`——既有「午夜音乐厅」视觉世界（乌木+黄铜）
内精修，不推翻重做。

## 一、CSS 架构：740 行单体 → 七层 @layer

`public/styles.css` 删除，改为 `public/styles/`：

| 文件 | 层 | 内容 |
|---|---|---|
| `tokens.css` | tokens | 约 60 个设计令牌 + **唯一的 `@layer` 层序声明** |
| `base.css` | reset / base | 重置、排版基线、焦点可见性 |
| `layout.css` | layout | 顶栏、视图容器、栅格、断点 |
| `components.css` | components | 按钮、chip、pill、toast、键盘、面板 |
| `stage.css` | stage | 实时舞台（和弦、下落、张力带、动机卡） |
| `studio.css` | studio | 卷帘、工作室面板 |
| `motion.css` | utilities / motion | 工具类 + 动效（含 reduced-motion） |

层序：`tokens, reset, base, layout, components, stage, studio, utilities, motion`。
零框架零构建的项目，**7 个 `<link>` 不引入任何工具链**——刻意不用打包器。

令牌清单要点：6 级表面（`--surface-0..5`）、3 级文字、4px 基准间距、字号阶梯 + 流体
`clamp`（`--fs-brand`、`--fs-display`）、圆角、三级阴影、动效（1 条曲线 + 4 档时长）、
z-index、触控目标。

**消除的 6 处重复定义**：`.stage` 背景写两遍、`.toast` 的 z-index/max-width 各两遍、
`.keyboard` 的 `user-select`、`.khint`。

## 二、视觉与交互

- 断点 2 档（980/560）→ **4 档（1200/980/720/520）**
- `vh` → **`dvh`**（移动端工具栏不再留白条）
- 固定 px → 流体 `clamp`（品牌字、当前和弦）
- `prefers-reduced-motion` / `prefers-contrast: more` 支持

## 三、可访问性

- 跳转链接（`.skip-link`）、`.sr-only`
- chips：**单 Tab 停点 + 方向键/Home/End**（原来 10 个 chip 吃掉 10 次 Tab）
- tab 的 `aria-selected` 与视觉态 `.sel` **同源**；循环按钮 `aria-pressed` 同步
- 焦点可见性统一到 `:focus-visible`

## 四、JS 去重

新增 `public/js/dom.js`（24 行，零 import）：`escapeHtml` / `byId` / `downloadBlob`。

`ui.js` 新增两个共享实现：

- `refreshStatusPills(pills, { channel, ledger, suffix })` —— 顶栏台账口径统一
- `attachPlayableKeyboard(container, { echoEl, chordOf, onNote, enabled })` ——
  **`enabled` 从可选变必填**。轮次 68 修的双发声 bug 本质是「两个界面各写了一半守卫」，
  合成一份后守卫无法再被漏掉。

`main.js` 与 `studio.js` 改用共享实现，消除 `download` / `pressKey` / `refreshLedger`
三处逐字节重复。

## 五、为什么配了契约测试

拆分的失败模式是**静默的**：少 link 一个文件整层消失、`var()` 名打错静默回退、
裸值回流导致设计语言漂移。`test/style-contract.test.mjs`（9 条）把这些变成红灯：

1. HTML 引的样式表 ↔ 磁盘文件**双向**对账
2. `@layer` 层序声明**唯一**
3. 所有 `var(--x)` 的 `--x` 必须已定义
4. components 层禁止裸色值/裸字号
5. JS 用到的类名必须有样式定义
6. …（共 9 条）

**它当场抓出 2 个真问题**：`brand-mark` 的 30px/24px 与 toast 的 `#f0b9a8` 是漏网裸值，
已收编为 `--fs-brand: clamp(24px,4vw,30px)`（顺带消掉一条断点覆盖）与 `--signal-warn`。

写测试时的坑：变量名正则最初只写 `[a-z0-9-]`，漏了大写（`--fs-4XL` 类），已改成含 `A-Z`。

## 六、上线与核验

- commit `f7501ff`（17 文件，+1459/−840）→ push → `wrangler deploy`
- 上传 13 资产，**Version ID `bc5264e4-62ca-4b06-bb38-a9decc07eae1`**
- `verify-deploy` **16/16** 静态针命中（含新增 4 针）；12 资产全 200；
  `/` 的 7 个 `<link>` 顺序正确（tokens 首位）；`/api/probe` 200；同源防护 415

### `/api/jev` 502 `upstream 451` —— 非回归，已定性

三次稳定复现，但判定与本次部署无关：

1. 本次 `git show --stat HEAD` **未触及 `src/worker.js`**（上次改动是轮次 63）
2. `upstream 451` 只可能由 `jevViaHTTP` 产生 → 后端链 `[workers-ai, typesafe]` 两个都失败
3. **空凭据直打 `api.typesafe.ai` 也是 451** → 与 key 无关，是端点地区封锁
   （与轮次 59 结案结论一致）

复验：经本机代理（127.0.0.1:10808）打生产 → **HTTP 200，`jev-1.14.0` 八问全答**（3.3s）。

### 两条方法论

- 「部署成功 ≠ 部署正确 ≠ 上游活着」是三件事——16/16 绿灯与 451 同时出现在同一次运行里。
- `/api/probe` 的 `ok:true` **只证明绑定存在，不证明可用**（probe 不实发上游请求）。
  真渠道健康必须打 `/api/jev`。

### verify-deploy 补针的坑

补的 4 条针必须**先在磁盘上对账再写**：`--ebony` 是我凭印象写的变量名，本地一跑就缺，
实际叫 `--surface-0..5`。顺序：先跑本地 needle 对账 → 再写进脚本 → 再提交。

## 七、数据

- 测试 **236 → 245**（新增 9 条），全绿
- `npm run gate` 12 种子均值 **9.08 / 2.54 / 32.00 / 31.58** —— 与重构前**逐位一致**，
  乐理与业务逻辑零改动
- 最大文件未越 ADR-0004 的 800 行上限

## 八、遗留警示

`.hidden` 去掉了 `!important`，改靠 utilities 层排在最后生效。**若后续调整层序，这条会失效。**
