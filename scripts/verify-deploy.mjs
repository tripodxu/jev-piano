// verify-deploy.mjs — 部署后核验：线上跑的确实是刚测过的那份代码。
//
// 为什么需要它：本地 npm test 全绿只证明**磁盘上**的代码是对的。轮次 48 上线时
// 本地外网被沙箱拦断，无法确认 CDN 边缘拿到的就是这份——部署成功与部署正确是两件事。
// wrangler 的上传清单能告诉你传了哪 5 个文件，但不能告诉你文件内容对。
//
// 用法：
//   node scripts/verify-deploy.mjs [baseUrl]
//   VEV_BASE=https://xxx.example.com node scripts/verify-deploy.mjs
//
// 默认打生产自定义域 https://jevpiano.logicc.top/。
// 注：*.workers.dev 的默认域在本机被 DNS 投毒（解析到 Facebook IP 段），
// 所以核验走自定义域；确需打 workers.dev 时显式传 URL 参数。
// 退出码 0 = 全部命中；1 = 有缺失或网络不可达（可稍后重试，任务板有对应条目）。
//
// ⚠️ /api/jev 那一发是真钱（~$0.00008），默认打；加 --no-api 跳过。

const BASE = process.argv.find((a) => /^https?:/.test(a))
  ?? process.env.VEV_BASE
  ?? 'https://jevpiano.logicc.top';
const withApi = !process.argv.includes('--no-api');

// 每个条目：文件 → 必须出现在线上的代码片段（改动时同步更新这里）
const CHECKS = [
  { file: '/js/player.js', needles: ['_decisionBudget', '_settleBudgets', 'barStartSec < this._now()'], why: '轮次 48：决策预算 + 迟到小节顺延' },
  { file: '/js/composer.js', needles: ['budgetMiss', 'deadlineMiss'], why: '轮次 48：预算赛跑 + 如实标记' },
  { file: '/js/ui.js', needles: ['decisionGuards', '超预算', 'accumulateLedger', 'ledgerPills', 'keyEchoText', 'markDiff'], why: '轮次 48/50 台账与归因 + 55 跟弹回声 + 57 和弦键' },
  { file: '/js/music.js', needles: ['chordRole', "'blues'", 'mixolydian'], why: '轮次 55 和弦角色 + 58 蓝调曲风' },
  { file: '/js/cadence.js', needles: ['cadenceIntoBar', 'CADENCE_ZH'], why: '轮次 55：终止式识别' },
  { file: '/js/canvas.js', needles: ['class Fall', 'user: !!user', 'PULSE_TICK_MS'], why: '轮次 52 canvas 三件套 + 56 跟弹用户音符' },
  { file: '/js/studio-roll.js', needles: ['createRollView', 'cadenceIntoBar', '悬停'], why: '轮次 54 卷帘视图 + 55 hover 终止式 + 57 悬停音符角色' },
  { file: '/js/studio.js', needles: ['accumulateLedger(ledger, bar.decision)', 'refreshLedger', 'syncKeyMarks'], why: '轮次 50 工作室逐小节记账 + 57 和弦键同步' },
  { file: '/js/main.js', needles: ['user: true', 'CADENCE_ZH', 'kbEcho'], why: '轮次 55-57 跟弹接线（回声/终止式/下落音符）' },
  // 轮次 49：三个静默 bug 的现场——线上必须同时具备「布局常量」与「舞台灯光 DOM」
  { file: '/js/studio-core.js', needles: ['export const ZOOM', 'export const HEADER', 'H_TENSION'], why: '轮次 49：布局常量回填（此前卷帘整条绘制路径 ReferenceError）' },
  { file: '/js/kbd.js', needles: ['KEY_SEMITONES', 'attachKeyboard', 'enabled'], why: '轮次 65/68：电脑键盘弹奏 + 视图路由（防双触发）' },
  { file: '/index.html', needles: ['stageWarm', 'kbEcho', 'stKbEcho', 'data-style="blues"', 'stage-idle'], why: '轮次 49 舞台灯光 + 55 回声条 + 58 蓝调选项 + 66 空态覆盖层' },
  // 轮次 69：样式表拆层 + 前端去重的线上核验
  // 拆分的失败模式是静默的（少 link 一个文件整层消失），所以线上必须同时看到
  // 「index.html 引了分层样式表」与「tokens.css 内容真的上了」，二者缺一即为半吊子部署。
  { file: '/index.html', needles: ['styles/tokens.css', 'styles/motion.css', 'skip-link', 'sr-only'], why: '轮次 69：七层样式表引用 + 跳转链接/屏读文本' },
  { file: '/styles/tokens.css', needles: ['@layer tokens', '--brass-hi', '--surface-3'], why: '轮次 69：设计令牌层（层序 + 颜色变量真的上到边缘）' },
  { file: '/js/dom.js', needles: ['escapeHtml', 'downloadBlob'], why: '轮次 69：共享 DOM 原语（此前 main/studio 各存一份 download）' },
  { file: '/js/ui.js', needles: ['refreshStatusPills', 'attachPlayableKeyboard'], why: '轮次 69：共享台账刷新 + 键盘接线（enabled 守卫改必填）' },
];

// 网络抖动会让 fetch 抛 TypeError（本沙箱对目标域时通时断），而内容不符是**确定信号**。
// 两者绝不能混为一谈：某文件在 t1 失败、t2 通过，说明是网络；报「缺片段」才是内容问题。
// 所以只对**网络异常**重试（3 次、退避），HTTP 非 200 与片段缺失一律立即判失败。
const RETRIES = 3;
async function fetchText(url, timeoutMs) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return { r, text: await r.text() };
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await new Promise((res) => setTimeout(res, 400 * attempt));
    }
  }
  throw lastErr;
}

let bad = 0;
for (const c of CHECKS) {
  try {
    const { r, text: t } = await fetchText(BASE + c.file, 20000);
    if (!r.ok) { console.log(`✗ ${c.file} HTTP ${r.status}`); bad++; continue; }
    const miss = c.needles.filter((n) => !t.includes(n));
    if (miss.length) { console.log(`✗ ${c.file} 缺 ${JSON.stringify(miss)}（${c.why}）`); bad++; }
    else console.log(`✓ ${c.file} ${c.needles.length}/${c.needles.length} 命中（${c.why}）`);
  } catch (e) {
    console.log(`✗ ${c.file} 取不到（重试 ${RETRIES} 次仍失败）：${e.name} ${e.message}`);
    bad++;
  }
}

// 生产决策路径：确认线上真渠道活着（ Workers AI 5007 → 链式降级到 TYPESAFE_API_KEY ）
try {
  const { r, text } = await fetchText(BASE + '/api/probe', 20000);
  console.log(`${r.ok ? '✓' : '✗'} /api/probe HTTP ${r.status} ${text}`);
  if (!r.ok) bad++;
} catch (e) { console.log(`✗ /api/probe 取不到：${e.message}`); bad++; }

// 轮次 63 的可执行断言：同源防护必须在边缘上活着——text/plain 简单请求（盲 CSRF 载体）必须被拒。
// 这个检查不花上游的钱（在我们的边缘就被 415 挡下），也是 worker.js 部署内容的核验
// （worker 源码不是静态资产，CHECKS 拉不到它，行为检查是唯一途径）。
try {
  const r = await fetch(BASE + '/api/jev', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    signal: AbortSignal.timeout(20000),
  });
  const ok = r.status === 415 || r.status === 403;
  console.log(`${ok ? '✓' : '✗'} 同源防护：text/plain POST → HTTP ${r.status}（应 415/403，拒绝即证明新 worker 已上线）`);
  if (!ok) bad++;
} catch (e) { console.log(`✗ 同源防护检查失败：${e.message}`); bad++; }

if (withApi) {
  try {
    const body = {
      state: { style: 'newage', mood: 'calm', harmony: { current: 'Am', current_roman: 'i', current_function: 'T', recent: [], loop_locked: false } },
      questions: {
        function: { type: 'choice', instructions: 'Choose the harmonic FUNCTION for the NEXT bar.', criteria: { T: 'tonic', S: 'subdominant', D: 'dominant', Tp: 'color' } },
        chord: { type: 'choice', instructions: 'Choose the chord.', criteria: { i: 'i', bIII: 'bIII', bVI: 'bVI', bVII: 'bVII' } },
        lh: { type: 'choice', instructions: 'Choose LH texture.', criteria: { block: 'block', ballad: 'ballad' } },
        rhythm: { type: 'choice', instructions: 'Choose RH rhythm.', criteria: { r0: 'sparse', r1: 'medium' } },
        contour: { type: 'choice', instructions: 'Choose contour.', criteria: { rise: 'rise', wave: 'wave' } },
        intensity: { type: 'score', instructions: 'Intensity 0-3.', criteria: ['soft', 'gentle', 'confident', 'climactic'] },
        breathe: { type: 'noul', instructions: 'Should the melody breathe?', criteria: { true: 'yes', false: 'no' } },
        develop: { type: 'choice', instructions: 'How does the NEXT bar relate to the motif?', criteria: { repeat: 'repeat', new: 'new' } },
      },
    };
    const t0 = Date.now();
    const r = await fetch(BASE + '/api/jev', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const txt = await r.text();
    const ok = r.ok && /"answers"/.test(txt);
    console.log(`${ok ? '✓' : '✗'} /api/jev HTTP ${r.status} in ${Date.now() - t0}ms :: ${txt.slice(0, 120)}`);
    if (!ok) bad++;
  } catch (e) { console.log(`✗ /api/jev 取不到：${e.message}`); bad++; }
}

console.log(bad ? `\n${bad} 项未过——可能只是本地外网被拦（稍后重试），也可能部署内容不对（必须查）` : '\n部署核验全部通过');
process.exit(bad ? 1 : 0);
