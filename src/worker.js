// src/worker.js — Cloudflare Worker：静态资产 + 三个 API。
// Jev 决策后端优先级：Workers AI 绑定（env.AI，零 key）→ TYPESAFE_API_KEY → OPENROUTER_API_KEY。
// LLM 扩写代理：优先服务端 env.LLM_*，否则透传客户端自带配置（BYOK）。
// 契约与 public/js/jev.js 一致：请求 {state, questions}（可带 model），响应透传上游。

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

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
    if (url.pathname === '/api/jev' && request.method === 'POST') return handleJev(request, env);
    if (url.pathname === '/api/llm' && request.method === 'POST') return handleLlm(request, env);
    return env.ASSETS.fetch(request);
  },
};

async function handleJev(request, env) {
  const body = await readJson(request);
  if (!body || !body.questions) return json({ error: 'invalid body: {state, questions} expected' }, 422);

  if (env.AI) {
    try {
      const raw = await env.AI.run('@cf/typesafe/jev', { state: body.state, questions: body.questions });
      // 归一化：不同运行时可能带/不带 answers 外壳
      return json({ model: raw?.model ?? 'jev', answers: raw?.answers ?? raw, usage: raw?.usage ?? {} });
    } catch (e) {
      return json({ error: 'workers-ai run failed: ' + String(e?.message ?? e) }, 502);
    }
  }

  let upstream = null;
  if (env.TYPESAFE_API_KEY) {
    upstream = ['https://api.typesafe.ai/v1/systemone', 'jev-latest', env.TYPESAFE_API_KEY];
  } else if (env.OPENROUTER_API_KEY) {
    upstream = ['https://openrouter.ai/api/v1/systemone', 'typesafe/jev-1.13', env.OPENROUTER_API_KEY];
  } else {
    return json({ error: 'no jev backend: bind [ai] in wrangler.toml or set TYPESAFE_API_KEY / OPENROUTER_API_KEY secret' }, 501);
  }
  const [endpoint, model, key] = upstream;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, state: body.state, questions: body.questions }),
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

async function handleLlm(request, env) {
  const body = await readJson(request);
  if (!body || !Array.isArray(body.messages)) return json({ error: 'invalid body: {messages} expected' }, 422);
  const baseUrl = env.LLM_BASE_URL || body.baseUrl;
  const apiKey = env.LLM_API_KEY || body.apiKey;
  const model = env.LLM_MODEL || body.model;
  if (!baseUrl || !apiKey || !model) {
    return json({ error: 'no llm backend: set LLM_BASE_URL/LLM_API_KEY/LLM_MODEL or pass baseUrl/apiKey/model in body' }, 501);
  }
  const payload = {
    model,
    messages: body.messages,
    temperature: body.temperature ?? 0.9,
    max_tokens: body.max_tokens ?? 400,
    ...(body.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch(String(baseUrl).replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return json({ error: `llm upstream ${res.status}` }, 502);
  const data = await res.json().catch(() => ({}));
  return json({ content: data.choices?.[0]?.message?.content ?? '' });
}
