// scripts/probe-bar.mjs — 用真实 Jev API 跑一整小节的 6 问决策（buildPlan+Composer 生产路径）
// 用法：node scripts/probe-bar.mjs [prompt] （key 取自 .dev.vars 或环境变量 TYPESAFE_API_KEY）
import { readFileSync } from 'node:fs';
import { buildPlan, Composer } from '../public/js/composer.js';

let key = process.env.TYPESAFE_API_KEY;
if (!key) {
  try { key = /^TYPESAFE_API_KEY=(.*)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1]?.trim(); } catch { /* */ }
}
if (!key) { console.error('未找到 TYPESAFE_API_KEY'); process.exit(1); }

const plan = await buildPlan({ prompt: process.argv[2] ?? '雨夜的城市，一个人走在霓虹下', goal: '情绪宣泄', styleId: 'random', seed: 2026, bars: 32 }, {});
console.log('计划:', JSON.stringify({ title: plan.title, style: plan.styleName, mode: plan.mode, bpm: plan.bpm, arc: plan.arc, density: plan.density }, null, 0));

const composer = new Composer(plan, { channel: 'typesafe', apiKey: key });
for (let i = 0; i < 3; i++) {
  const bar = await composer.nextBar();
  const d = bar.decision;
  console.log(
    `第${bar.index + 1}小节[${bar.label}] ${bar.chord.symbol} | 左手=${d.lh} 走向=${d.contour} 密度=${d.tier} 强度=${bar.intensity} 呼吸=${d.breathe}`
    + ` | ${d.fixture ? 'FIXTURE(兜底:' + (d.error ?? '') + ')' : `${d.ms}ms ${d.inputTokens}tok $${d.usd.toFixed(6)}`}`
    + ` | 音符${bar.notes.length}个 置信=${d.confidence?.toFixed?.(2)}`
  );
}
