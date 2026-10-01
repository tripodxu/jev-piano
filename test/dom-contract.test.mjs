// dom-contract.test.mjs — 元素 id 契约（轮次 49 新增，因为缺失这条守卫连吃三个真 bug）
//
// 背景：轮次 31 的「舞台灯光」把 CSS 和 main.js 都写好了，唯独忘了在 index.html 里放那两个
// `<div id="stageWarm/Cool">`。后果不是「灯光不亮」这么轻——main.js 的 `onBar` 会在
// **每一小节**抛 `TypeError: Cannot read properties of null (reading 'style')`。
//
// 轮次 47 给 onBar 加的「展示层异常不得炸调度循环」免疫把它兜住了，播放照常继续，
// 于是这个异常**每一小节发生、每一小节被静默吞掉**，连带让 onBar 里排在它后面的全部
// 可视化（张力 hover 元数据、唯一性读数、遍次小结、兜底归因）再也不执行。
// 免疫机制救了播放，也把病藏了起来，直到很久以后才被翻出来。
//
// 所以要有一条测试把「DOM 里有没有这个元素」变成红灯，而不是靠某个功能碰巧不工作。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/** index.html 里声明过的所有 id */
function declaredIds() {
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

/** 源码里通过 $('x') / getElementById('x') 取用的 id（不含动态拼接） */
function usedIds(src) {
  const out = new Set();
  for (const m of src.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) out.add(m[1]);
  for (const m of src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) out.add(m[1]);
  return out;
}

for (const file of ['main.js', 'studio.js']) {
  test(`${file}: 取用的每个元素 id 都能在 index.html 里找到（缺一个就是每小节一次静默异常）`, () => {
    const src = readFileSync(new URL(`../public/js/${file}`, import.meta.url), 'utf8');
    const declared = declaredIds();
    const missing = [...usedIds(src)].filter((id) => !declared.has(id)).sort();
    assert.deepEqual(missing, [], `这些 id 在 index.html 里不存在：${missing.join(', ')}`);
  });
}

test('舞台灯光层确实存在（轮次 31 缺的 DOM，轮次 49 补上）', () => {
  for (const id of ['stageWarm', 'stageCool']) {
    assert.ok(declaredIds().has(id), `${id} 必须存在——否则 onBar 每小节抛异常，后面所有可视化全被跳过`);
  }
});

