// src/worker.js — Cloudflare Worker：静态资产 + 三个 API。
// Jev 决策后端按序链式降级：Workers AI 绑定（env.AI，零 key）→ TYPESAFE_API_KEY → OPENROUTER_API_KEY。
// /api/llm 只转发服务端 env 配置的端点（刻意不做开放中继，防 SSRF）。
// 两个 API 共享每 IP 限流（isolate 内存，尽力而为）：RATE_LIMIT_PER_MIN，默认 30。

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** 滑动窗口限流。Workers isolate 内存计数：单实例精确，多实例为尽力而为的下限保护。 */
const hits = new Map();
function rateLimited(ip, limit) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  const blocked = arr.length >= limit;
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 10_000) hits.clear(); // 内存护栏：清空后重新累计，误伤可接受
  return blocked;
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
    const limit = Number(env.RATE_LIMIT_PER_MIN ?? 30);
    if (rateLimited(ip, limit)) return json({ error: 'rate limited, retry in a minute' }, 429);

    if (url.pathname === '/api/jev' && request.method === 'POST') return handleJev(request, env);
    if (url.pathname === '/api/llm' && request.method === 'POST') return handleLlm(request, env);
    return env.ASSETS.fetch(request);
  },
};

/** Workers AI 绑定；失败抛错由调用方链式降级 */
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
  if (!body || !body.questions) return json({ error: 'invalid body: {state, questions} expected' }, 422);

  const backends = [];
  if (env.AI) backends.push(['workers-ai', () => jevViaAI(env, body)]);
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
    }
  }
  return json({ error: 'all jev backends failed: ' + String(lastErr?.message ?? lastErr) }, 502);
}

async function handleLlm(request, env) {
  const body = await readJson(request);
  if (!body || !Array.isArray(body.messages)) return json({ error: 'invalid body: {messages} expected' }, 422);
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
