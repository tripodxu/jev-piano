# 段落可见化 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。

**Goal**：让轮次 8 引入的**段落结构在界面上可见**——功能轨、张力带、钢琴卷帘、计划卡四处都能看出 A/B/A'/Coda 的分界。

**依据**：`ui-ux-pro-max` chart 域实测命中：
> "Mark anomalies with a distinct shape and text annotation as well as color. **Do not rely on color alone.**" / "use line styles or markers in addition to color"

**因此**：段落边界一律用**独立线条样式（竖线）+ 文字标注（段落名）**表达，颜色只做辅助。四处可视化同时提供**纯文本的等价物**（计划卡的段落清单），满足 a11y 的"不依赖颜色/悬停"要求。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/ui.js` | Modify | `sectionLabel` 纯函数；`TensionGraph.setSections` 画段落竖线+标签；`pushFnSegment` 遇段落首插标记；`renderPlan` 追加段落清单 |
| `public/js/main.js` | Modify | 演奏前把 `plan.sections` 喂给两处 |
| `public/js/studio.js` | Modify | 卷帘头部画段落竖线与段落名 |
| `test/ui.test.mjs` | Modify | `sectionLabel` 与标记生成的测试 |

---

### Task 1: 段落标注的纯函数与 DOM 标记

- [ ] **Step 1: 写失败测试**（`test/ui.test.mjs`）

```js
test('sectionLabel: 段落名 + 中文说明；非法输入安全降级', () => {
  assert.equal(sectionLabel({ id: 'A', arc: 'flat', bars: 8 }), 'A');
  assert.equal(sectionLabel({ id: 'Coda', arc: 'fall', bars: 8 }), 'Coda');
  assert.equal(sectionLabel(null), '');
  assert.equal(sectionLabel({}), '');
});

test('sectionMarkerAt: 只在段落首小节返回该段落，否则 null', () => {
  const secs = [{ id: 'A', start: 0, bars: 8 }, { id: 'B', start: 8, bars: 8 }];
  assert.equal(sectionMarkerAt(secs, 0)?.id, 'A');
  assert.equal(sectionMarkerAt(secs, 7), null, '段落内不是边界');
  assert.equal(sectionMarkerAt(secs, 8)?.id, 'B', '第二段落首小节');
  assert.equal(sectionMarkerAt(null, 0), null);
  assert.equal(sectionMarkerAt([], 0), null);
});
```

- [ ] **Step 2: 运行确认失败** → `sectionLabel is not a function`

- [ ] **Step 3: 实现**

```js
/** 段落标注：段落名（A / B / A' / Coda）。可访问性的"不依赖颜色"通道——边界同时有文字。 */
export function sectionLabel(sec) {
  return sec && sec.id ? String(sec.id) : '';
}

/** 某小节是否开启新段落；是则返回该段落，否则 null */
export function sectionMarkerAt(sections, bar) {
  if (!Array.isArray(sections) || !sections.length) return null;
  return sections.find((s) => s.start === bar) ?? null;
}
```

`pushFnSegment(ribbon, bar, sections)`：当 `sectionMarkerAt(sections, bar.index)` 命中时，先 `prepend` 一个 `.fnsec` 标记元素（竖线 + 段落名），再 prepend 段落本身。

- [ ] **Step 4: 运行确认通过**

---

### Task 2: 张力带与卷帘的段落竖线

- [ ] **Step 1:** `TensionGraph.setSections(sections)` 存下，`draw()` 里在段落首小节画竖线（`strokeStyle rgba(240,205,138,.5)`，`setLineDash([2,3])`）并在顶部写段落名。
- [ ] **Step 2:** `studio.js` 的 `drawTimeline` 增加段落竖线与段落名（画在和弦名那一行之上）。
- [ ] **Step 3:** `main.js` 在 `tensionGraph.setTarget(...)` 旁边调 `tensionGraph.setSections(plan.sections)`；`pushFnSegment(els.fnRibbon, bar, plan.sections)`。
- [ ] **Step 4:** `npm test` 全绿。

---

### Task 3: 计划卡的段落清单（纯文本等价物）

- [ ] **Step 1:** `renderPlan` 追加一行：
  `A 陈述 8 小节 · B 对比 8 小节 · A' 再现 8 小节 · Coda 收束 8 小节`
  段名用 `sectionLabel`，无 sections 时整行不输出。
- [ ] **Step 2:** 加测试（`renderPlan` 依赖 DOM，只在 `ui.test.mjs` 里测 `sectionLabel` 已覆盖；输出逻辑用 aria 文本而非纯 innerHTML 拼接的类名，故再加一条"无 sections 时不产出段落行"的纯函数测试：`planLine(sections)`）。

- [ ] **Step 3:** `npm test` 全绿。

---

## 验收

- `npm test` 96 → **≥100**（只增不减）
- `node --check` 全部改动 .js
- 元素 id 契约（本轮不新增 id）
- 决策指标 12 种子**逐位不变**（纯展示层）
- 段落标注不依赖颜色：四处均有**文字**通道（计划卡清单 / 功能轨标记 / 张力带标签 / 卷帘段落名）
