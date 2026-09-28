// settings.js — 两个界面共享的设置存取（localStorage，仅存本机）。
const STORE_KEY = 'jevpiano.settings.v1';

export const DEFAULTS = {
  channel: 'fixture', typesafeKey: '', openrouterKey: '',
  llmEnabled: false, llmBaseUrl: 'https://api.openai.com/v1', llmModel: '', llmKey: '', llmProxy: false,
  styleId: 'random', keySel: 'auto', touched: false,
  legendHintOff: false,      // 用户勾了「不再自动提示图例」；顶栏的 ? 按钮始终还在
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 隐私模式等 */ }
}
