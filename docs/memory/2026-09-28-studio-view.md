# 工作室界面（第二界面）· 2026-09-28 08:40（commit 9229a45）

- **做了什么**：`studio.js` 新建 641 行 + `test/studio.test.mjs` 113 行；`index.html` +88、`main.js` +32、`settings.js` +20、`audio.js` +7、`styles.css` +47。顶栏 tab 切换「实时即兴 / 工作室」。
  - **批量生成 job**：同一灵感整曲生成（每小节仍由 Jev 逐小节决策），带进度条与取消，生成中即可预览已完成小节。
  - **钢琴卷帘编辑**：点空白新增 / 拖动移动 / 拖右缘改时长 / 双击删除 / Ctrl+Z·Ctrl+Y——全部**确定性编辑，不调用模型**（jevthoven 的 deterministic edits）；卷帘常数 `P_LO=36, P_HI=95, SNAP=0.25`。
  - **回放**：循环、左右手分轨静音、BPM 调整、播放头跟随滚动。
  - **让 Jev 修改**：自然语言（"左手更密集"）由 Jev 从有限的确定性编辑命令（加密/稀疏/移调/力度）中选一个执行；离线渠道用关键词匹配。
  - **导出/导入**：MIDI + 项目 JSON；导入经校验（validated import）；localStorage key `jevpiano.studio.v1` 自动保存，重开浏览器可恢复。
  - 换一版 = 同一灵感新 seed 整曲变奏。
- **为什么**：实时即兴"不可预知不可改"；工作室补上 jevthoven 的"生成→编辑"工作流，让输出可精修、可交付。
- **坑**：
  1. studio 与实时即兴**共享 composer/jev 决策内核与 audio 单例**——改共享内核必须回归两个界面（studio.test.mjs 与 composer.test.mjs 都要看）。
  2. 确定性编辑变换写成**纯函数**（`chordAt`/`densifyHand` 等，与 DOM 无关）才可单测——这是本项目一贯的"逻辑与 DOM 分离"传统。
  3. 自然语言修改的指令集是封闭的（加密/稀疏/移调/力度）：Jev 只做选择，编辑动作由代码执行——候选集红线在 studio 同样适用。
- **验证**：`npm test` 全绿（studio 纯函数确定性断言：同输入同输出、音域/时值合法）。
- **下一步**：钢琴卷帘的量化（quantize）与力度（velocity）编辑未做；MIDI 导出走共享 `midi.js`。
