# 弹钢琴/编曲相关前端项目调研（AnySearch + GitHub）

> 调研时间：2026-09-28 · 工具：AnySearch（general web + code.snippet 垂直）+ GitHub 搜索
> 目的：为"jev 实时谱曲 + 演奏钢琴"的轻量前端选型找参考项目与依赖。

## 参考项目清单

| 项目 | 一句话 | 对本项目的价值 |
|---|---|---|
| [Tone.js](https://tonejs.github.io/) | 浏览器交互式音乐创作的 Web Audio 框架 | 事实标准；但为"轻量、零依赖"目标，本项目用原生 Web Audio，仅作参考 |
| [tambien/Piano（@tonejs/piano）](https://github.com/tambien/Piano) | 高质量多采样钢琴（Salamander Grand，16 力度层），npm/CDN 可用 | 音质升级路线：若嫌合成钢琴不够真，可按需加载采样（代价：数 MB 下载） |
| [tonaljs/tonal](https://github.com/tonaljs/tonal) | JS 乐理库（note/interval/chord/scale/key） | 乐理工具备选；本项目手写 ~200 行乐理内核保持零依赖 |
| [ChordSeqAI](https://chordseqai.com/) | 开源浏览器内 AI 和弦进行助手 | 产品形态参考：和弦进行生成 + 试听 |
| [dev.to：浏览器和弦进行生成器](https://dev.to/sendotltd/building-a-chord-progression-generator-in-the-browser-music-theory-in-js-sound-via-web-audio-api-519j) | **~300 行原生 JS**，12 调 × 2 音阶 × 7 曲风预设，Web Audio 播放 | 与本项目形态最接近的先例：乐理内核 + 原生 JS 是可行且够用的 |
| [awesome-javascript-audio](https://github.com/sc0ttj/awesome-javascript-audio) | JS 音频/音乐库策展列表（含"从零造合成钢琴"多篇） | 扩展阅读入口 |
| [sc0ttj/awesome-javascript-audio 收录的合成钢琴教程](https://github.com/sc0ttj/awesome-javascript-audio/blob/master/README.md) | oscillator + envelope 造钢琴音色 | 本项目合成钢琴的实现路径 |
| GitHub topic [midi-generator](https://github.com/topics/midi-generator) | "Web 端 AI 音乐生成器，按乐理规划整曲编排，内置钢琴卷帘" | 与 jevthoven 同思路的生态；MIDI 导出是标配 |
| GitHub topic [chord-progressions (TS)](https://github.com/topics/chord-progressions?l=typescript) | 钢琴学习/ MIDI 可视化应用：**下落音符**、和弦音阶探索器 | 视觉参考：下落音符 + 键盘高亮是最直观的"演奏可视化" |
| GitHub topic [web-audio-api](https://github.com/topics/web-audio-api?o=desc&s=stars) | 生成音乐播放器、乐器建模等大集合 | 浏览 |
| [AkaiMPC 和弦进行生成器](https://liotier.github.io/AkaiMPC/AkaiMPCChordProgressionGenerator/) | 纯静态页和弦进行生成器 | 纯静态可行的旁证 |
| **cocktailpeanut/jevthoven** | Jev 驱动的符号音乐工作室（详见 [jevthoven-调研.md](jevthoven-调研.md)） | **主参考**：决策流水线、fixture 模式、MIDI 导出 |

## 技术选型结论

1. **零框架、零构建、零外部依赖**（ES Modules + 原生 Web Audio）：dev.to 的 300 行先例 + jevtown（同工作区，gaborishka/jevtown 复刻）都验证了这条路；CF Workers 静态资产直接托管。
2. **钢琴音色**：默认用 Web Audio 合成（三角波+正弦泛音+包络+低通，~100 行，即开即响）；README 注明 @tonejs/piano 是音质升级选项（代价是数 MB 采样下载，违背"轻量"）。
3. **调度**：Web Audio 时钟 + lookahead 调度器（"A Tale of Two Clocks"模式），边决策边排音，Jev 单次 100–500ms 延迟远小于一个小节时长（60–140 BPM 下 0.86–4s）。
4. **编曲内核**：jevthoven 的"候选集 + 选择"模式——代码按乐理/风格生成候选（下一和弦、左手织体、节奏型、旋律走向），Jev 每小节一次请求并行选出；无 API 时用种子随机做 fixture 决策（jevthoven 同款设计）。
5. **可视化**：88 键→常用 4 个八度键盘 DOM 高亮 + Canvas 下落音符（chord-progressions 生态的标准视觉语言）。
6. **MIDI 导出**：SMF Type-1 双轨（左手/右手），纯 JS 写 header/chunk，无依赖。

## 曲风预设设计参考（供 styles.js）

- 古典/浪漫：Alberti 低音、分解和弦、乐句呼吸、终止式（V→I）
- 爵士：ii-V-I、7/9 和弦、shell voicing、walking bass、swing
- 流行抒情：I-V-vi-IV、琶音伴奏、拱形旋律
- Lo-Fi：maj7/9 色彩、swing 8 分、稀疏旋律、柔和滤波
- 新世纪：五声/自然音阶、长 pad 和弦、宽混响
- 圆舞曲：3/4、低音-弦-弦
- 东方五声：宫调式五声音阶、四/五度叠置
