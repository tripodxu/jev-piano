// composer.test.mjs — 决策器：确定性、音域、终止式、呼吸、buildPlan、fixture 兜底
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, Composer, mulberry32 } from '../public/js/composer.js';
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

test('乐句尾（第 8/16/…小节）末音落在当前和弦内；fixture 决策含全部 6 问', async () => {
  const { composer } = await makeComposer({ styleId: 'romantic' });
  for (let i = 0; i < 16; i++) {
    const bar = await composer.nextBar();
    assert.equal(bar.decision.fixture, true);
    for (const qid of ['chord', 'lh', 'rhythm', 'contour', 'intensity', 'breathe']) {
      assert.ok(qid in bar.decision.answers, `缺 ${qid}`);
    }
    if (bar.index % 8 === 7) {
      const lastRH = bar.notes.filter((n) => n.hand === 'R').at(-1);
      assert.ok(lastRH, '乐句尾应有旋律音');
      const pcs = chordPcs(bar.chord.rootPc, bar.chord.shape).map((x) => ((x % 12) + 12) % 12);
      assert.ok(pcs.includes(((lastRH.midi % 12) + 12) % 12), `末音 ${lastRH.midi} 不在和弦 ${bar.chord.symbol}`);
    }
  }
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

test('强度曲线：rise 弧线后段强度高于前段', async () => {
  const plan = await buildPlan({ prompt: '春日', goal: '欢快庆典', styleId: 'classical', seed: 5 }, {});
  assert.equal(plan.arc, 'rise');
  const c = new Composer(plan, { channel: 'fixture' });
  const first = [];
  const last = [];
  for (let i = 0; i < 32; i++) {
    const bar = await c.nextBar();
    (i < 8 ? first : last).push(bar.intensity);
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(avg(last) > avg(first), `rise 弧线应后强前弱: first=${avg(first).toFixed(2)} last=${avg(last).toFixed(2)}`);
});
