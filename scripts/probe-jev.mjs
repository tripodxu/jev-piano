// scripts/probe-jev.mjs — 真实 Jev API 冒烟：发送一次音乐决策请求，打印原始响应。
// 用法：node scripts/probe-jev.mjs   （key 取自环境变量 TYPESAFE_API_KEY 或项目根 .dev.vars）
// 这是唯一"真花钱"的脚本：单次请求 ~$0.00002，只在显式运行时执行。
import { readFileSync } from 'node:fs';

let key = process.env.TYPESAFE_API_KEY;
if (!key) {
  try {
    key = /^TYPESAFE_API_KEY=(.*)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1]?.trim();
  } catch { /* no .dev.vars */ }
}
if (!key) { console.error('未找到 TYPESAFE_API_KEY'); process.exit(1); }

const state = {
  piece: { style: 'romantic nocturne piano', mood: ['rainy', 'melancholy'], goal: '情绪宣泄', arc: 'arch', key: 'A minor', meter: '4/4', bpm: 66 },
  position: { bar: 7, bar_in_phrase: 7, phrase: 0, is_phrase_end: true, progress: 0.22 },
  harmony: { current: 'Dm', recent: ['Am', 'F', 'C', 'Dm'] },
  last_bar: { lh: 'broken chord 16ths', contour: 'arch', tier: 1, ended_on: 'C5' },
  intensity_so_far: 1.6,
  user_prompt: '雨夜的城市，一个人走在霓虹下',
};

const questions = {
  chord: {
    type: 'choice',
    instructions: 'You are the harmony planner of a live piano improvisation. Choose the chord for the NEXT bar. Keep voice leading smooth from `harmony.current`, serve the style and mood, and respect phrase endings (prefer V or I at phrase ends). Answer ONLY with the Choice question "chord".',
    criteria: {
      'Am': 'tonic, home and dark, resolves the phrase',
      'E7': 'dominant, strong tension pulling back to Am, classic phrase end',
      'F': 'submediant, warm and loose',
      'Dm': 'subdominant, soft continuation',
      'C': 'relative major, brief brightness',
    },
  },
  intensity: {
    type: 'score',
    instructions: 'Musical intensity for the NEXT bar on 0-3, given arc, phrase position and history.',
    criteria: ['very soft, airy', 'gentle', 'confident, fuller texture', 'climactic, full sound'],
  },
  breathe: {
    type: 'noul',
    instructions: 'Should the melody breathe (start after a rest) in the NEXT bar?',
    criteria: { true: 'yes, leave space', false: 'no, keep singing' },
  },
};

const t0 = Date.now();
const res = await fetch('https://api.typesafe.ai/v1/systemone', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'jev-latest', state, questions }),
});
const ms = Date.now() - t0;
console.log('HTTP', res.status, `in ${ms}ms`);
const body = await res.json().catch(() => ({}));
console.log(JSON.stringify(body, null, 2));
