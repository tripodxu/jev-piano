// jev.js — Jev（TypeSafe 系统一模型）客户端：四渠道 + fixture 采样 + LLM 扩写。
// 真实契约（2026-09-28 用 jev-1.13.0 实测，scripts/probe-jev.mjs 可复现）：
//   POST {endpoint} {model, state, questions:{id:{type,instructions,criteria}}}
//   → {model, answers:{id:{type,'choice'|'score'|'noul', confidence?, probabilities?}}, usage:{input_tokens,output_tokens}}
//   choice 的值在 answer.choice；score 的值是等级序号(整数)，criteria 必须是数组；noul 的值是 0..1 概率。
// 本模块对外统一归一化成 answers[id] = { value, confidence?, probabilities? }。

export const CHANNELS = {
  typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.13' },
  proxy: { endpoint: 'api/jev', model: null }, // 服务端决定 model；请求体不带 model 字段
};

/** TypeSafe 牌价：输入 $0.042/百万 token，输出免费 */
export const TYPESAFE_USD_PER_TOKEN = 0.042 / 1e6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单个 answer（真实 API 形态）→ { value, confidence?, probabilities? } */
export function normalizeAnswer(a) {
  if (!a || typeof a !== 'object') return { value: null };
  if (a.type === 'choice') return { value: a.choice ?? null, confidence: a.confidence, probabilities: a.probabilities };
  if (a.type === 'score') return { value: a.score != null ? Number(a.score) : null, confidence: a.confidence, probabilities: a.probabilities };
  if (a.type === 'noul') return { value: a.noul != null ? a.noul >= 0.5 : null, probability: a.noul };
  return { value: a.value ?? null, confidence: a.confidence, probabilities: a.probabilities };
}

function normalizeAnswers(raw) {
  const out = {};
  for (const [id, a] of Object.entries(raw || {})) out[id] = normalizeAnswer(a);
  return out;
}

/** 深拷贝并剔除以 _ 开头的字段（_fixture 等本地提示不发给真实 API） */
export function stripPrivate(questions) {
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    const copy = {};
    for (const [k, v] of Object.entries(q)) if (!k.startsWith('_')) copy[k] = v;
    out[id] = copy;
  }
  return out;
}

/** 按权重采样一个键；权重缺省均匀 */
export function weightedPick(weights, rng) {
  const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
  if (!entries.length) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

/**
 * fixture 决策器：与真实 Jev 同构（同一候选集），按 _fixture.weights 采样。
 * noul 权重 {true:p, false:1-p}；score 权重按等级序号；choice 按选项。
 * 返回与真实 API 相同的归一化形态；confidence 用最高权重占比合成。
 */
export function fixtureAnswer(questions, rng) {
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    const w = q._fixture?.weights ?? {};
    if (q.type === 'noul') {
      const pTrue = Math.min(1, Math.max(0, w.true ?? 0.5));
      const value = rng() < pTrue;
      out[id] = { value, probability: pTrue };
    } else if (q.type === 'score') {
      const levels = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria ?? {});
      const weights = {};
      levels.forEach((_, i) => { weights[String(i)] = w[String(i)] ?? 1; });
      const pick = weightedPick(weights, rng);
      const sum = Object.values(weights).reduce((s, x) => s + x, 0);
      out[id] = { value: Number(pick), confidence: (weights[pick] ?? 1) / sum };
    } else {
      const base = q.criteria ?? {};
      const weights = Object.fromEntries(Object.keys(base).map((k) => [k, w[k] ?? 1]));
      const pick = weightedPick(weights, rng) ?? Object.keys(base)[0];
      const sum = Object.values(weights).reduce((s, x) => s + x, 0);
      out[id] = { value: pick, confidence: (weights[pick] ?? 1) / sum };
    }
  }
  return out;
}

/**
 * 一次 Jev 请求。
 * cfg = { channel:'fixture'|'typesafe'|'openrouter'|'proxy', apiKey?, model?, signal?, sleep? }
 * 返回 { answers(归一化), inputTokens, usd, ms, fixture }；fixture 渠道不产生 tokens。
 * 网络错误与 429/529 指数退避重试（最多 4 次）；其余状态码抛错。
 */
export async function askJev({ state, questions }, cfg, fetchImpl = fetch) {
  const sleepFn = cfg.sleep ?? sleep;
  if (cfg.channel === 'fixture') {
    return { answers: fixtureAnswer(questions, cfg.rng ?? Math.random), inputTokens: 0, usd: 0, ms: 0, fixture: true };
  }
  const ch = CHANNELS[cfg.channel];
  if (!ch) throw new Error('未知渠道: ' + cfg.channel);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.channel === 'proxy') {
    // key 在服务端；用户自带 model 时透传
  } else {
    if (!cfg.apiKey) throw Object.assign(new Error('尚未配置该渠道的 API Key'), { code: 'no_key' });
    headers.Authorization = 'Bearer ' + cfg.apiKey;
    if (cfg.channel === 'openrouter') headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'http://localhost';
  }
  const payload = { state, questions: stripPrivate(questions) };
  if (ch.model) payload.model = cfg.model || ch.model;

  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleepFn(250 * 2 ** attempt * (0.75 + Math.random() / 2));
    const t0 = Date.now();
    let res;
    try {
      // 实时演奏约束：单次决策不能超过 ~10s，超时按失败处理（composer 会同构兜底）
      const signal = cfg.signal ?? AbortSignal.timeout(10_000);
      res = await fetchImpl(ch.endpoint, { method: 'POST', headers, signal, body: JSON.stringify(payload) });
    } catch (e) {
      if (e?.name === 'AbortError' && cfg.signal) throw e; // 用户主动取消
      lastErr = new Error('网络错误：' + e.message + '（若浏览器跨域受限，请改用「同源代理」渠道）');
      continue;
    }
    if (res.status === 429 || res.status === 529) { lastErr = new Error(`Jev 限流(${res.status})`); continue; }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Jev API ${res.status}：${text.slice(0, 200)}`);
    }
    const body = await res.json().catch(() => ({}));
    const raw = body.answers ?? body; // Workers AI/代理可能去掉外层包装
    const usage = body.usage ?? {};
    return {
      answers: normalizeAnswers(raw),
      inputTokens: usage.input_tokens ?? 0,
      usd: cfg.channel === 'openrouter' ? (usage.cost ?? 0) : (usage.input_tokens ?? 0) * TYPESAFE_USD_PER_TOKEN,
      ms: Date.now() - t0,
      fixture: false,
    };
  }
  throw lastErr ?? new Error('Jev 请求失败');
}

/** 探测同源代理能力；纯静态托管（404）时返回 null */
export async function probeProxy(baseUrl = '') {
  try {
    const res = await fetch(`${baseUrl}/api/probe`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** LLM 扩写的系统提示词（只输出 JSON） */
export const PLAN_SYS_PROMPT = [
  '你是作曲助理，把用户的一句话扩写成钢琴即兴曲的创作计划。只输出一个 JSON 对象，不要任何其他文字或代码块标记。',
  '字段与取值：',
  '{"title":"诗意曲名，不超过12个字","style":"classical|romantic|jazz|pop|lofi|newage|waltz|oriental 之一",',
  ' "mode":"major|minor|dorian|pentatonic 之一","keyPc":0-11 的整数(C=0,D=1,...,B=11),"bpm":50-140 的整数,',
  ' "mood":["两个英文情绪词"],"arc":"flat|rise|arch|fall 之一","swing":0-0.35,"density":0-1,"brightness":0-1,',
  ' "notes":"给演奏者的一句中文提示，20字内"}',
  '若 hint 里给了 style 必须服从；bpm/density/brightness 尽量符合 goal 的意图；mode 用小调表达阴郁、大调表达明亮，五声(pentatonic)适合东方与空灵题材。',
].join('\n');

/**
 * LLM 扩写：任意 OpenAI 兼容 /chat/completions。
 * llmCfg = { baseUrl, model, apiKey, proxy?:bool, signal? }
 * 返回解析后的 JSON 对象；失败返回 null（调用方回退到 keyword 计划）。
 */
export async function expandPlan(prompt, hint, llmCfg, fetchImpl = fetch) {
  const url = llmCfg.proxy ? 'api/llm' : llmCfg.baseUrl?.replace(/\/+$/, '') + '/chat/completions';
  if (!url) return null;
  const headers = { 'Content-Type': 'application/json' };
  if (!llmCfg.proxy) {
    if (!llmCfg.apiKey || !llmCfg.model) return null;
    headers.Authorization = 'Bearer ' + llmCfg.apiKey;
  }
  const userMsg = `用户的想法：${prompt}\nhint：${JSON.stringify(hint)}`;
  const build = (jsonMode) => ({
    model: llmCfg.model || 'auto',
    messages: [{ role: 'system', content: PLAN_SYS_PROMPT }, { role: 'user', content: userMsg }],
    temperature: 0.9,
    max_tokens: 400,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });
  for (const jsonMode of [true, false]) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, signal: llmCfg.signal, body: JSON.stringify(build(jsonMode)) });
      if (!res.ok) {
        if (jsonMode) continue; // 有些端点不支持 response_format，去掉重试一次
        return null;
      }
      const body = await res.json();
      const content = llmCfg.proxy ? (body.content ?? body.choices?.[0]?.message?.content) : body.choices?.[0]?.message?.content;
      const jsonText = /{[\s\S]*}/.exec(String(content ?? ''))?.[0];
      return jsonText ? JSON.parse(jsonText) : null;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      if (jsonMode) continue;
      return null;
    }
  }
  return null;
}
