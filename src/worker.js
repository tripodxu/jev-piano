// src/worker.js — Cloudflare Worker：静态资产 + 三个 API。
// Jev 决策后端按序链式降级：Workers AI 绑定（env.AI，零 key）→ TYPESAFE_API_KEY → OPENROUTER_API_KEY。
// /api/llm 只转发服务端 env 配置的端点（刻意不做开放中继，防 SSRF）。
// 两个 API 共享每 IP 限流（isolate 内存，尽力而为）：RATE_LIMIT_PER_MIN，默认 90——
// 实时演奏每小节一次请求（140 BPM ≈ 35 次/分钟），30 没有余量。

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...extra } });

/** 载荷上限（轮次 43）：API 转发上游是要花钱的，任意大的请求体必须在门口拦下 */
export const LIMITS = { jevBodyBytes: 256 * 1024, llmBodyBytes: 64 * 1024, llmMaxMessages: 24 };

export function createRateLimiter() {
  const hits = new Map();
  const sweep = (now) => {
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => now - t < 60_000);
      if (fresh.length) hits.set(k, fresh); else hits.delete(k);
    }
  };
  return {
    check(ip, limit, now = Date.now()) {
      const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
      const blocked = arr.length >= limit;
      arr.push(now);
      hits.set(ip, arr);
      if (hits.size > 10_000) sweep(now); // 内存护栏：只清过期条目，活跃 IP 的计数不再被 clear-all 误伤
      return blocked;
    },
    sweep,
  };
}

const limiter = createRateLimiter();

/** 载荷校验（可单测）：返回错误文案或空串 */
export function validateJevBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid body: {state, questions} expected';
  if (!body.questions || typeof body.questions !== 'object' || Array.isArray(body.questions)) return 'invalid questions: plain object expected';
  if (JSON.stringify(body).length > LIMITS.jevBodyBytes) return `payload 过大（> ${LIMITS.jevBodyBytes} 字节）`;
  return '';
}

export function validateLlmBody(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return 'invalid body: {messages} expected';
  if (body.messages.length > LIMITS.llmMaxMessages) return `messages 过多（> ${LIMITS.llmMaxMessages}）`;
  if (JSON.stringify(body).length > LIMITS.llmBodyBytes) return `payload 过大（> ${LIMITS.llmBodyBytes} 字节）`;
  return '';
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/probe') {
      const jev = env.AI ? 'workers-ai' : (env.TYPESAFE_API_KEY || env.OPENROUTER_API_KEY ? 'key' : null);
      const llm = !!(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
      return json({ ok: true, jev, llm });
    }
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const limit = Number(env.RATE_LIMIT_PER_MIN ?? 90);
    if (limiter.check(ip, limit)) return json({ error: 'rate limited, retry in a minute' }, 429, { 'Retry-After': '60' });

    if (url.pathname === '/api/jev' && request.method === 'POST') return handleJev(request, env);
    if (url.pathname === '/api/llm' && request.method === 'POST') return handleLlm(request, env);
    return env.ASSETS.fetch(request);
  },
};

/** Workers AI 绑定；失败抛错由调用方链式降级。
 *  aiBroken：本 isolate 内已知该账号没有 jev 模型（部署账号实测 5007），跳过以免每拍白撞 */
let aiBroken = false;
async function jevViaAI(env, body) {
  const raw = await env.AI.run('@cf/typesafe/jev', { state: body.state, questions: body.questions });
  return { model: raw?.model ?? 'jev', answers: raw?.answers ?? raw, usage: raw?.usage ?? {} };
}

/** HTTP 型上游（TypeSafe / OpenRouter，体格式一致） */
async function jevViaHTTP(endpoint, model, key, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, state: body.state, questions: body.questions }),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

async function handleJev(request, env) {
  const body = await readJson(request);
  const invalid = validateJevBody(body);
  if (invalid) return json({ error: invalid }, invalid.includes('过大') ? 413 : 422);

  const backends = [];
  if (env.AI && !aiBroken) backends.push(['workers-ai', () => jevViaAI(env, body)]);
  if (env.TYPESAFE_API_KEY) backends.push(['typesafe', () => jevViaHTTP('https://api.typesafe.ai/v1/systemone', 'jev-latest', env.TYPESAFE_API_KEY, body)]);
  if (env.OPENROUTER_API_KEY) backends.push(['openrouter', () => jevViaHTTP('https://openrouter.ai/api/v1/systemone', 'typesafe/jev-1.13', env.OPENROUTER_API_KEY, body)]);

  if (!backends.length) {
    return json({ error: 'no jev backend: bind [ai] in wrangler.toml or set TYPESAFE_API_KEY / OPENROUTER_API_KEY secret' }, 501);
  }
  let lastErr = null;
  for (const [name, run] of backends) {
    try {
      const out = await run();
      return json({ ...out, backend: name });
    } catch (e) {
      lastErr = e;
      // AI 失败记忆（2026-09-30 线上实弹）：模型不存在（5007）时每个 isolate 记住，
      // 不再逐小节白撞一次——失败调用既加延迟也烧限流配额
      if (name === 'workers-ai' && /no such model|5007/i.test(String(e?.message ?? ''))) aiBroken = true;
    }
  }
  return json({ error: 'all jev backends failed: ' + String(lastErr?.message ?? lastErr) }, 502);
}

async function handleLlm(request, env) {
  const body = await readJson(request);
  const invalid = validateLlmBody(body);
  if (invalid) return json({ error: invalid }, invalid.includes('过大') ? 413 : 422);
  // 安全边界：只允许服务端配置的端点与凭据，忽略请求体里的 baseUrl/apiKey/model（防开放中继）
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !env.LLM_MODEL) {
    return json({ error: 'llm proxy not configured: deployer must set LLM_BASE_URL/LLM_API_KEY/LLM_MODEL' }, 501);
  }
  const payload = {
    model: env.LLM_MODEL,
    messages: body.messages,
    temperature: body.temperature ?? 0.9,
    max_tokens: body.max_tokens ?? 400,
    ...(body.response_format ? { response_format: body.response_format } : {}),
  };
  try {
    const res = await fetch(String(env.LLM_BASE_URL).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return json({ error: `llm upstream ${res.status}` }, 502);
    const data = await res.json().catch(() => ({}));
    return json({ content: data.choices?.[0]?.message?.content ?? '' });
  } catch (e) {
    return json({ error: 'llm fetch failed: ' + String(e?.message ?? e) }, 502);
  }
}
