// worker.test.mjs — Worker 边界的纯逻辑：限流窗口/清扫、载荷校验（轮次 43）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, validateJevBody, validateLlmBody, LIMITS } from '../src/worker.js';

test('rateLimiter: 窗口内计数、跨窗口重置', () => {
  const rl = createRateLimiter();
  let now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rl.check('1.1.1.1', 3, now), false);
  assert.equal(rl.check('1.1.1.1', 3, now), true, '窗口内第 4 次被限');
  now += 60_001;
  assert.equal(rl.check('1.1.1.1', 3, now), false, '窗口滑过后重新计数');
});

test('rateLimiter: 清扫只丢过期条目，活跃 IP 的计数保留（不再 clear-all 误伤）', () => {
  const rl = createRateLimiter();
  let now = 1_000_000;
  rl.check('active', 3, now);
  rl.check('stale', 3, now - 120_000); // 过期 IP
  rl.sweep(now);
  assert.equal(rl.check('active', 3, now), false, '活跃 IP 第 2 次仍正常计数（3 上限内）');
  // stale 的旧时间戳已清掉：它现在从头计数
  assert.equal(rl.check('stale', 3, now), false);
});

test('validateJevBody: 缺 questions / questions 非对象 / 载荷超限', () => {
  assert.equal(validateJevBody({ state: {}, questions: { chord: {} } }), '');
  assert.ok(validateJevBody(null).length > 0);
  assert.ok(validateJevBody({ questions: [1, 2] }).includes('questions'), '数组不算合法 questions');
  const big = { state: { pad: 'x'.repeat(LIMITS.jevBodyBytes) }, questions: { a: {} } };
  assert.ok(validateJevBody(big).includes('过大'), '载荷超限拒绝');
});

test('validateLlmBody: messages 数量与总大小上限', () => {
  assert.equal(validateLlmBody({ messages: [{ role: 'user', content: 'hi' }] }), '');
  assert.ok(validateLlmBody({ messages: Array.from({ length: 30 }, () => ({ role: 'user', content: 'x' })) }).includes('messages'));
  const big = { messages: [{ role: 'user', content: 'x'.repeat(LIMITS.llmBodyBytes) }] };
  assert.ok(validateLlmBody(big).includes('过大'));
});
