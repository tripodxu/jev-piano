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
  { file: '/js/ui.js', needles: ['decisionGuards', '超预算', 'accumulateLedger', 'ledgerPills'], why: '轮次 48 归因标记 + 轮次 50 共享计费台账' },
  // 轮次 49：三个静默 bug 的现场——线上必须同时具备「布局常量」与「舞台灯光 DOM」
  { file: '/js/studio-core.js', needles: ['export const ZOOM', 'export const HEADER', 'H_TENSION'], why: '轮次 49：布局常量回填（此前卷帘整条绘制路径 ReferenceError）' },
  { file: '/index.html', needles: ['stageWarm', 'stageCool'], why: '轮次 49：舞台灯光 DOM（此前 onBar 每小节抛异常，导致 0 tok）' },
  // 轮次 50：工作室记账的现场——接线点在 studio.js，实现点在 ui.js
  { file: '/js/studio.js', needles: ['accumulateLedger(ledger, bar.decision)', 'refreshLedger'], why: '轮次 50：工作室逐小节记账（此前完全不记账）' },
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
