// main.js — 接线：事件、设置(localStorage)、渠道探测、开始/停止/导出。
import { buildPlan, Composer } from './composer.js';
import { Player } from './player.js';
import { getAudio } from './audio.js';
import { loadSettings, saveSettings as persistSettings } from './settings.js';
import { ensureStudio, stopStudio } from './studio.js';
import { exportMidi } from './midi.js';
import { askJev, expandPlan, probeProxy } from './jev.js';
import { renderKeyboard, Fall, TensionGraph, addDecision, pushFnSegment, renderPlan, setStatus, toast } from './ui.js';
import { barTension, targetSeries, smooth, tensionStats } from './tension.js';

const $ = (id) => document.getElementById(id);
const els = {
  prompt: $('prompt'), directorNote: $('directorNote'), styleChips: $('styleChips'), goal: $('goal'), barsSelect: $('barsSelect'),
  keySelect: $('keySelect'),
  bpmAuto: $('bpmAuto'), bpmRange: $('bpmRange'), bpmVal: $('bpmVal'),
  playBtn: $('playBtn'), pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'), newBtn: $('newBtn'), midiBtn: $('midiBtn'), recBtn: $('recBtn'),
  planCard: $('planCard'), nowChord: $('nowChord'), nowBar: $('nowBar'),
  fallCanvas: $('fallCanvas'), keyboard: $('keyboard'), decisionLog: $('decisionLog'),
  fnRibbon: $('fnRibbon'), logEmpty: $('logEmpty'),
  tensionCanvas: $('tensionCanvas'), tensionStat: $('tensionStat'),
  stChannel: $('stChannel'), stTokens: $('stTokens'), stCost: $('stCost'), stLatency: $('stLatency'),
  settingsBtn: $('settingsBtn'), settingsDrawer: $('settingsDrawer'), settingsClose: $('settingsClose'),
  tabLive: $('tabLive'), tabStudio: $('tabStudio'), viewLive: $('viewLive'), viewStudio: $('viewStudio'),
  channelSel: $('channelSel'), typesafeKey: $('typesafeKey'), openrouterKey: $('openrouterKey'), testJevBtn: $('testJevBtn'),
  llmEnabled: $('llmEnabled'), llmBaseUrl: $('llmBaseUrl'), llmModel: $('llmModel'), llmKey: $('llmKey'), llmProxy: $('llmProxy'), testLlmBtn: $('testLlmBtn'),
  toast: $('toast'),
};

/* ---------------- 设置持久化 ---------------- */
let settings = loadSettings();
const saveSettings = () => persistSettings(settings);

const CHANNEL_LABEL = { fixture: '离线随机', proxy: '同源代理', typesafe: 'TypeSafe', openrouter: 'OpenRouter' };
const stats = { tokens: 0, usd: 0, latencySum: 0, latencyN: 0 };
const refreshStatus = (extraFixture) => {
  const label = CHANNEL_LABEL[settings.channel] ?? settings.channel;
  setStatus({ channel: els.stChannel, tokens: els.stTokens, cost: els.stCost, latency: els.stLatency }, {
    channel: label + (extraFixture ? ' ·兜底' : ''),
    tokens: stats.tokens,
    cost: stats.usd,
    latency: stats.latencyN ? stats.latencySum / stats.latencyN : null,
  });
};

/* ---------------- 控件绑定 ---------------- */
const storeKeyOf = (id) => (id === 'channelSel' ? 'channel' : id === 'keySelect' ? 'keySel' : id);
for (const input of [els.channelSel, els.keySelect, els.typesafeKey, els.openrouterKey, els.llmEnabled, els.llmBaseUrl, els.llmModel, els.llmKey, els.llmProxy]) {
  const prop = input.type === 'checkbox' ? 'checked' : 'value';
  input[prop] = settings[storeKeyOf(input.id)] ?? '';
  // 文本框用 input 事件（程序化填充不触发 change）；select/checkbox 用 change
  const evName = input.tagName === 'INPUT' && ['text', 'password'].includes(input.type) ? 'input' : 'change';
  input.addEventListener(evName, () => {
    settings[storeKeyOf(input.id)] = input[prop];
    settings.touched = true;
    saveSettings();
    refreshStatus();
  });
}
els.channelSel.value = settings.channel;

els.settingsBtn.addEventListener('click', () => els.settingsDrawer.classList.remove('hidden'));
els.settingsClose.addEventListener('click', () => els.settingsDrawer.classList.add('hidden'));
els.styleChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  for (const c of els.styleChips.children) c.classList.toggle('sel', c === chip);
  settings.styleId = chip.dataset.style;
  settings.touched = true;
  saveSettings();
});
for (const c of els.styleChips.children) c.classList.toggle('sel', c.dataset.style === settings.styleId);

els.bpmAuto.addEventListener('change', () => {
  els.bpmRange.disabled = els.bpmAuto.checked;
  els.bpmVal.textContent = els.bpmAuto.checked ? '自动' : `${els.bpmRange.value}`;
});
els.bpmRange.addEventListener('input', () => { if (!els.bpmAuto.checked) els.bpmVal.textContent = `${els.bpmRange.value}`; });

/* ---------------- 音频与可视化 ---------------- */
const audio = getAudio();
const kb = renderKeyboard(els.keyboard);
const fall = new Fall(els.fallCanvas, () => audio.ctx?.currentTime ?? 0);
const tensionGraph = new TensionGraph(els.tensionCanvas);

/* ---------------- 播放控制 ---------------- */
let player = null;
let plan = null;
let recording = null;

function setButtons(playing) {
  els.playBtn.disabled = playing;
  els.pauseBtn.disabled = !playing;
  els.stopBtn.disabled = !playing;
  els.newBtn.disabled = playing;
  els.midiBtn.disabled = playing || !player?.records?.length;
  els.recBtn.disabled = playing;
  els.prompt.disabled = playing;
  els.goal.disabled = playing;
  els.barsSelect.disabled = playing;
  els.keySelect.disabled = playing;
  if (!playing) els.pauseBtn.querySelector('span').textContent = '暂停';
}

async function start() {
  if (player) { player.stop(); player = null; }
  try {
    await audio.ensure();
  } catch (e) {
    toast(els.toast, '无法启动音频：' + e.message);
    return;
  }
  audio.setVolume(0.9);
  els.decisionLog.innerHTML = '';
  els.fnRibbon.innerHTML = '';
  els.logEmpty.classList.remove('hidden');
  tensionGraph.reset();
  tensionGraph.setTarget([]);
  els.tensionStat.textContent = '';
  els.playBtn.disabled = true;
  els.playBtn.textContent = '… 编曲中';

  const seed = Math.floor(Math.random() * 2 ** 31);
  plan = await buildPlan({
    prompt: els.prompt.value.trim() || '一段安静的即兴',
    goal: els.goal.value,
    styleId: settings.styleId || 'random',
    seed,
    bars: Number(els.barsSelect.value),
    keyPc: settings.keySel && settings.keySel !== 'auto' ? Number(settings.keySel) : null,
  }, {
    llm: settings.llmEnabled ? {
      enabled: true, baseUrl: settings.llmBaseUrl, model: settings.llmModel,
      apiKey: settings.llmKey, proxy: settings.llmProxy,
    } : { enabled: false },
  });
  renderPlan(els.planCard, plan);
  if (!settings.llmEnabled) els.planCard.querySelector('.badge')?.classList.add('dim');
  // 张力对照带：计划弧线在演奏前就位，实际张力随小节逐条长出来
  tensionGraph.setTarget(smooth(targetSeries(plan, plan.barsPerPhrase), 3));
  tensionGraph.reset();

  const composer = new Composer(plan, {
    channel: settings.channel,
    apiKey: settings.channel === 'typesafe' ? settings.typesafeKey : settings.openrouterKey,
  });
  composer.directorNote = els.directorNote.value.trim();
  const bpm = els.bpmAuto.checked ? plan.bpm : Number(els.bpmRange.value);
  player = new Player({
    audio, composer, bpm,
    onBar(bar) {
      els.nowChord.textContent = bar.chord.symbol;
      els.nowBar.textContent = `第 ${bar.index + 1} 小节 ${bar.label} · 强度 ${bar.intensity.toFixed(1)}${bar.loop > 0 ? `，第 ${bar.loop + 1} 遍` : ''}`;
      addDecision(els.decisionLog, bar);
      pushFnSegment(els.fnRibbon, bar);
      els.logEmpty.classList.add('hidden');
      // 张力对照带：逐小节长出实际张力，并给出可读读数
      tensionGraph.push(barTension(bar));
      const st = tensionStats(tensionGraph.actual);
      els.tensionStat.textContent = tensionGraph.actual.length
        ? `${st.mean.toFixed(2)} 均值 · ${st.min.toFixed(2)}–${st.max.toFixed(2)} 跨度 ${st.span.toFixed(2)}`
        : '';
      if (!bar.decision.fixture) {
        stats.tokens += bar.decision.inputTokens;
        stats.usd += bar.decision.usd;
        if (bar.decision.ms > 0) { stats.latencySum += bar.decision.ms; stats.latencyN++; }
      }
      refreshStatus(bar.decision.fixture && settings.channel !== 'fixture');
    },
    onNote(ev) {
      const delay = Math.max(0, (ev.t - audio.ctx.currentTime) * 1000);
      setTimeout(() => kb.flash(ev.midi, ev.dur * 1000), delay);
      fall.push({ midi: ev.midi, t: ev.t, dur: ev.dur, vel: ev.vel, hand: ev.hand });
    },
    onError(err) {
      toast(els.toast, '演奏中断：' + err.message);
      stopAll();
    },
  });
  fall.start();
  tensionGraph.start();
  player.start();
  els.playBtn.textContent = '▶ 开始演奏';
  setButtons(true);
}

function stopAll() {
  player?.stop();
  fall.stop();
  tensionGraph.stop();
  kb.clear();
  if (recording) { recording.stop().then((blob) => download(blob, `${plan?.title ?? 'jev-piano'}.webm`)); recording = null; els.recBtn.textContent = '● 录音'; }
  setButtons(false); // player 保留引用：已演奏的 records 仍可导出 MIDI
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

els.playBtn.addEventListener('click', start);
els.stopBtn.addEventListener('click', stopAll);
els.newBtn.addEventListener('click', start); // 换一版 = 新 seed 重排并立即演奏
els.pauseBtn.addEventListener('click', () => {
  if (!player) return;
  const on = !player.paused;
  player.pause(on);
  els.pauseBtn.querySelector('span').textContent = on ? '继续' : '暂停';
});
els.directorNote.addEventListener('input', () => {
  if (player?.composer) player.composer.directorNote = els.directorNote.value.trim();
});
els.midiBtn.addEventListener('click', () => {
  if (!player?.records?.length) return;
  const bytes = exportMidi(player.records, { bpm: plan.bpm, meterNum: plan.meterNum });
  download(new Blob([bytes], { type: 'audio/midi' }), `${plan.title}.mid`);
});
els.recBtn.addEventListener('click', async () => {
  if (recording) {
    const rec = recording; recording = null;
    els.recBtn.textContent = '● 录音';
    const blob = await rec.stop();
    download(blob, `${plan?.title ?? 'jev-piano'}.webm`);
    toast(els.toast, '录音已保存');
  } else {
    await audio.ensure();
    recording = audio.startRec();
    if (!recording) { toast(els.toast, '当前浏览器不支持录音'); return; }
    els.recBtn.textContent = '■ 停止录音';
  }
});

/* ---------------- 测试按钮 ---------------- */
els.testJevBtn.addEventListener('click', async () => {
  const t0 = performance.now();
  try {
    const out = await askJev(
      { state: { ping: 1 }, questions: { ok: { type: 'noul', instructions: 'Is this a connectivity test?', criteria: { true: 'yes', false: 'no' } } } },
      { channel: settings.channel, apiKey: settings.channel === 'typesafe' ? settings.typesafeKey : settings.openrouterKey },
    );
    toast(els.toast, `Jev 连通 ✓ ${Math.round(performance.now() - t0)}ms · 渠道 ${CHANNEL_LABEL[settings.channel]}${out.fixture ? '（离线随机无网络请求）' : ''}`);
  } catch (e) {
    toast(els.toast, `Jev 失败：${e.message}`);
  }
});
els.testLlmBtn.addEventListener('click', async () => {
  const out = await expandPlan('连接测试', {}, {
    baseUrl: settings.llmBaseUrl, model: settings.llmModel, apiKey: settings.llmKey, proxy: settings.llmProxy,
  });
  toast(els.toast, out ? `LLM 连通 ✓ 返回了字段：${Object.keys(out).join(', ')}` : 'LLM 未连通：请检查 Base URL / 模型 / Key');
});

/* ---------------- 视图切换 ---------------- */
function showView(v) {
  // .view 基类 display:none，.active 才显示；hidden 只是保险
  els.viewLive.classList.toggle('active', v === 'live');
  els.viewStudio.classList.toggle('active', v === 'studio');
  els.viewLive.classList.toggle('hidden', v !== 'live');
  els.viewStudio.classList.toggle('hidden', v !== 'studio');
  els.tabLive.classList.toggle('sel', v === 'live');
  els.tabStudio.classList.toggle('sel', v === 'studio');
  if (v === 'studio') { stopAll(); ensureStudio(); }
  else stopStudio();
}
els.tabLive.addEventListener('click', () => showView('live'));
els.tabStudio.addEventListener('click', () => showView('studio'));

/* ---------------- 启动 ---------------- */
window.__jevDebug = () => ({
  ctxState: audio.ctx?.state ?? 'no-ctx',
  ctxTime: audio.ctx?.currentTime ?? -1,
  running: player?.running ?? false,
  queued: player?.queue.length ?? -1,
  marks: player?.barMarks.length ?? -1,
  deciding: player?.deciding ?? false,
  recorded: player?.records.length ?? -1,
  fallNotes: fall.notes.length,
  fallErrs: globalThis.__fallErrs ?? [],
});
(async () => {
  refreshStatus();
  const probe = await probeProxy();
  if (probe?.ok) {
    if (!settings.touched && settings.channel === 'fixture' && (probe.jev || probe.llm)) {
      settings.channel = 'proxy';
      els.channelSel.value = 'proxy';
      saveSettings();
    }
    refreshStatus();
    toast(els.toast, `检测到同源代理：Jev=${probe.jev ?? '无'} · LLM=${probe.llm ? '已配置' : '未配置'}`);
  }
})();
