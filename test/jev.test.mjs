// jev.test.mjs — 注入假 fetch / 假 sleep，验证四渠道、重试、归一化与 fixture 采样
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askJev, fixtureAnswer, stripPrivate, normalizeAnswer, expandPlan, CHANNELS, TYPESAFE_USD_PER_TOKEN,
} from '../public/js/jev.js';

const Q = {
  chord: {
    type: 'choice',
    instructions: 'pick chord',
    criteria: { Am: 'tonic', E7: 'dominant', F: 'warm' },
    _fixture: { weights: { Am: 0.6, E7: 1.2, F: 0.2 } },
  },
  intensity: {
    type: 'score',
    instructions: 'intensity 0-3',
    criteria: ['soft', 'gentle', 'fuller', 'loud'],
    _fixture: { weights: { '0': 1, '1': 2, '2': 1, '3': 0 } },
  },
  breathe: { type: 'noul', instructions: 'breathe?', criteria: { true: 'yes', false: 'no' }, _fixture: { weights: { true: 0.65, false: 0.35 } } },
};

test('stripPrivate 剔除 _ 前缀字段', () => {
  const s = stripPrivate(Q);
  assert.equal(s.chord._fixture, undefined);
  assert.equal(s.chord.criteria.Am, 'tonic');
  assert.equal(s.chord.type, 'choice');
});

test('normalizeAnswer 适配真实响应字段', () => {
  assert.deepEqual(normalizeAnswer({ type: 'choice', choice: 'E7', confidence: 0.42, probabilities: { E7: 0.53 } }),
    { value: 'E7', confidence: 0.42, probabilities: { E7: 0.53 } });
  assert.deepEqual(normalizeAnswer({ type: 'score', score: 1, confidence: 0.6 }), { value: 1, confidence: 0.6, probabilities: undefined });
  assert.deepEqual(normalizeAnswer({ type: 'noul', noul: 0.68 }), { value: true, probability: 0.68 });
  assert.deepEqual(normalizeAnswer({ type: 'noul', noul: 0.2 }).value, false);
});

test('askJev: typesafe 渠道 200 → 归一化 + 计费 + 请求体不含 _fixture', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        chord: { type: 'choice', choice: 'E7', confidence: 0.42, probabilities: { E7: 0.53 } },
        intensity: { type: 'score', score: 2, confidence: 0.6 },
        breathe: { type: 'noul', noul: 0.2 },
      },
      usage: { input_tokens: 796, output_tokens: 89 },
    }), { status: 200 });
  };
  const out = await askJev({ state: { a: 1 }, questions: Q }, { channel: 'typesafe', apiKey: 'k', sleep: async () => {} }, fakeFetch);
  assert.equal(captured.url, CHANNELS.typesafe.endpoint);
  assert.equal(captured.body.model, 'jev-latest');
  assert.equal(captured.body.questions.chord._fixture, undefined);
  assert.equal(captured.headers.Authorization, 'Bearer k');
  assert.equal(out.answers.chord.value, 'E7');
  assert.equal(out.answers.intensity.value, 2);
  assert.equal(out.answers.breathe.value, false);
  assert.equal(out.inputTokens, 796);
  assert.ok(Math.abs(out.usd - 796 * TYPESAFE_USD_PER_TOKEN) < 1e-12);
  assert.equal(out.fixture, false);
});

test('askJev: 429 后重试成功', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return calls === 1 ? new Response('{}', { status: 429 })
      : new Response(JSON.stringify({ answers: { chord: { type: 'choice', choice: 'F' } }, usage: {} }), { status: 200 });
  };
  const out = await askJev({ state: {}, questions: Q }, { channel: 'typesafe', apiKey: 'k', sleep: async () => {} }, fakeFetch);
  assert.equal(calls, 2);
  assert.equal(out.answers.chord.value, 'F');
});

test('askJev: attempts 选项收紧重试上限（实时场景防长静默）', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return new Response('{}', { status: 429 }); };
  await assert.rejects(
    () => askJev({ state: {}, questions: Q }, { channel: 'typesafe', apiKey: 'k', attempts: 2, sleep: async () => {} }, fakeFetch),
    /限流/,
  );
  assert.equal(calls, 2);
});

test('askJev: proxy 渠道不带 Authorization、不带 model', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return new Response(JSON.stringify({ answers: {}, usage: {} }), { status: 200 });
  };
  await askJev({ state: {}, questions: Q }, { channel: 'proxy', sleep: async () => {} }, fakeFetch);
  assert.equal(captured.url, 'api/jev');
  assert.equal(captured.body.model, undefined);
  assert.equal(captured.headers.Authorization, undefined);
});

test('askJev: 无 key 的直连渠道直接抛错', async () => {
  await assert.rejects(() => askJev({ state: {}, questions: Q }, { channel: 'typesafe', sleep: async () => {} }, async () => new Response('{}', { status: 200 })), /API Key/);
});

test('fixtureAnswer: 种子确定性 + 权重按比例采样 + confidence 合成', () => {
  // 显式随机序列：chord r=0.35 → 0.7/2.0 落在 E7 带；intensity r=0.3 → 1.2/4.0 落在 '1' 带；breathe r=0.9 > 0.65 → false
  const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
  const a1 = fixtureAnswer(Q, seq([0.35, 0.3, 0.9]));
  const a2 = fixtureAnswer(Q, seq([0.35, 0.3, 0.9]));
  assert.deepEqual(a1, a2);                     // 确定性
  assert.equal(a1.chord.value, 'E7');           // 0.35*2=0.7 ∈ [0.6,1.8) E7 带
  assert.ok(Math.abs(a1.chord.confidence - 1.2 / 2.0) < 1e-9);
  assert.equal(a1.intensity.value, 1);          // 0.3*4=1.2 ∈ [1,3) '1' 带；'3' 权重 0 被剔除
  assert.equal(a1.breathe.value, false);        // 0.9 > pTrue 0.65
  const b = fixtureAnswer(Q, seq([0.1, 0.05, 0.1]));
  assert.equal(b.chord.value, 'Am');            // 低分段落进 Am 带
  assert.equal(b.breathe.value, true);          // 0.1 < 0.65
});

test('expandPlan: JSON 提取与失败返回 null', async () => {
  const ok = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '好的，这是计划：{"title":"雨夜即兴","style":"romantic"}' } }],
  }), { status: 200 });
  const plan = await expandPlan('雨夜', {}, { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, ok);
  assert.equal(plan.title, '雨夜即兴');

  const bad = async () => new Response(JSON.stringify({ choices: [{ message: { content: '无法解析' } }] }), { status: 200 });
  assert.equal(await expandPlan('雨夜', {}, { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, bad), null);

  const err = async () => new Response('{}', { status: 401 });
  assert.equal(await expandPlan('雨夜', {}, { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' }, err), null);
});
