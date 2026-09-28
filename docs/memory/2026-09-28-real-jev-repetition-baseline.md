# 真实 Jev 重复度基线：熔断（和弦种类 6<8） · 2026-09-28

- **做了什么**：实跑 `node scripts/analyze-repetition.mjs 32 2026 random --real`（typesafe(jev-1.13) 真实渠道，约 $0.002），取得反重复大修（a085f4f）后**真实渠道**的首个 32 小节量化基线。按计划熔断线判定：`unique_chords=6 < 8`，**触发熔断**——未提交 README 反重复表的真实渠道行，改为在 MEMORY.md 记阻塞接力条 + 本条目。未动任何代码。
- **为什么**：a085f4f 宣称的 "real-Jev verified" 仅是 probe-bar 3 小节冒烟，从未做过 32 小节量化；fixture 口径的验收（和弦种类 8-10 等）不能外推到真实渠道，必须先拿到真实基线再决定是否补 README。计划预案：熔断则不提交 README、记阻塞接力条，本条目即该预案的执行结果。
- **坑**：
  1. **fixture 口径达标 ≠ 真实渠道达标**：fixture 与真实 Jev 同构的只是候选集与权重（ADR-0002），但真实模型的选择分布更集中——同样的断路器阈值下，fixture 被强制分散，真实模型却稳定落回 Cm-Fm-G。
  2. **probe-bar 冒烟 ≠ 32 小节量化**：冒烟只证明"能跑通不报错"，量化才暴露分布集中度；此前 a085f4f 的记忆条目把两者混为 "real-Jev verified"，导致 gap 潜伏至今。
  3. 根音疲劳阈值 2.0 / 衰减 0.93 是照 fixture 分布调出来的（overhaul 条目的坑 3），对真实分布可能偏松——但先排除抽样波动再动参数，避免过度调参。
- **下一步（接力）**：① 先排除抽样波动：经 owner 批准后再跑 `node scripts/analyze-repetition.mjs 32 2027 random --real`（~$0.002）；② 若确认系统性偏差，开新任务调候选集/权重——方向：真实渠道加强根音疲劳（收紧阈值/加快衰减）或进一步压缩模型可复选空间；③ 验收标准：真实渠道 unique_chords ≥ 8 且相邻重复 = 0，然后补 README 反重复表真实渠道行，并把 MEMORY.md 顶部阻塞条目转完成态。领地：README.md + composer.js + 本文件 + MEMORY.md。

## 验证（完整命令与输出，一字未改）

命令：

```bash
node scripts/analyze-repetition.mjs 32 2026 random --real
```

输出（channel 已确认为 `typesafe(jev-1.13)` 真实渠道，非 fixture 回落）：

```json
{
 "style": "romantic",
 "bars": 32,
 "seed": 2026,
 "channel": "typesafe(jev-1.13)",
 "melody_unique_bars": "30/32",
 "melody_adjacent_repeat": 0,
 "melody_2gram_repeat": 0,
 "lh_unique_bars": "27/32",
 "lh_adjacent_repeat": 0,
 "unique_chords": 6,
 "chord_seq": "Cm Fm G Cm Fm G Cm G Fm D# G# D# A# G Cm Fm D# G# G Cm Fm D# G# A# Cm G Fm D# G# A# Cm G",
 "interval_entropy": 1.41,
 "leap_ratio": "10%",
 "rh_notes_per_bar": 3.9
}
```

**指标对比表**（fixture 基线取自 a085f4f 后 4 种子均值，见 [anti-repetition-overhaul](2026-09-28-anti-repetition-overhaul.md)；熔断线 unique_chords ≥ 8）：

| 指标 | fixture 基线（大修后） | 真实渠道实测（seed 2026） | 判定 |
|---|---|---|---|
| unique_chords 和弦种类 | 8-10 | **6** | ❌ 熔断（< 8） |
| chord_seq 前 8 小节 | 循环被断路器强制打断 | 字面 Cm-Fm-G 循环两轮 | ❌ 熔断（模型选择过集中） |
| interval_entropy 音程熵 | 2.4-2.8 | **1.41** | ❌ 低于 fixture 下限 2.4 |
| melody_adjacent_repeat 相邻字面重复 | 0 | 0 | ✅ |
| melody_2gram_repeat 旋律 2-gram 重复 | 0（大修目标） | 0 | ✅ |
| melody_unique_bars 旋律唯一小节 | 未记录 | 30/32 | ✅ |
| lh_unique_bars 左手唯一小节 | 26-28/32 | 27/32 | ✅ |
| leap_ratio 跳进占比 | 8-21% | 10% | ✅ |
| rh_notes_per_bar 右手音符/小节 | — | 3.9 | 参考（无基线） |
