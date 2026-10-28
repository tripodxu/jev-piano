// dom.js — 与业务无关的 DOM 原语（零 import，两个界面共用）。
// 抽取动机：escapeHtml 此前只住在 ui.js 里私有，download(blob, name) 在 main.js 与
// studio.js 里**逐字节重复**了两份——导出路径各写各的，改一处就会漏一处。
// 本模块是纯工具层，不认识音乐、不认识 Jev，也不持有任何状态。

/** HTML 转义：任何拼进 innerHTML 的动态文本都必须过这一道（图例/日志/徽章的唯一注入面） */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 取元素；两个界面的 `$` 助手此前各定义一次，语义完全一致 */
export function byId(id) {
  return document.getElementById(id);
}

/** 触发一次浏览器下载（Blob → 临时 URL → 点击 → 回收）。
 *  5s 后回收而不是立刻：立刻 revoke 会让部分浏览器来不及起下载。 */
export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
