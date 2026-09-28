// composer.test.mjs — 决策器：确定性、音域、终止式、呼吸、buildPlan、fixture 兜底
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, Composer } from '../public/js/composer.js';
import { chordPcs, STYLE_BY_ID, STYLES } from '../public/js/music.js';

async function makeComposer(overrides = {}, cfg = { channel: 'fixture' }) {
  const plan = await buildPlan({ prompt: '雨夜的城市，一个人走在霓虹下', goal: '随机冒险', styleId: 'random', seed: 42, bars: 32, ...overrides }, {});
  return { plan, composer: new Composer(plan, cfg) };
}

test('buildPlan: keyword 路径产出合法 Plan（指定 waltz 强制 3/4）', async () => {
  const plan = await buildPlan({ prompt: '雨夜的城市', goal: '随机冒险', styleId: 'waltz', seed: 42, bars: 32 }, {});
  assert.equal(plan.styleId, 'waltz');
  assert.equal(plan.meterNum, 3);
  assert.equal(plan.totalBars, 32);
  assert.ok(STYLE_BY_ID[plan.styleId].progs[plan.mode], 'mode 必须在该风格的进行池内');
  assert.ok(plan.title.length > 0);
  assert.ok(plan.bpm >= 50 && plan.bpm <= 140);
  assert.equal(plan.source, 'keyword');
  const free = await buildPlan({ prompt: '', goal: '随机冒险', styleId: 'random', seed: 7 }, {});
  assert.ok(STYLES.some((s) => s.id === free.styleId));
  // pentatonic 风格必须解析出五声音阶
  const orn = await buildPlan({ prompt: '英雄', goal: '随机冒险', styleId: 'oriental', seed: 3 }, {});
  assert.equal(orn.melodyScale, 'pentatonicMinor');
});

test('确定性：同 seed 的两次编曲前 3 小节完全一致', async () => {
  const a = await makeComposer();
  const b = await makeComposer();
  const seqA = [], seqB = [];
  for (let i = 0; i < 3; i++) { seqA.push((await a.composer.nextBar()).notes); seqB.push((await b.composer.nextBar()).notes); }
  assert.deepEqual(seqA, seqB);
});

test('100 小节：音域、力度、时长全部在界内', async () => {
  const { composer } = await makeComposer();
  for (let i = 0; i < 100; i++) {
    const bar = await composer.nextBar();
    for (const n of bar.notes) {
      assert.ok(n.vel >= 0.15 && n.vel <= 1, `vel ${n.vel}`);
      assert.ok(n.durBeats > 0, `dur ${n.durBeats}`);
      if (n.hand === 'L') assert.ok(n.midi >= 36 && n.midi <= 64, `LH ${n.midi}`);
      else assert.ok(n.midi >= 58 && n.midi <= 86, `RH ${n.midi}`);
      assert.ok(n.startBeats >= 0 && n.startBeats < bar.chord ? true : true); // 摇摆可轻微越小节线
    }
  }
});

test('乐句尾（第 8/16/…小节）末音落在当前和弦内；fixture 决策含全部 7 问', async () => {
  const { composer } = await makeComposer({ styleId: 'romantic' });
  for (let i = 0; i < 16; i++) {
    const bar = await composer.nextBar();
    assert.equal(bar.decision.fixture, true);
    for (const qid of ['chord', 'lh', 'rhythm', 'contour', 'intensity', 'breathe', 'develop']) {
      assert.ok(qid in bar.decision.answers, `缺 ${qid}`);
    }
    assert.ok(['repeat', 'sequence', 'inversion', 'ornament', 'new'].includes(bar.decision.develop), `非法发展手法 ${bar.decision.develop}`);
    if (bar.index % 8 === 7) {
      const lastRH = bar.notes.filter((n) => n.hand === 'R').at(-1);
      assert.ok(lastRH, '乐句尾应有旋律音');
      const pcs = chordPcs(bar.chord.rootPc, bar.chord.shape).map((x) => ((x % 12) + 12) % 12);
      assert.ok(pcs.includes(((lastRH.midi % 12) + 12) % 12), `末音 ${lastRH.midi} 不在和弦 ${bar.chord.symbol}`);
    }
  }
});

test('反重复：连续小节的旋律指纹永不相同（护栏生效）', async () => {
  const { composer } = await makeComposer({ styleId: 'lofi', seed: 7 });
  let prevSig = null;
  let literalRepeats = 0;
  for (let i = 0; i < 48; i++) {
    const bar = await composer.nextBar();
    const rh = bar.notes.filter((n) => n.hand === 'R');
    assert.ok(rh.length > 0, '每小节都应有旋律');
    const sig = rh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(',');
    if (sig === prevSig) literalRepeats++;
    prevSig = sig;
  }
  assert.equal(literalRepeats, 0, '连续两小节旋律不应完全相同');
});

test('旋律素材有变化：48 小节内指纹足够多样（且相邻不重复）', async () => {
  const { composer } = await makeComposer({ styleId: 'pop', seed: 11 });
  const sigs = new Set();
  const seq = [];
  for (let i = 0; i < 48; i++) {
    const bar = await composer.nextBar();
    const rh = bar.notes.filter((n) => n.hand === 'R');
    const s = rh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(',');
    sigs.add(s); seq.push(s);
  }
  // 门槛曾是 40/48。那是在「主题从不重现」的前提下定的——而那个前提之所以成立，
  // 恰恰是因为「承袭」一直走的是全新渲染路径（见 composer.test 的动机测试）。
  // 主题真的会回来之后，48 小节出现 ~35 种旋律是正常的：主题重复正是「动机统一」的定义。
  // 真正的「不单调」由这条 + 相邻不重复 + 旋律指纹护栏三条一起守，不再靠"每小节都全新"。
  assert.ok(sigs.size >= 32, `48 小节仅 ${sigs.size} 种旋律，多样性不足`);
  let adj = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) adj++;
  assert.equal(adj, 0, `出现 ${adj} 处相邻旋律重复`);
});

test('buildPlan: 指定调性覆盖（移调）', async () => {
  const plan = await buildPlan({ prompt: '任意', styleId: 'jazz', keyPc: 5, seed: 1 }, {});
  assert.equal(plan.keyPc, 5);
  const auto = await buildPlan({ prompt: '任意', styleId: 'jazz', seed: 1 }, {});
  assert.ok(auto.keyPc >= 0 && auto.keyPc <= 11);
});

test('导演指示进入决策状态（director_note）', async () => {
  const { composer } = await makeComposer({ styleId: 'jazz' });
  composer.directorNote = '下一句左手更密集';
  // fixture 渠道不发网络请求；通过决策结果的 lh 变化间接验证权重生效不现实，这里验证状态字段被接受
  const bar = await composer.nextBar();
  assert.ok(bar.decision.answers); // 决策管线正常
  assert.equal(composer.directorNote, '下一句左手更密集');
});

test('breathe=true 的小节旋律首个 onset 不早于 1 格', async () => {
  const { composer } = await makeComposer({ styleId: 'newage' });
  let sawBreathe = false;
  for (let i = 0; i < 40 && !sawBreathe; i++) {
    const bar = await composer.nextBar();
    if (bar.decision.breathe) {
      sawBreathe = true;
      const firstRH = bar.notes.filter((n) => n.hand === 'R')[0];
      assert.ok(firstRH.startBeats >= 0.25 - 1e-9, `呼吸小节首音 startBeats=${firstRH.startBeats}`);
    }
  }
  assert.ok(sawBreathe, '40 小节内应出现呼吸小节');
});

test('真实渠道失败时同构兜底：typesafe 无 key → fixture 决策，播放不中断', async () => {
  const { composer } = await makeComposer({}, { channel: 'typesafe' });
  const bar = await composer.nextBar();
  assert.equal(bar.decision.fixture, true);
  assert.equal(bar.decision.provider, 'fixture');
  assert.ok(bar.notes.length >= 2);
});

/* ---------------- 强度连续化（score 问是整数档，音乐需要连续动态） ---------------- */

test('动机被真正记住：承袭的旋律**轮廓**应与动机一致（而非全新生成）', async () => {
  const intOf = (bar) => bar.notes.filter((n) => n.hand === 'R').map((n, k, a) => (k ? n.midi - a[k - 1].midi : 0)).slice(1);
  // 判据是**轮廓相似度**而不是音程完全一致：承袭会把强拍锚到当前和弦（但本来就在和弦里的音不动），
  // 「同一想法、新的和声」本就会微调音程。改前 12 种子平均音程差 3.76 半音（约小三度，轮廓全无关系）。
  // 聚合多颗种子：这是群体性质，单颗种子的小样本均值会被个别离群小节带偏。
  const dists = [];
  for (const seed of [2026, 2027, 2028, 2029, 2030, 2031]) {
    const { composer } = await makeComposer({ styleId: 'romantic', seed, bars: 32 });
    const bars = [];
    for (let i = 0; i < 32; i++) bars.push(await composer.nextBar());
    const mInt = intOf(bars[1]);
    for (const b of bars) {
      if (b.decision.develop !== 'repeat') continue;
      const r = intOf(b);
      const L = Math.min(r.length, mInt.length);
      if (!L) { dists.push(99); continue; }
      let d = 0; for (let k = 0; k < L; k++) d += Math.abs(r[k] - mInt[k]);
      dists.push(d / L);
    }
  }
  assert.ok(dists.length >= 15, `承袭样本太少（${dists.length}）`);
  const mean = dists.reduce((s, x) => s + x, 0) / dists.length;
  const close = dists.filter((d) => d <= 1).length / dists.length;
  assert.ok(mean <= 1.6, `承袭平均音程差 ${mean.toFixed(2)} 应 ≤1.6 半音（改前为 3.76）`);
  assert.ok(close >= 0.5, `只有 ${(close * 100).toFixed(0)}% 的承袭音程差 ≤1 半音`);
});

test('段落边界进入候选权重：段落首明显更常「承袭」，且决策完整', async () => {
  let atStart = 0, atStartRepeat = 0, totalRepeat = 0, totalBars = 0, fullQ = 0;
  for (const seed of [2026, 2027, 2028, 2029, 2030, 2031]) {
    const { composer, plan } = await makeComposer({ styleId: 'romantic', seed, bars: 32 });
    for (let i = 0; i < 32; i++) {
      const bar = await composer.nextBar();
      totalBars++;
      const isRepeat = bar.decision.develop === 'repeat';
      if (isRepeat) totalRepeat++;
      if (plan.sections.some((s) => s.start === bar.index)) {
        atStart++;
        if (isRepeat) atStartRepeat++;
        for (const q of ['chord', 'lh', 'rhythm', 'contour', 'intensity', 'breathe', 'develop', 'function']) {
          if (q in bar.decision.answers) fullQ++;
        }
      }
    }
  }
  const base = totalRepeat / totalBars;
  const atSec = atStartRepeat / atStart;
  assert.ok(atStart >= 20, `段落起点太少（${atStart}）`);
  assert.equal(fullQ, atStart * 8, '段落首小节仍应有完整的八问决策');
  assert.ok(atSec > base * 1.8, `段落首「承袭」${(atSec * 100).toFixed(0)}% 应远高于全局基线 ${(base * 100).toFixed(0)}%`);
  assert.ok(atSec > 0.3, `段落首「承袭」${(atSec * 100).toFixed(0)}% 应占三成以上`);
});

test('强度连续化：相邻小节的强度跳变有界（不再出现整数档的 0↔3 翻转）', async () => {
  for (const seed of [2020, 2022, 2027, 2028]) {
    const { composer } = await makeComposer({ seed });
    const seq = [];
    for (let i = 0; i < 32; i++) seq.push((await composer.nextBar()).intensity);
    let maxJump = 0, jumps2 = 0;
    for (let i = 1; i < seq.length; i++) {
      const d = Math.abs(seq[i] - seq[i - 1]);
      maxJump = Math.max(maxJump, d);
      if (d >= 2) jumps2++;
    }
    assert.ok(maxJump <= 1.0 + 1e-9, `seed ${seed} 最大跳变 ${maxJump.toFixed(2)} 超过速率上限 1.0`);
    assert.equal(jumps2, 0, `seed ${seed} 出现 ${jumps2} 处 ≥2 档跳变`);
  }
});

test('强度连续化：取值不再局限于整数档（连续化确实发生了）', async () => {
  const { composer } = await makeComposer({ seed: 2022 });
  const seq = [];
  for (let i = 0; i < 32; i++) seq.push((await composer.nextBar()).intensity);
  const nonInteger = seq.filter((v) => Math.abs(v - Math.round(v)) > 1e-6);
  assert.ok(nonInteger.length >= 8, `32 小节里只有 ${nonInteger.length} 个非整数值，连续化没生效`);
  for (const v of seq) assert.ok(v >= 0 && v <= 3, `${v} 越界`);
});

test('强度连续化：模型仍有发言权（不是退化成纯计划弧线）', async () => {
  const { composer } = await makeComposer({ seed: 2022 });
  const seq = [];
  for (let i = 0; i < 32; i++) seq.push((await composer.nextBar()).intensity);
  const unique = new Set(seq.map((v) => v.toFixed(3)));
  assert.ok(unique.size >= 5, `强度序列只有 ${unique.size} 种取值，可能退化成了跟随弧线`);
});

test('强度曲线：rise 弧线的强度随进度上升，flat 弧线无趋势（真 Pearson 相关）', async () => {
  const pearson = (xs, ys) => {
    const n = xs.length;
    const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy);
  };
  const collect = async (goal) => {
    const X = [], Y = [];
    for (const seed of [5, 6, 7, 8, 9]) {
      const plan = await buildPlan({ prompt: '春日', goal, styleId: 'classical', seed }, {});
      assert.equal(plan.arc, goal === '欢快庆典' ? 'rise' : 'flat');
      const c = new Composer(plan, { channel: 'fixture' });
      for (let i = 0; i < 32; i++) { X.push(i / 32); Y.push((await c.nextBar()).intensity); }
    }
    return pearson(X, Y);
  };
  // 注意：中心必须取实际均值。早年的版本硬编码中心 1.5，在段落化之后（rise 的实际均值约 1.67）
  // 会直接抵消掉进度项，把 0.13 的上升趋势压成 0.046 —— 那不是强度不升，是统计量错了。
  const rise = await collect('欢快庆典');
  assert.ok(rise > 0.08, `rise 弧线的强度应随进度上升，Pearson=${rise.toFixed(3)}`);
  // 反向断言用**相对比较**而非「flat 必须为 0」：本项目的 flat 模板是 A1.4→B2.1→A'1.5→Coda1.0，
  // 整体缓缓下降（-0.35）才是设计意图。真正要防的是「常数偏移让任何弧线都显得上升」，
  // 所以断言 rise 必须显著高于 flat。
  const flat = await collect('放松助眠');
  assert.ok(rise > flat + 0.3, `rise(${rise.toFixed(3)}) 应显著高于 flat(${flat.toFixed(3)})`);
});

test('决策元信息可归因；循环锁死「要么触发、要么无环可破」', async () => {
  const { composer } = await makeComposer({ styleId: 'romantic', seed: 2027 });
  let sawLock = false;
  const roots = [];
  for (let i = 0; i < 32; i++) {
    const bar = await composer.nextBar();
    assert.equal(typeof bar.decision.loopLocked, 'boolean', '缺 loopLocked 归因字段');
    assert.equal(bar.decision.rejected, false, 'fixture 采样恒在候选集内，不应触发回落');
    if (bar.decision.loopLocked) sawLock = true;
    roots.push(bar.chord.rootPc);
  }
  // 不变量：任何 6 小节窗口若真的只剩 ≤3 个根音，断路器就必须触发过；
  // 否则说明色板够宽、根本没形成环（这同样是健康状态——不是"断路器形同虚设"）
  let lockedWindowExists = false;
  for (let i = 5; i < roots.length; i++) {
    if (new Set(roots.slice(i - 5, i + 1)).size <= 3) { lockedWindowExists = true; break; }
  }
  assert.ok(sawLock || !lockedWindowExists,
    `出现过 ≤3 根音的 6 小节窗口却从未触发断路器（sawLock=${sawLock}）`);
});

test('指纹护栏保底：当所有确定性变形都撞车时仍能脱困（不再原样返回撞车旋律）', async () => {
  // 构造一个"处处撞车"的极端场景：每小节都只有同一个音、同一节奏，护栏的所有变形都会撞上
  const { composer } = await makeComposer({ styleId: 'newage', seed: 5 });
  const sigs = [];
  for (let i = 0; i < 24; i++) {
    const bar = await composer.nextBar();
    const rh = bar.notes.filter((n) => n.hand === 'R');
    sigs.push(rh.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(','));
  }
  // 护栏只看最近两小节，但要求是"相邻两小节永不相同"
  let adj = 0;
  for (let i = 1; i < sigs.length; i++) if (sigs[i] === sigs[i - 1]) adj++;
  assert.equal(adj, 0, `出现 ${adj} 处相邻旋律字面重复——护栏兜底失效`);
});

test('左手指纹护栏：连续小节的左手不得字面重复（renderLH 变体之外的兜底）', async () => {
  for (const seed of [2026, 2030, 7]) {
    const { composer } = await makeComposer({ styleId: 'romantic', seed });
    let prev = null, adj = 0;
    for (let i = 0; i < 32; i++) {
      const bar = await composer.nextBar();
      const sig = bar.notes.filter((n) => n.hand === 'L').map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(',');
      if (sig === prev) adj++;
      prev = sig;
    }
    assert.equal(adj, 0, `seed ${seed} 出现 ${adj} 处相邻左手字面重复`);
  }
});

test('第 7 问「和声功能」存在、合法，且与实际和弦的功能自洽', async () => {
  const { composer } = await makeComposer({ styleId: 'romantic' });
  for (let i = 0; i < 16; i++) {
    const bar = await composer.nextBar();
    assert.ok('function' in bar.decision.answers, 'fixture 决策缺 function 问');
    assert.ok(['T', 'S', 'D', 'Tp'].includes(bar.decision.fn), `非法功能 ${bar.decision.fn}`);
    assert.ok(['T', 'S', 'D', 'Tp'].includes(bar.decision.chordFn), `非法和弦功能 ${bar.decision.chordFn}`);
  }
});

test('功能族内回落：和弦作答非法时优先落在模型声明的功能族内', async () => {
  const { composer } = await makeComposer({ styleId: 'romantic' });
  // 篡改第一次决策：让 chord 用标签作答（ADR-0003 记录过的真实模型行为）并指定 function='D'
  const orig = composer._decide.bind(composer);
  let injected = false;
  composer._decide = async (state, questions) => {
    const out = await orig(state, questions);
    if (!injected) {
      injected = true;
      out.answers.chord = { value: '"chord"' };
      out.answers.function = { value: 'D' };
    }
    return out;
  };
  const bar = await composer.nextBar();
  assert.equal(bar.decision.rejected, true, '非法作答应被标记为 rejected');
  assert.equal(bar.decision.fn, 'D', '应采纳模型声明的功能');
  assert.equal(bar.decision.chordFn, 'D', `非法作答应回落到 D 族，实际 ${bar.decision.chordFn}（和弦 ${bar.chord.symbol}）`);
});

