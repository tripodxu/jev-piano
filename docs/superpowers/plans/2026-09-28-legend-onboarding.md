# 图例与首用引导 Implementation Plan

> **执行方式**：本会话内联执行（用户明确要求不使用子代理）。
> **skill**：`impeccable/onboard`

**Goal**：界面上的标记已经很多（功能轨四色 + 手法字 + 断路器刻线/缺口 + 段落虚线 + 动机卡 + 张力带 + 契合度带 + 非和弦亮边），但**用户看不懂它们意味着什么**。本轮不新增标记，只让已有标记可读。

**依据**：`impeccable/onboard` 的硬约束
- **Context Over Ceremony**：在使用现场教，不一上来倾倒
- **NEVER overwhelm with information upfront（progressive disclosure）**
- **Don't show same onboarding twice — track completion and respect dismissals**
- **尊重用户智力**：不居高临下，不啰嗦

因此**不做**首访弹窗、**不做**新手教程模式，只做：可选的「?」抽屉 + 行内图例 + 记住已关闭。

---

## 1. 设计

### ① 图例抽屉（可选、可记忆）
顶栏加一个「?」图标按钮，打开一个抽屉，把**每一个标记**列出来：色块/形状 + 名称 + 一句话含义。

- **不进内容流**：不影响演奏，不遮挡画布
- **不阻塞**：永远可以打开，随时可关
- **记住**：关闭状态存 localStorage（`settings.legendSeen`），但「?」按钮**永不消失**——关掉只是不再自动提示
- 内容是**数据**驱动的（`LEGEND_ITEMS`），保证与真实标记同源

### ② 使用现场的图例
功能轨下方已有 `主/下属/属/色彩` 图例行，**就地补上**发展手法与断路器的说明——`onboard` 说「teach when users need them, not upfront」，行内图例就是「现场」。

### ③ 工作室空状态补「为什么值得」
卷帘空状态已有「会出现什么 + 怎么开始」，补上「为什么值得」——`onboard` 的空状态三要素。

### ④ 收紧工作室的提示文字
`.hint` 是一整段墙文，违反「不啰嗦」。拆成短句。

---

## 2. 为什么不加新的可视化

本轮最容易走的弯路是「再加一个可视化来解释可视化」。**标记已经够多了**——缺的是**读法**，不是**数量**。

---

## 3. File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `public/js/ui.js` | Modify | `LEGEND_ITEMS`（图例数据）+ `renderLegend`（纯函数） |
| `public/index.html` | Modify | 「?」按钮 + 抽屉容器 + 轨道行内图例条目 + 卷帘空状态 |
| `public/js/main.js` | Modify | 抽屉开合 + 「不再提示」记忆 |
| `public/styles.css` | Modify | 抽屉与行内图例样式 |
| `public/js/settings.js` | Modify | `legendSeen` 默认值 |
| `test/ui.test.mjs` | Modify | 图例数据完整性（图例不能与真实标记脱节） |

---

## 4. Task

### Task 1: 图例数据（TDD）
- [ ] **Step 1: 写失败测试**

```js
test('LEGEND_ITEMS: 每一条都有名字与说明，且覆盖所有真实标记', () => {
  assert.ok(Array.isArray(LEGEND_ITEMS) && LEGEND_ITEMS.length >= 8, `条目太少：${LEGEND_ITEMS?.length}`);
  for (const it of LEGEND_ITEMS) {
    assert.ok(it.label && it.desc, `缺 label/desc：${JSON.stringify(it)}`);
    assert.ok(it.group, '每条要归组');
  }
  // 覆盖面：四功能 + 五手法 + 断路器 + 段落 + 动机 + 张力 + 契合度 + 非和弦
  const text = LEGEND_ITEMS.map((i) => `${i.label}${i.desc}`).join('');
  for (const kw of ['主', '下属', '属', '色彩', '承', '模', '倒', '装', '断路', '驳回', '段落', '动机', '张力', '契合', '非和弦']) {
    assert.ok(text.includes(kw), `图例缺少「${kw}」的说明`);
  }
});

test('renderLegend: 输出纯文本结构，不含未转义的 HTML 注入面', () => {
  const out = renderLegend(LEGEND_ITEMS);
  assert.ok(out.includes('主'), '应含条目文字');
  assert.ok(!/<script/i.test(out), '不得含 script');
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** `LEGEND_ITEMS` 与 `renderLegend`（返回 HTML 字符串，label/desc 走 `escapeHtml`）
- [ ] **Step 4: 运行确认通过**

### Task 2: 接线
- [ ] **Step 1:** `index.html`：顶栏「?」按钮 + `<aside id="legendDrawer">`；轨道行内图例补手法/断路器条目；卷帘空状态补「为什么值得」
- [ ] **Step 2:** `settings.js` 加 `legendSeen: false`
- [ ] **Step 3:** `main.js` 开合逻辑 + 关闭记忆；`ui.js` 导出 `renderLegend`
- [ ] **Step 4:** `styles.css` 抽屉样式（沿用既有 `.drawer` 制度，不引入新形状语言）
- [ ] **Step 5:** 收紧 `.hint` 文案

### Task 3: 验证
- [ ] **Step 1:** `npm test` ≥120
- [ ] **Step 2:** `node --check`
- [ ] **Step 3:** 元素 id 契约
- [ ] **Step 4:** 决策指标 12 种子**逐位不变**（纯展示层）
- [ ] **Step 5:** 同步 `AGENTS.md` / `MEMORY.md` / `README.md`

---

## 5. 自检
- **规格覆盖**：抽屉 → Task 1/2；行内图例 → Task 2；空状态 → Task 2；收紧文案 → Task 2；验证 → Task 3
- **占位符扫描**：无 TBD/TODO
- **类型一致性**：`LEGEND_ITEMS: {group, label, desc, swatch?}[]`；`renderLegend(items) → string`
