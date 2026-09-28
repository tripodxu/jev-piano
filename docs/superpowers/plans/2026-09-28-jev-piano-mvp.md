# Jev Piano（jev 即兴钢琴）实施计划

> **For agentic workers:** 本计划按 superpowers:writing-plans 规范撰写，复选框 `- [ ]` 跟踪进度。执行方式：**inline（本会话逐任务执行）+ 每任务一次 git commit**。配套 skill：superpowers:executing-plans。

> **状态：已完成并归档（2026-09-28，42/42 项复选框已勾选）。** 本文档是 MVP 的设计契约历史存档；新任务从 [AGENTS.md](../../../AGENTS.md) 与 [MEMORY.md](../../../MEMORY.md) 出发，不要把本文当活动计划执行。

**Goal:** 一个零框架、零构建的轻量前端：用户输入一句话 + 选风格/目标 → LLM 扩写成乐章计划（可选，BYO key）→ **Jev 每小节实时决策（和声/织体/节奏/走向/力度/呼吸），代码渲染成音符，边决策边演奏钢琴**；可导出 MIDI，可部署到 Cloudflare Workers。

**Architecture:** jevthoven 的"模型选、代码写"模式（见 `research/jevthoven-调研.md`）：乐理内核生成有限候选集，Jev 每小节一次请求并行回答 6 个类型化问题（choice×4 + score×1 + noul×1），确定性代码把选择渲染成 NoteEvent；Web Audio lookahead 调度器边排音边播放；无 API 时用种子随机 fixture 决策器（同 jevthoven 的 fixture mode），保证零成本可玩。

**Tech Stack:** 原生 ES Modules + Web Audio API（无任何运行时依赖）；Node ≥ 18 仅用于跑测试（node:test）；Cloudflare Workers + static assets（wrangler）。

**决策模型 API 契约**（工作区 board-games/jev-client.js 已验证，docs.typesafe.ai/api.md）：

```
POST {endpoint}   Authorization: Bearer <key>
body:   { state, model, questions: { id: {type, instructions, criteria} } }
resp:   { model, answers: { id: {value, probability?|confidence?} }, usage: {input_tokens, output_tokens} }
type ∈ choice|noul|score；429/529 指数退避；401 key 无效
```

| 渠道 | endpoint | model |
|---|---|---|
| 离线随机（默认，零 key） | 本地 fixture 采样器 | — |
| TypeSafe 直连（BYOK） | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| OpenRouter 直连（BYOK） | `https://openrouter.ai/api/v1/systemone` | `typesafe/jev-1.13` |
| 同源代理（部署者持 key 或 Workers AI 绑定） | `POST /api/jev` | 服务端定 |
| LLM 扩写（BYOK，可选） | 任意 OpenAI 兼容 `/chat/completions` 或 `POST /api/llm` | 用户填 |

---

## 一、文件结构（职责锁定）

```
jev-piano/
├── docs/superpowers/plans/2026-09-28-jev-piano-mvp.md   ← 本计划
├── package.json        # scripts: test / dev / deploy；devDependencies: wrangler
├── .gitignore          # node_modules/ .wrangler/ .dev.vars
├── wrangler.toml       # assets=./public binding=ASSETS, run_worker_first=["/api/*"], [ai] 可选
├── .dev.vars.example   # TYPESAFE_API_KEY= / OPENROUTER_API_KEY= / LLM_BASE_URL= / LLM_API_KEY= / LLM_MODEL=
├── dev-proxy.py        # 本地开发：静态服务 + /api/probe|jev|llm（无 key 时返回模拟决策）
├── src/worker.js       # 生产 Worker：静态资产 + /api/probe + /api/jev + /api/llm
├── public/
│   ├── index.html      # 单页结构（元素 id 契约见 Task 7）
│   ├── styles.css      # 暗色音乐厅主题
│   └── js/
│       ├── music.js    # 乐理内核 + 曲风预设（已落盘初稿，Task 1 测试驱动修正）
│       ├── jev.js      # Jev 四渠道客户端 + fixture 采样 + LLM 扩写客户端
│       ├── composer.js # 乐章计划 buildPlan + 每小节候选集/问题构造 + 音符渲染内核
│       ├── audio.js    # 合成钢琴（包络/滤波/混响/复音上限）+ 录音
│       ├── player.js   # lookahead 调度器 + 决策管线（提前 ≥2 小节）
│       ├── midi.js     # SMF Type-1 双轨导出
│       ├── ui.js       # 键盘 DOM、下落音符 canvas、决策日志
│       └── main.js     # 接线：事件、设置(localStorage)、渠道探测
├── test/               # node --test（纯逻辑可测；浏览器行为走 Task 10 冒烟）
│   ├── theory.test.mjs
│   ├── jev.test.mjs
│   ├── composer.test.mjs
│   ├── player.test.mjs
│   └── midi.test.mjs
└── README.md
```

## 二、核心数据契约（所有任务共同遵守）

```js
// Plan（乐章计划，Task 3 产出，所有模块只读）
{
  title: string, prompt: string, goal: string,
  styleId: 'classical'|'romantic'|'jazz'|'pop'|'lofi'|'newage'|'waltz'|'oriental',
  mode: 'major'|'minor'|'dorian'|'mixolydian'|'pentatonic',
  keyPc: 0..11, bpm: 50..140, meterNum: 3|4, meterDen: 4,
  barsPerPhrase: 8, totalBars: 32,
  arc: 'flat'|'rise'|'arch'|'fall',
  swing: 0..0.35, density: 0..1, brightness: 0..1,
  mood: string[], notes: string,   // notes = LLM 的中文演奏提示
  source: 'llm'|'keyword', seed: int,
}

// NoteEvent（渲染产物，player 的输入单位；时间以"拍"计，播放前转秒）
{ midi: int, startBeats: number, durBeats: number, vel: 0..1, hand: 'R'|'L' }

// BarResult（composer.nextBar() → player/ui）
{
  index: int, loop: int, label: string,           // label 如 "A·3" 段落+小节
  chord: { symbol: string, rootPc: int, shape: string },
  notes: NoteEvent[], intensity: number,          // 0..3
  decision: { provider: string, fixture: bool, ms: int,
              inputTokens: int, usd: number,
              answers: { [qid]: {value, probability?|confidence?} } },
}

// Jev question（发送前剥离以 _ 开头的字段；_fixture 供离线采样器使用）
{ type, instructions, criteria, _fixture: { weights: {optionId: number} } }
```

## 三、Jev 每小节问题设计（composer.js 逐字实现）

每小节**一次请求、6 问并行**（Jev 并行评估，加问题几乎不增加延迟）。`state` 用英文（模型侧），UI 用中文展示。

```js
state = {
  piece: { style: "romantic nocturne piano", mood: ["rainy","melancholy"], goal: "情绪宣泄",
           arc: "arch", key: "A minor", meter: "4/4", bpm: 66 },
  position: { bar: 7, bar_in_phrase: 7, phrase: 0, is_phrase_end: true, progress: 0.22 },
  harmony: { current: "Dm", recent: ["Am","F","C","Dm"] },
  last_bar: { lh: "broken chord 16ths", contour: "arch", tier: 1, ended_on: "C5" },
  intensity_so_far: 1.6,
  motif: "phrase-1 motif: rhythm r1, contour arch (reuse or vary it)",
  user_prompt: "雨夜的城市，一个人走在霓虹下",
}
questions = {
  chord:     { type:'choice', instructions: 'You are the harmony planner of a live piano improvisation. Choose the chord for the NEXT bar. Keep voice leading smooth from `harmony.current`, serve the style and mood, and respect phrase endings (prefer V or I at phrase ends, I at phrase starts). Answer ONLY with the Choice question "chord".', criteria: { '<和弦符号>': '<一句中文性格描述>' , ...} },
  lh:        { type:'choice', instructions: 'Choose the left-hand accompaniment pattern for the NEXT bar, fitting the chord, intensity and style. Answer ONLY with the Choice question "lh".', criteria: { patternId: LH_DEFS[id] } },
  rhythm:    { type:'choice', instructions: 'Choose the right-hand rhythm pattern for the NEXT bar (tier 0=sparse 1=medium 2=dense). Answer ONLY with the Choice question "rhythm".', criteria: { r0:'sparse…', r1:'medium…', r2:'dense…', motif:'reuse the opening motif' } },
  contour:   { type:'choice', instructions: 'Choose the melodic contour of the NEXT bar. Answer ONLY with the Choice question "contour".', criteria: { rise:'climbing', fall:'descending', arch:'up then down', wave:'undulating', stay:'repeat around one tone' } },
  intensity: { type:'score', instructions: 'Musical intensity for the NEXT bar on 0-3, given arc, phrase position and history.', criteria: { '0':'very soft, airy', '1':'gentle', '2':'confident, fuller', '3':'climactic' } },
  breathe:   { type:'noul',  instructions: 'Should the melody breathe (start after a rest) in the NEXT bar?', criteria: { true:'yes, leave space', false:'no, keep singing' } },
}
```

**fixture 采样权重**（无 API 时的决策器，与真实 Jev 同构）：

- `chord`：基础 1.0；是"当前进行池的下一拍" +1.2；小节 0（或 phrase 首）且为主属 I/i +0.6；`is_phrase_end` 且 ∈ {V(7), I/i} +1.0；与当前和弦相同 −0.4。
- `lh`：均匀 1.0；intensity≥2 → octave/stride/walk +0.3；intensity<1 → pad/ballad +0.3。
- `rhythm`：`1/(1+|tier − round(density*2)|)`；非首 phrase 时 motif 选项 +0.8。
- `contour`：查表——phrase 首 `{stay:.9,rise:.9,wave:.7,…}`；中段 `{arch:1.1,wave:.9,…}`；phrase 尾 `{fall:1.1,stay:.7,…}`；arc=rise 全局 rise +0.3，arc=fall 全局 fall +0.3。
- `intensity`：arc 曲线 `flat:0.9+0.3sin(πp)` `rise:0.6+1.8p` `arch:0.7+1.8sin(πp)` `fall:2.4−1.8p`（p=progress），phrase 尾 −0.5，clamp 0..3。
- `breathe`：`rng() < (is_phrase_end ? 0.65 : (density<0.4 ? 0.3 : 0.12))`。

## 四、任务清单

### Task 0: 项目骨架与 git 初始化

**Files:** Create `jev-piano/package.json`, `jev-piano/.gitignore`

- [x] Step 1: 在 `jev-piano/` 执行 `git init -b main`
- [x] Step 2: 写 `package.json`：`{"name":"jev-piano","private":true,"type":"module","scripts":{"test":"node --test test/","dev":"python dev-proxy.py","deploy":"wrangler deploy"},"devDependencies":{"wrangler":"^4.0.0"}}`
- [x] Step 3: 写 `.gitignore`：`node_modules/`、`.wrangler/`、`.dev.vars`
- [x] Step 4: `git add -A && git commit -m "chore: project skeleton"`

### Task 1: 乐理内核测试驱动校验（music.js 已落盘初稿）

**Files:** Test `test/theory.test.mjs`；Modify（如需）`public/js/music.js`

- [x] Step 1: 写 `test/theory.test.mjs`，完整断言：
  - `parseRoman('V7')` → `{rootPc:7, shape:'7'}`；`parseRoman('Imaj7')` → `{rootPc:0,shape:'maj7'}`；`parseRoman('ii m7b5')`（jazz minor 池含空格）→ trim 后 `{rootPc:2,shape:'m7b5'}`；`parseRoman('bVI')` → `{rootPc:8,shape:''}`；`parseRoman('bVII')` → `{rootPc:10,shape:''}`；`parseRoman('vi7')` → `{rootPc:9,shape:'m7'}`；`parseRoman('V 7sus4')` → `{rootPc:7,shape:'7sus4'}`；`parseRoman('i m9')` → `{rootPc:0,shape:'m9'}`
  - `chordMidis(9,'m',60,84)` 全部 pc ∈ {9,0,4}（Am）且 60..84
  - `lhVoicing(9,'m7')`：bass∈36..47 且 pc=9；upper 3 音均在 48..64 且 pc ∈ Am7
  - `scaleMidis(0,'pentatonicMajor',60,84)` 只含 {0,2,4,7,9} 的 pc，共 13 个音
  - `nearest(66, [60,62,64,67,69])` → 67
  - **STYLES 完整性**：每个 style 的每条 progs 每个符号 `parseRoman(trim)` 非 null；`bpm[0]<=bpm[1]`；`lh` id 全部存在于 `LH_DEFS`；waltz 的 meters 恰为 `['3/4']` 且其他风格含 `4/4`
  - `keywordPlan('雨夜的城市', rng)` 返回 styleId ∈ STYLES、bpm 为整数且在风格区间、含 title
- [x] Step 2: 运行 `npm test` → 预期**部分失败**（如 `ii m7b5` 带空格、`V 7sus4` 带空格）
- [x] Step 3: 修 `music.js`：`parseRoman` 入口先 `sym.trim().replace(/\s+/,'')`；其余按失败信息修
- [x] Step 4: `npm test` → 全绿
- [x] Step 5: `git add -A && git commit -m "feat: theory kernel validated by tests"`

### Task 2: Jev 客户端（jev.js）

**Files:** Create `public/js/jev.js`；Test `test/jev.test.mjs`

导出契约：

```js
export const CHANNELS = {
  typesafe:   { endpoint:'https://api.typesafe.ai/v1/systemone',   model:'jev-latest' },
  openrouter: { endpoint:'https://openrouter.ai/api/v1/systemone', model:'typesafe/jev-1.13' },
  proxy:      { endpoint:'api/jev', model:null },               // 服务端定 model
};
export async function askJev({state, questions}, cfg, fetchImpl=fetch)
// cfg = { channel:'fixture'|'typesafe'|'openrouter'|'proxy', apiKey, signal }
// → { answers, inputTokens, usd, ms, fixture }
// 429/529 退避重试（250ms*2^n，最多4次，带抖动可注入 rng）；发送前剥离 _ 前缀字段
export function fixtureAnswer(questions, rng)      // 按 _fixture.weights 采样
export function stripPrivate(questions)            // 深拷贝剔除 _* 字段
export async function probeProxy(baseUrl=window.location.origin)  // GET /api/probe → {ok,jev,llm} | null
export async function expandPlan(prompt, hint, llmCfg, fetchImpl=fetch)
// llmCfg = { baseUrl, model, apiKey, proxy:false, signal }
// messages=[{role:'system',content:SYS},{role:'user',content:...}]，temperature .9，max_tokens 400
// 先试 response_format:{type:'json_object'}，404/400 则去掉重试一次
// 返回 JSON.parse(choices[0].message.content)（失败返回 null）
export const PLAN_SYS_PROMPT = `...` // 见下方原文
```

- [x] Step 1: 写测试 `test/jev.test.mjs`（注入假 fetch）：
  - 200 → 返回 answers/usage 正确，发送体不含 `_fixture`
  - 先 429 后 200 → 重试成功（假 fetch 计数）
  - `fixtureAnswer`：固定 rng 下确定；权重全 0 的题返回任一 criteria 键
  - `expandPlan`：假 fetch 返回 `choices[0].message.content='{"title":"x"}'` → 解析成功；返回非 JSON → null
- [x] Step 2: `npm test` → 预期 FAIL（模块不存在）
- [x] Step 3: 实现 `jev.js`。`PLAN_SYS_PROMPT` 原文：

```text
你是作曲助理，把用户的一句话扩写成钢琴即兴曲的创作计划。只输出一个 JSON 对象，不要任何其他文字或代码块标记。
字段与取值：
{"title":"诗意曲名，不超过12个字","style":"classical|romantic|jazz|pop|lofi|newage|waltz|oriental 之一","mode":"major|minor|dorian|pentatonic 之一","keyPc":0-11 的整数(C=0,D=1...B=11),"bpm":50-140 整数,"mood":["两个英文情绪词"],"arc":"flat|rise|arch|fall 之 int 弧线","swing":0-0.35,"density":0-1,"brightness":0-1,"notes":"给演奏者的一句中文提示，20字内"}
若 hint.style 给了具体风格则 style 必须服从 hint；bpm/density/brightness 尽量服从 hint.goal 的意图。
```

- [x] Step 4: `npm test` → 全绿；`git commit -m "feat: jev client with 4 channels + llm expansion"`

### Task 3: 编曲决策器（composer.js）——核心

**Files:** Create `public/js/composer.js`；Test `test/composer.test.mjs`

导出契约：

```js
export function mulberry32(seed) → ()=>float      // 与 jevtown 同款种子随机
export async function buildPlan({prompt, goal, styleId, seed}, jevCfg) → Plan
// styleId!=='random' → 计划强制该 style；LLM 可用则 expandPlan 并 clamp 所有字段
// （bpm 夹 50..140、swing 0..0.35、mode 校验回退 keyword、keyPc 取整 0..11）
// LLM 失败/未启用 → keywordPlan + 补齐 prompt/goal/seed/source='keyword'
export class Composer {
  constructor(plan, jevCfg, rng = mulberry32(plan.seed))
  async nextBar() → BarResult       // 无限生成：index++，loop = floor(index/totalBars)
  history: BarResult[]              // 最近 8 条
  motif: {rhythmId, contourId} | null  // 第 2、3 小节采样后固化
}
```

渲染内核（逐字实现）：

- **候选与弦**：`style.progs[plan.mode]` 全部和弦并入候选（trim 后 parseRoman）；权重见第三节；候选上限 8（按权重取前 8）。criteria 描述：`<符号> — <罗马级性格（属/下属/主）+ 和弦色（七/九）>`。
- **LH 候选**：`style.lh` 全部；intensity 加权见第三节。
- **rhythm 候选**：`R44`/`R34`（按 meterNum 选池）合并三档，挑与 `round(density*2)` 档最近的 3 个 + motif 项（非首 phrase 时）。
- **melody mode**：`plan.mode==='pentatonic' ? (mode==='minor'?'pentatonicMinor':'pentatonicMajor') : plan.mode`；`scaleMidis(keyPc, melodyMode, 60, 84)`。
- **旋律**（onsets 为 16 分格）：
  1. `onsets = breathe ? pattern.on.slice(1) : pattern.on`；空则补 `[8]`（3/4 用 `[6]`）
  2. `contourSteps` 查表（音阶级步进）：`stay:[0,0,1,0,-1]` `rise:[1,1,2,1]` `fall:[-1,-1,-2,-1]` `arch:[1,2,1,-1,-2]` `wave:[1,-1,1,-1]`，按 needCount 循环取
  3. `cur = 上小节末音 ?? nearest(72, chordPool)`；对每个 onset：`target = cur + steps[k] * 2`（级步 ×2 半音近似），`强拍(i%4==0)或末音 → nearest(target, chordPool)`，否则 `nearest(target, scale)`，clamp 60..84
  4. `vel = clamp(0.35 + intensity/3*0.5 + (i%4==0?0.08:0) + (rng()*0.08-0.04), 0.2, 1)`
  5. `durBeats = 到下一 onset 的距离*0.9`；末音 = `meterNum − onset/4`；`is_phrase_end` 末音 ×2 并 snap 到根音/五音
  6. swing：`i%4===2` 的 onset `startBeats += plan.swing * 1.0`；奇数 16 分格 `+= plan.swing * 0.5`
- **LH 渲染**（voicing=lhVoicing(chord)，b=bass，u=upper 数组，beat=1 拍）：
  - `block`：b(0,4拍,.5) + u 各(0,4,.4)
  - `ballad`：b(0,2,.5) + u(0,2,.35) + u(2,2,.4)
  - `alberti`：8 分循环 [b, u0, u1, u0]（每音 .5 拍，vel .32+起伏）
  - `arp`：8 分 [b,u0,u1,u2] 上行循环
  - `broken`：16 分 [b,u0,u1,u2,u1,u0,u1,u2,...] 每音 1 格，vel .28
  - `waltz`：b(0,1,.55) + u 和弦齐奏(1,1,.4) + u(2,1,.35)
  - `shell`：[b, b+10半音内的7th](0,3,.45) + 同(2,2,.4)（7th 取 chordPool 中距 b 最近的 10..11 半音音）
  - `stride`：b(0,.5) b+7(1,.5) u齐奏(1,.5)（2、3 拍同构轮换 root/fifth）
  - `walk`：四分 [b, nearest(b+3or4,chordPool), nearest(b+7,chordPool), nearest(b+10±1,chordPool)] vel .45
  - `octave`：8 分 b 与 b+12 交替齐奏，vel .4+intensity 加成
  - `pad`：b+u 全小节(0,meterNum,.35)
  - LH 音域强制 36..64。
- **每小节请求**：`askJev({state, questions}, cfg)`；**任何失败（无 key/CORS/断网）→ fixtureAnswer 同构兜底**，decision.fixture=true，播放永不中断。

- [x] Step 1: 写 `test/composer.test.mjs`（channel:'fixture'，固定 seed）：
  - 同 seed 两次 `nextBar()` 前几小节 NoteEvent 序列**完全一致**（确定性）
  - 100 小节内：所有 LH 音 36..64、RH 音 58..86（swing 后 startBeats 单调不回退超出 0.4 拍）、vel 0.15..1
  - `is_phrase_end` 小节（index%8==7）的末音 ∈ 当前和弦音
  - `breathe=true` 的小节首 onset ≥ 1 格
  - `buildPlan`（llm disabled）：keyword 路径返回合法 Plan；`styleId:'waltz'` 强制 meterNum=3
  - decision.fixture===true 且 answers 含全部 6 个 qid
- [x] Step 2: `npm test` → FAIL；Step 3: 实现；Step 4: `npm test` → 全绿
- [x] Step 5: `git commit -m "feat: per-bar composer with fixture decisions"`

### Task 4: 音频引擎（audio.js）

**Files:** Create `public/js/audio.js`（Node 不可测 Web Audio，抽出纯函数测参数）

```js
export function envFor(midi, vel, brightness) → { peak, decay, cutoff, release }
// peak = .12 + vel*.55；decay = clamp(5.5 − (midi−36)/12*1.4, 1.2, 5.5) 秒
// cutoff = min(9000, 480 + midi*28*(0.4+brightness) + vel*2200)；release = .28
export class PianoAudio {
  async ensure()          // 首次用户手势创建/resume AudioContext（48k）
  play(midi, whenSec, durSec, vel)   // 3 osc：triangle@f + sine@2.003f(.4) + sine@3.01f(.14)
                  // → gain 包络(envFor) → lowpass → 干(0.85)+卷积混响(0.22，生成式 IR 1.8s 立体声指数衰减噪声)
                  // 复音上限 32：超出时强释最旧
  setVolume(v) / mute(bool)
  startRec() → stopRec() → Promise<Blob>   // MediaStreamDestination + MediaRecorder(webm/opus)
}
```

- [x] Step 1: 测试 `envFor`：midi 84 比 36 的 decay 短；vel 1 的 cutoff > vel 0.2；peak 单调。`npm test`
- [x] Step 2: 实现（合成参数按上面注释逐条落地，混响 IR 用 `ctx.createBuffer` 双通道 `Math.exp(-3t)` 噪声）
- [x] Step 3: `npm test` 全绿；`git commit -m "feat: synthesized piano audio engine"`

### Task 5: 实时调度器（player.js）

**Files:** Create `public/js/player.js`；Test `test/player.test.mjs`

```js
const LOOKAHEAD = 0.15 /*s*/, TICK = 30 /*ms*/, AHEAD_BARS = 2;
export class Player {
  constructor({ audio, composer, bpm, onBar, onNote, now, setIntervalFn })  // now/setIntervalFn 可注入
  start() / stop()
  // tick()：1) 把队列中 t < now()+LOOKAHEAD 的事件交给 audio.play + onNote（并 startBeats 记入 records）
  //        2) 排队小节数 < AHEAD_BARS 且 !deciding → composer.nextBar() 入队（拍→秒：60/bpm，含 swing 偏移在 composer 内已加）
  //        3) onBar(bar) 在该小节首音时刻触发（ui 显示当前和弦/决策）
  records: {midi,startBeats,durBeats,vel,hand}[]   // MIDI 导出数据源
}
```

- [x] Step 1: 测试（假 now：每次调用 +0.05s；假 audio 记录 play 调用；假 composer 预生成 4 小节）：启动后推进 20 tick → 播放事件按时间序、AHEAD_BARS≤2、stop() 后不再调度、records 长度=音符数
- [x] Step 2: `npm test` → FAIL；Step 3: 实现；Step 4: 全绿
- [x] Step 5: `git commit -m "feat: lookahead realtime player"`

### Task 6: MIDI 导出（midi.js）

**Files:** Create `public/js/midi.js`；Test `test/midi.test.mjs`

- [x] Step 1: 测试：`exportMidi(records,{bpm:96,meterNum:4})` → 字节以 `MThd` 开头、format=1、ntrks=3、division=480；track0 tempo 事件 `FF 51 03` 值=60000000/96；一条已知音符在 track1/2（hand）VLQ 正确
- [x] Step 2: 实现：`vlq(n)`、`trackOf(events)`（note on 0x90/vel、note off 0x80，delta 排序）、header + 3 track 拼接；`git commit -m "feat: smf export"`

### Task 7: 页面结构（index.html + styles.css）

**Files:** Create `public/index.html`, `public/styles.css`

元素 id 契约（Task 8/10 依赖，逐字实现）：

| id | 元素 | 用途 |
|---|---|---|
| `prompt` | textarea | 一句话灵感 |
| `styleChips` | div（8 chip + “随机”chip，data-style） | 曲风选择，默认“随机” |
| `goal` | select | 放松助眠/专注陪伴/情绪宣泄/欢快庆典/随机冒险 |
| `barsSelect` | select | 16/32/64 小节（默认 32） |
| `bpmAuto`/`bpmRange` | checkbox+range 50..140 | 速度（默认跟随计划） |
| `playBtn`/`stopBtn`/`newBtn` | button | 开始/停止/换一版（新 seed 重排计划） |
| `midiBtn`/`recBtn` | button | 导出 MIDI / 录音开关 |
| `planCard` | div | 计划卡（title/style/key/bpm/arc/mood/notes/source 徽标） |
| `nowChord`/`nowBar` | div | 当前和弦、小节 |
| `fallCanvas` | canvas | 下落音符（每 midi 列宽=canvas/49，C2..C6） |
| `keyboard` | div | 49 个白键 span + 黑键绝对定位（36..84） |
| `decisionLog` | ul | 每小节一条：`第n小节 · 和弦 · 左手 · 走向 · 密度 · 强度 · xxms · $x.xxxxx（置信x.xx）` |
| `statusBar` | div | 渠道徽标 / 累计 tokens / 累计费用 / 平均延迟 |
| `settingsBtn`/`settingsDrawer` | button/aside | 渠道 channel select（fixture/typesafe/openrouter/proxy）、两个 key password 框、LLM 开关 + baseUrl/model/key、两个「测试」按钮 |
| `toast` | div | 错误提示 |

样式：暗色（#0e1116 底、#e8e2d0 字），chips 圆角胶囊，键盘白键 #f5f1e6 黑键 #1a1d22，`.on` 高亮琥珀 #f0b429；下落音符 RH #f0b429 / LH #5cc8c8。移动端 ≤720px 单列。

- [x] Step 1: 写 `index.html`（按上表完整结构，`<script type="module" src="js/main.js">`）
- [x] Step 2: 写 `styles.css`（上述主题逐条落地）
- [x] Step 3: `git commit -m "feat: page structure & theme"`

### Task 8: UI 逻辑（ui.js + main.js）

**Files:** Create `public/js/ui.js`, `public/js/main.js`

- [x] Step 1: `ui.js`：`renderKeyboard(36,84)`（白键 DOM + 黑键定位函数 `blackOffset(midi)`）；`flashKey(midi, untilSec)`；`class Fall`（raf 循环，push(note{midi,tSec,durSec,vel,hand})，底部对齐键盘）；`addDecision(BarResult)`（中文行，前置插入，上限 60 条）；`renderPlan(Plan)`；`setStatus(...)`
- [x] Step 2: `main.js`：设置持久化 localStorage key `jevpiano.settings.v1`（channel/keys/llmCfg，明示"仅存本机"）；启动时 `probeProxy()` 自动推荐渠道（proxy ok→proxy，否则 fixture）；开始流程：`ensure()` → `buildPlan()`（renderPlan）→ `new Player(...)` start；停止/换一版/导出（Blob 下载 `title.mid`）/录音；错误 → toast
- [x] Step 3: `git commit -m "feat: ui wiring, visuals, settings"`

### Task 9: Worker 与部署（src/worker.js + wrangler.toml + dev-proxy.py）

**Files:** Create `src/worker.js`, `wrangler.toml`, `.dev.vars.example`, `dev-proxy.py`

- [x] Step 1: `worker.js`（完整逻辑）：

```js
// GET  /api/probe → { ok:true, jev:'workers-ai'|'key'|null, llm:bool }
// POST /api/jev   → 优先 env.AI.run('@cf/typesafe/jev',{state,questions})（结果统一包成 {answers,usage}）；
//                   否则 env.TYPESAFE_API_KEY → 官方，env.OPENROUTER_API_KEY → OpenRouter(v1/systemone)
//                   均无 → 501 {error:'no jev backend: bind AI or set TYPESAFE_API_KEY/OPENROUTER_API_KEY'}
// POST /api/llm   → env.LLM_BASE_URL/LLM_API_KEY/LLM_MODEL 优先，否则转发客户端自带配置；均无 → 501
// 其余 → env.ASSETS.fetch(request)
```

- [x] Step 2: `wrangler.toml`：`main="src/worker.js"`、`compatibility_date="2026-09-01"`、`[assets] directory="./public" binding="ASSETS" run_worker_first=["/api/*"]`、`[ai] binding="AI"`（注释注明：账号无 Workers AI 时删除此两行，改用 secret）
- [x] Step 3: `dev-proxy.py`（stdlib only）：`--port 8000`；静态服务 public/；`/api/probe`→`{ok,jev:'mock'|'key',llm}`（有 TYPESAFE_API_KEY 环境变量则真转发 `/api/jev`，否则按 criteria 键均匀采样返回 mock answers）
- [x] Step 4: 语法检查：`node --check src/worker.js`（ESM：用 `node --input-type=module --check < src/worker.js`）+ `python -m py_compile dev-proxy.py`
- [x] Step 5: `git commit -m "feat: cf worker, wrangler config, dev proxy"`

### Task 10: 端到端验证（浏览器实测）

- [x] Step 1: `python dev-proxy.py --port 8000` 后台启动
- [x] Step 2: 浏览器（browser-use）打开 `http://127.0.0.1:8000`：输入"雨夜的城市，一个人走在霓虹下"、风格"随机" → 开始：断言 **无 console 错误**、`decisionLog` 每 2s 增加行、键盘出现高亮、`nowChord` 变化；截图检查布局
- [x] Step 3: 渠道切换测试：settings → proxy 渠道（mock）重播一次正常；typesafe 渠道无 key → toast 报错且不崩溃
- [x] Step 4: 导出 MIDI → 下载文件头为 `MThd`；停止 → 无残留 timer
- [x] Step 5: 修复发现的问题并 `git commit -m "fix: e2e findings"`

### Task 11: README 与收尾

- [x] Step 1: `README.md`：项目简介、架构图（文字版）、三种 Jev 渠道配置（Workers AI/secret/BYOK）、LLM 扩写配置、本地开发（dev-proxy.py / wrangler dev）、成本估算（~$0.00002/小节，32 小节 ≈ $0.0006）、远期路线图（**乐团版**：多轨=多乐器合成器，Jev 每轨每小节并行决策 + LLM 担任"指挥"做曲式级规划，Jeithoven 式 lane 模型）
- [x] Step 2: 最终全量 `npm test` + `git commit -m "docs: readme & roadmap"`

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| TypeSafe/OpenRouter 浏览器直连 CORS 不确定 | 渠道面板提供同源代理；直连失败 toast 提示切换，播放不中断（fixture 兜底） |
| Workers AI 的 @cf/typesafe/jev 返回体与 HTTP 版可能有包装差异 | worker 内归一化：`raw.answers ?? raw` 包成 `{answers}` |
| 无 key 用户听感全靠 fixture | fixture 与真实 Jev 共用同一候选集与权重（同构决策器），并在 UI 明示"离线随机" |
| 旋律难听 | 候选集本身已过滤（音域/和弦锚定/终止式），motif 记忆保持统一性；密度/亮度可实时滑 |
| AudioContext 自动播放策略 | start 按钮内 ensure()（用户手势）；页面提示点击开始 |
