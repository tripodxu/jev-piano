// limits.test.mjs — 把 ADR-0004 的「每个文件 ≤800 行」从文档变成红灯。
//
// 为什么需要它：轮次 52 才发现 ui.js 已悄悄长到 842 行、studio.js 811 行——越线那天没有构建失败、
// 没有测试报红、没有人被告知。**一条只写在文档里的约束，如果没有东西盯着它，就只是某次会话的意图。**
// 这里盯住 public/js/ 与 src/ 的每个 .js：超限即红，附带拆法出处。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const MAX_LINES = 800;                       // ADR-0004 §理由 4
const ROOT = new URL('../', import.meta.url);
const DIRS = ['public/js/', 'src/'];

/** 总行数口径与 AGENTS.md §2 一致：文件末尾的换行不算一行（等价于 PowerShell 的 (Get-Content f).Count） */
function lineCount(url) {
  const text = readFileSync(url, 'utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

test('ADR-0004：每个源文件 ≤800 行（越线即红，别再让它悄悄长）', () => {
  const offenders = [];
  const seen = [];
  for (const dir of DIRS) {
    const base = new URL(dir, ROOT);
    for (const name of readdirSync(base)) {
      if (!name.endsWith('.js')) continue;
      const n = lineCount(new URL(name, base));
      seen.push(name);
      if (n > MAX_LINES) offenders.push(`${dir}${name} = ${n} 行`);
    }
  }
  assert.ok(seen.length >= 15, '源文件清单不该为空——路径写错时这条会先红，而不是让本测试永远通过');
  assert.deepEqual(offenders, [],
    `以下文件超过 ${MAX_LINES} 行（ADR-0004）：${offenders.join('、')}。拆法参考 docs/memory/2026-10-18-ui-module-split.md`);
});
