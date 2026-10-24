# 2026-10-25 · 跟弹回声 + 终止式识别（迭代轮次 55 · 前端/分析层）

## 做了什么

用户要求「继续优化前端，增加可玩性和科学性」。选题原则：**决策层一行不动**（candidates/composer 未碰，gate 与基线逐位一致），全部做在分析层 + 界面层——延续轮次 45/47/51 的「纯展示层」口径。

**领地**：`music.js`、新增 `cadence.js`、`ui.js`、`main.js`、`studio.js`、`studio-roll.js`、`index.html`、`styles.css` + 四份测试 + AGENTS/README/MEMORY。

1. **可玩性 + 科学性：键盘跟弹回声**。两个界面的键盘此前只是「点一点试听」；现在每次点击立刻告诉你这个音在**当前和声**里的角色：
   - `music.js` 新增 `chordRole(pc, rootPc, shape)`：**和弦音按位置命名**（根/三/五/七/九音），**外音按音程命名**（小七度/大三度…）——两种命名各答一半问题：「在不在和弦里」与「偏了多远」。八度等价，脏输入 null。
   - `ui.js` 新增 `keyEchoText(midi, chord)` 界面原语（`C4 · Cm的根音（和弦音）`），无和弦上下文只报音名。
   - 实时页（`main.js`）：和声上下文 = 最近一小节的和弦（onBar 更新）；工作室页（`studio.js`）：回放中取**播放头所在小节**（`chordAt(beat % totalBeats)`），静止取最后一小节。两页各加一条 `.kb-echo` 回声条（`#kbEcho`/`#stKbEcho`，aria-live）。
2. **科学性：终止式识别**。新增分析层模块 `cadence.js`（47 行）：
   - `cadenceAt(prev, cur)`：Kostka-Payne 判据——**功能归因 + 根音运动**双要素。V→I（fn D→T 且根音下行五度）= 完全终止；IV→I（S→T 上行四度）= 变格；V→vi/VI（D→Tp 下行三度）= 阻碍。**功能对了根音没走（V→V）不是终止式**。
   - `cadenceIntoBar`：**乐句位置是门槛**——只在乐句末小节判读「进入该小节」的进行；乐句收在属上 = 半终止（half）。`barsPerPhrase` 缺失按 4 退化。
   - `pieceCadences`：整曲扫描，供 hover/未来复用。
   - 呈现：实时页终止式并入 `nowBar` 小节行文字通道（**不新增 DOM 元素**，跟着 aria-live 走）；工作室卷帘 hover 读数在乐句末追加「· 完全终止」。
3. `main.js` 用 `chorusBarChords`（本遍每小节 `{rootPc, fn}`，曲终清空）作识别输入，`bar.index % totalBars` 对齐——不重复 cadenceIntoBar 的门槛逻辑。

## 坑（两个，都是老坑新演）

- **测试期望写错、实现对**：`keyEchoText(63, Cm)` 我预期「大三度（和弦外音）」——63 是 D#4/Eb4，音级类 3 **正是 Cm 的三音**（和弦音）。想测外音该用 64（E 自然音）。轮次 45 同款：写断言前先在纸上把音级算一遍。
- 乐句末门槛第一版只在 `cadenceIntoBar` 里，`main.js` 差点复制一份「(i+1)%phrase===0 + half 兜底」的内联逻辑——复制判据 = 两份真相。改为 main.js 维护本遍数组、走同一个函数。

## 验证

- `npm test` **202 → 210 全绿**（theory +1：chordRole；新增 cadence.test.mjs 5 条；ui +1：keyEchoText；studio-roll +1：hover 终止式 + 句中不读）。
- `npm run gate` 12 种子 **9.08 / 2.54 / 32.00 / 31.58，相邻重复 0——与基线逐位一致**（决策层零改动的证明）。
- `node --check` 全部改动文件通过；行数 music 374 / cadence 47 / ui 458 / main 445 / studio 492 / studio-roll 381，全部远离 800。
- 浏览器冒烟未跑（接线逻辑有单测；`dom-contract.test.mjs` 自动核对新增 id `kbEcho`/`stKbEcho` 与 index.html 对账）。**下次部署前人工过一遍**：演奏中点琴键看回声、听乐句末的小节行终止式、工作室 hover 第 4/8 小节。

## 设计取舍记录

- **回声条不做成 toast**：跟弹是高频动作（秒级多次点击），toast 会刷屏；固定一条小字 + aria-live 才是「乐器的一部分」。
- **终止式不进图例**：它走的是 `nowBar`/hover 的**文字通道**，不是功能轨上的图形标记——LEGEND_ITEMS 只管标记（AGENTS 规则），本轮没有新标记，图例不动。
- **阻碍终止要求根音走三度**（d=10 或 11）：fn D→Tp 但根音走五度外的不判——「功能骗人可以，低音不走就是没到终止式」。

## 下一步

无挂账。候选：跟弹进 Fall 可视化（用户音符也下落）、终止式写进 MIDI 导出的乐谱事件、`chordRole` 接到工作室卷帘 hover。
