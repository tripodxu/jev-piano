// scripts/regression-gate.mjs — 决策指标的回归门（轮次 28 固化）。
// 把 19+ 轮迭代里靠人肉执行的「12 种子指标门」变成一条命令：npm run gate。
// 硬不变量（相邻字面重复 = 0）逐种子判定；软指标（多样性）取 12 种子均值对照门槛。
// 门槛不是拍脑袋：chords/entropy/melody/lh 的下限来自 docs/memory 各轮的校准记录。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 门配置：单一真相源（测试与未来再校准共用） */
export const GATE_CONFIG = {
  seeds: [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037],
  bars: 32,
  styleId: 'random',
  // 软指标：12 种子均值的下限（≥）。键名 = analyze-repetition 输出的数据键（bars 类是 "n/32" 字符串）
  mean: { unique_chords: 8.5, interval_entropy: 2.3, melody_unique_bars: 28, lh_unique_bars: 28 },
  // 硬不变量：逐种子判定（=）
  hard: { melody_adjacent_repeat: 0, lh_adjacent_repeat: 0 },
};

/** 解析 analyze-repetition.mjs 的一行 JSON 输出；坏行返回 null（调用方计入失败，不崩） */
export function parseMetrics(line) {
  try {
    const m = JSON.parse(line);
    if (typeof m !== 'object' || m === null || !('unique_chords' in m)) return null;
    return m;
  } catch {
    return null;
  }
}

/** "31/32" → 31；非法（含空串——Number('') 是 0 这个经典坑）返回 NaN */
export function numeratorOf(fraction) {
  const raw = String(fraction ?? '').split('/')[0];
  if (!raw) return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 评估全部种子。metrics = [{seed, data|null}]（data 为 null 表示该种子运行失败）。
 * 返回 { ok, failures: [] } —— 失败条目都是可读的一句话。
 */
export function evaluateGate(results, config = GATE_CONFIG) {
  const failures = [];
  const valid = results.filter((r) => r.data);
  if (valid.length < config.seeds.length) {
    failures.push(`只有 ${valid.length}/${config.seeds.length} 个种子产出有效指标（种子失败也计入）`);
  }
  for (const { seed, data } of valid) {
    for (const [key, expect] of Object.entries(config.hard)) {
      if (data[key] !== expect) failures.push(`seed ${seed}: 硬不变量 ${key}=${data[key]}（应为 ${expect}）`);
    }
  }
  const meanOf = (key) => valid.reduce((s, r) => {
    const v = typeof r.data[key] === 'string' ? numeratorOf(r.data[key]) : Number(r.data[key]);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0) / Math.max(1, valid.length);
  const means = {};
  for (const key of Object.keys(config.mean)) {
    means[key] = meanOf(key);
    if (!(means[key] >= config.mean[key])) {
      failures.push(`均值 ${key}=${means[key].toFixed(2)} 低于门槛 ${config.mean[key]}（${valid.length} 种子）`);
    }
  }
  return { ok: failures.length === 0, failures, means };
}

function runSeed(seed) {
  const script = fileURLToPath(new URL('./analyze-repetition.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, String(config.bars), String(seed), config.styleId], {
    encoding: 'utf8', timeout: 120_000,
  });
  // analyze-repetition 输出是多行 pretty JSON——整体交给 parseMetrics（坏输出 → null → 计为失败）
  return { seed, data: parseMetrics((r.stdout ?? '').trim()) };
}

const config = GATE_CONFIG;
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = config.seeds.map(runSeed);
  const { ok, failures, means } = evaluateGate(results, config);
  console.log('种子 | chords | entropy | melody | lh | madj | ladj');
  for (const { seed, data } of results) {
    console.log(data
      ? `${seed} | ${data.unique_chords} | ${data.interval_entropy} | ${data.melody_unique_bars} | ${data.lh_unique_bars} | ${data.melody_adjacent_repeat} | ${data.lh_adjacent_repeat}`
      : `${seed} | 运行失败`);
  }
  console.log('均值 |', Object.entries(means).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '));
  if (ok) {
    console.log(`✓ 回归门全过（${config.seeds.length} 种子，门槛见 GATE_CONFIG）`);
  } else {
    console.error('✗ 回归门失败：');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
}
