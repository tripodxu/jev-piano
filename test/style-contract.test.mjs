// style-contract.test.mjs — 设计系统契约（轮次 69 前端现代化重构新增）
//
// 为什么需要它：这次把 740 行单体 styles.css 拆成 public/styles/ 下 7 个分层文件，
// 并把所有裸色值/裸像素收进 tokens.css。拆分的**失败模式是静默的**——
//  · 少 link 一个文件 → 那一整层的样式消失，页面不报错、只是"看起来怪"；
//  · 变量名打错（--text-faint 写成 --text-faint2）→ var() 静默回退到初始值，不报错；
//  · 组件里又写裸色值 → 设计语言开始漂移，且没有任何东西会拦。
// 这三条与轮次 49 的「DOM id 契约」同类：靠功能碰巧不工作发现它，太晚了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { escapeHtml } from '../public/js/dom.js';

const ROOT = new URL('../', import.meta.url);
const STYLE_DIR = new URL('public/styles/', ROOT);
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const styleFiles = readdirSync(STYLE_DIR).filter((f) => f.endsWith('.css'));
const cssOf = (name) => readFileSync(new URL(name, STYLE_DIR), 'utf8');
const allCss = styleFiles.map(cssOf).join('\n');

test('index.html 引用的每个样式表都真实存在（少 link 一个 = 整层静默消失）', () => {
  const refs = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, '应当有多个分层样式表，否则本测试失去意义');
  const missing = refs.filter((href) => !existsSync(new URL(href, new URL('public/', ROOT))));
  assert.deepEqual(missing, [], `这些样式表在 index.html 里被引用但磁盘上不存在：${missing.join(', ')}`);
});

test('分层样式表全部被 index.html 引用（存在但未 link = 死文件）', () => {
  const refs = new Set([...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]));
  const orphan = styleFiles.filter((f) => !refs.has(`styles/${f}`));
  assert.deepEqual(orphan, [], `这些样式表没有被引用：${orphan.join(', ')}`);
});

test('@layer 层序只在 tokens.css 里声明一次（多处声明 = 层序随加载顺序漂移）', () => {
  const declarators = styleFiles.filter((f) => /@layer\s+tokens\s*,/.test(cssOf(f)));
  assert.deepEqual(declarators, ['tokens.css'], '层序声明必须唯一，且属于 tokens.css');
});

test('每个文件都把自己写进已声明的层（避免裸规则压过整层）', () => {
  const declared = ['tokens', 'reset', 'base', 'layout', 'components', 'stage', 'studio', 'utilities', 'motion'];
  const used = new Set([...allCss.matchAll(/@layer\s+([a-z]+)\s*\{/g)].map((m) => m[1]));
  for (const name of used) {
    assert.ok(declared.includes(name), `层名 ${name} 未在 tokens.css 的层序中声明`);
  }
});

// 允许在组件里就地定义的局部变量（不是设计令牌，是组件的临时通道）
const LOCAL_VARS = new Set(['seg-c', 'd']);

test('所有 var(--x) 引用的变量都在 tokens.css 有定义（打错变量名会静默回退，不报错）', () => {
  const tokens = cssOf('tokens.css');
  const defined = new Set([...tokens.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const offenders = new Set();
  for (const file of styleFiles) {
    if (file === 'tokens.css') continue;
    for (const m of cssOf(file).matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
      const name = m[1];
      if (!defined.has(name) && !LOCAL_VARS.has(name.slice(2))) offenders.add(`${file}: ${name}`);
    }
  }
  assert.deepEqual([...offenders].sort(), [], `这些 CSS 变量没有在 tokens.css 定义：\n${[...offenders].join('\n')}`);
});

test('组件层不写裸色值/裸字号——设计语言只能有一个出处', () => {
  // 允许例外：琴键与琴毡的写实渐变是"画出来的材质"，不是设计语言；
  //           rgba() 的透明度微调同理。这里只拦十六进制色与 px 字号。
  const ALLOWED_FILES = new Set(['stage.css']);
  const offenders = [];
  for (const file of styleFiles) {
    if (ALLOWED_FILES.has(file) || file === 'tokens.css') continue;
    const css = cssOf(file)
      .replace(/\/\*[\s\S]*?\*\//g, '');            // 去注释，注释里举例不算
    for (const m of css.matchAll(/(^|[^-a-z])color\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
      offenders.push(`${file}: color ${m[2]}`);
    }
    for (const m of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      offenders.push(`${file}: font-size ${m[1]}px`);
    }
  }
  assert.deepEqual(offenders, [], `这些裸值应改用 tokens.css 的令牌：\n${offenders.join('\n')}`);
});

test('JS 里用到的类名都在样式表里有定义（标记改了样式没改 = 静默失色）', () => {
  const jsDir = new URL('public/js/', ROOT);
  const known = new Set([...allCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const offenders = new Set();
  for (const name of readdirSync(jsDir)) {
    if (!name.endsWith('.js')) continue;
    const src = readFileSync(new URL(name, jsDir), 'utf8');
    // class="a b c" 字面量（跳过含模板插值的片段）
    for (const m of src.matchAll(/class="([^"${}]+)"/g)) {
      for (const cls of m[1].trim().split(/\s+/)) {
        if (cls && !known.has(cls)) offenders.add(`${name}: ${cls}`);
      }
    }
    // classList.add/remove/toggle('x')
    for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) {
      if (!known.has(m[1])) offenders.add(`${name}: ${m[1]}`);
    }
  }
  assert.deepEqual([...offenders].sort(), [], `这些类名在 JS 里被使用但样式表里查无此定义：\n${[...offenders].join('\n')}`);
});

test('dom.js: escapeHtml 转义五个注入字符（唯一的 HTML 注入面）', () => {
  assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

// 归零层的「媒体元素不溢出」是个好纪律，但 canvas 是例外：
// studio-roll.js 把位图按 ZOOM 算成显式像素宽（style.width = W px）交给 .rollwrap
// 自己横向滚动，一旦被 max-width:100% 夹到容器宽，位图会被缩扁，而指针换算仍是
// px / ZOOM（pick / rollPos）→ 点哪儿都点不到那个音。这条静默失败很难在冒烟里发现
// （画面「还能看」，只是窄了一点、点不中），所以用测试钉住。
test('归零层不得给 canvas 施加 max-width（卷帘位图会被缩扁、指针换算失准）', () => {
  const css = cssOf('base.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const offenders = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = m;
    if (/\bcanvas\b/.test(selector) && /max-width\s*:/.test(body)) offenders.push(selector.trim());
  }
  assert.deepEqual(offenders, [], `这些规则用 max-width 约束了 canvas，卷帘/指针会错位：\n${offenders.join('\n')}`);
});

test('可访问性基座：跳转链接、sr-only、reduced-motion 三件事都在 CSS 里', () => {
  assert.match(allCss, /\.skip-link/, '缺少跳转链接样式（键盘用户跳不过顶栏）');
  assert.match(allCss, /\.sr-only/, '缺少屏幕阅读器专用文本类');
  assert.match(allCss, /prefers-reduced-motion:\s*reduce/, '缺少动效豁免');
  assert.match(allCss, /prefers-contrast:\s*more/, '缺少高对比度偏好适配');
});
