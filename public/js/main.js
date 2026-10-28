// main.js — 接线：事件、设置(localStorage)、渠道探测、开始/停止/导出。
import { buildPlan, Composer } from './composer.js';
import { Player } from './player.js';
import { getAudio } from './audio.js';
import { loadSettings, saveSettings as persistSettings } from './settings.js';
import { ensureStudio, stopStudio } from './studio.js';
import { exportMidi } from './midi.js';
import { askJev, expandPlan, probeProxy } from './jev.js';
import { Fall, TensionGraph, MotifCard, addDecision, pushFnSegment, renderPlan, toast, LEGEND_ITEMS, renderLegend, uniquenessLine, stageLightFor, chorusSummary, styleChipTitle, goalTitle, CHANNEL_LABEL, KEY_FIELD_RULES, emptyLedger, accumulateLedger, refreshStatusPills, attachPlayableKeyboard } from './ui.js';
import { STYLE_BY_ID, chordPcs } from './music.js';
import { downloadBlob } from './dom.js';
import { GOAL_HINTS } from './composer.js';
import { barTension, smooth, tensionStats } from './tension.js';
import { barHarmonyFit, NCT_ZH } from './nct.js';
import { planTargetSeries, tempoMultAt } from './candidates.js';
import { cadenceIntoBar, CADENCE_ZH } from './cadence.js';

const $ = (id) => document.getElementById(id);
const els = {
  prompt: $('prompt'), directorNote: $('directorNote'), styleChips: $('styleChips'), goal: $('goal'), barsSelect: $('barsSelect'),
  keySelect: $('keySelect'),
  bpmAuto: $('bpmAuto'), bpmRange: $('bpmRange'), bpmVal: $('bpmVal'),
  playBtn: $('playBtn'), pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'), newBtn: $('newBtn'), midiBtn: $('midiBtn'), recBtn: $('recBtn'),
  planCard: $('planCard'), nowChord: $('nowChord'), nowBar: $('nowBar'),
  fallCanvas: $('fallCanvas'), keyboard: $('keyboard'), kbEcho: $('kbEcho'), decisionLog: $('decisionLog'),
  fnRibbon: $('fnRibbon'), logEmpty: $('logEmpty'),
  tensionCanvas: $('tensionCanvas'), tensionStat: $('tensionStat'),
  motifCanvas: $('motifCanvas'), repStat: $('repStat'), stageWarm: $('stageWarm'), stageCool: $('stageCool'), stage: $('stage'),
  stChannel: $('stChannel'), stTokens: $('stTokens'), stCost: $('stCost'), stLatency: $('stLatency'),
  settingsBtn: $('settingsBtn'), settingsDrawer: $('settingsDrawer'), settingsClose: $('settingsClose'),
  legendBtn: $('legendBtn'), legendDrawer: $('legendDrawer'), legendClose: $('legendClose'),
  legendBody: $('legendBody'), legendMore: $('legendMore'), legendNoHint: $('legendNoHint'),
  tabLive: $('tabLive'), tabStudio: $('tabStudio'), viewLive: $('viewLive'), viewStudio: $('viewStudio'),
  channelSel: $('channelSel'), typesafeKey: $('typesafeKey'), openrouterKey: $('openrouterKey'), testJevBtn: $('testJevBtn'),
  keyFieldNote: $('keyFieldNote'),
  typesafeKeyLbl: document.querySelector('label[for="typesafeKey"]'),
  openrouterKeyLbl: document.querySelector('label[for="openrouterKey"]'),
  llmEnabled: $('llmEnabled'), llmBaseUrl: $('llmBaseUrl'), llmModel: $('llmModel'), llmKey: $('llmKey'), llmProxy: $('llmProxy'), testLlmBtn: $('testLlmBtn'),
  toast: $('toast'),
};

/* ---------------- 设置持久化 ---------------- */
let settings = loadSettings();
const saveSettings = () => persistSettings(settings);

// 计费台账与渠道名都走 ui.js 的共享实现（轮次 50）——工作室与实时界面必须同一口径，
// 否则共用同一排 pill 却各记各的账（工作室此前完全不记账）
let stats = emptyLedger();
// 兜底告知只发一次：恢复真实渠道后复位，再断还会提示（自愈是设计，用户该知道它发生过）。
// 两种兜底的成因完全不同，必须分开说——「渠道坏了」和「渠道跟不上速度」不是一回事：
// 前者是故障（轮次 41），后者是设计在主动保住节奏（轮次 48）。
let fallbackAnnounced = false;   // 渠道不可用（429/502/断网/CORS/无 key）
let slowAnnounced = false;       // 渠道跟不上：决策超过本小节的音频预算
const statusPills = () => ({ channel: els.stChannel, tokens: els.stTokens, cost: els.stCost, latency: els.stLatency });
const refreshStatus = (fallback) => { // fallback: null | 'down' | 'slow'
  const label = CHANNEL_LABEL[settings.channel] ?? settings.channel;
  const suffix = fallback === 'slow' ? ' ·跟不上' : fallback ? ' ·兜底' : '';
  refreshStatusPills(statusPills(), { channel: label, ledger: stats, suffix });
};

/* ---------------- 控件绑定 ---------------- */
// 当前渠道不读取的 Key 字段置灰并说明原因（轮次 70）：填了不被读的值是最坏的一类交互——
// 它既不报错也不生效。置灰 + 一行说明，把"为什么我瞎写 key 也能用"在发生前就回答掉。
function syncKeyFields() {
  const rule = KEY_FIELD_RULES[settings.channel] ?? KEY_FIELD_RULES.fixture;
  for (const [input, lbl] of [[els.typesafeKey, els.typesafeKeyLbl], [els.openrouterKey, els.openrouterKeyLbl]]) {
    const on = rule[input === els.typesafeKey ? 'typesafe' : 'openrouter'];
    input.disabled = !on;
    lbl?.classList.toggle('off', !on);
  }
  if (els.keyFieldNote) els.keyFieldNote.textContent = rule.note;
}

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
    if (input === els.channelSel) syncKeyFields(); // 换渠道 = 换哪个 Key 生效
    refreshStatus();
  });
}
els.channelSel.value = settings.channel;
syncKeyFields();

// 抽屉的焦点管理：打开移入关闭钮、Esc 关闭、关闭后焦点回到触发钮——键盘用户不被丢在页首
function wireDrawer({ btn, drawer, close }) {
  const open = () => {
    drawer.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    close.focus();
  };
  const shut = () => {
    drawer.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  };
  btn.addEventListener('click', () => (drawer.classList.contains('hidden') ? open() : shut()));
  close.addEventListener('click', shut);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.classList.contains('hidden')) shut();
  });
  return { open, shut };
}
const legendDrawerCtl = wireDrawer({ btn: els.legendBtn, drawer: els.legendDrawer, close: els.legendClose });
wireDrawer({ btn: els.settingsBtn, drawer: els.settingsDrawer, close: els.settingsClose });

/* ---------------- 图例：可选、可重开、关闭被记住（impeccable/onboard） ---------------- */
// 一进来就弹窗 = 一上来倾倒信息。这里只在用户没勾过「不再提示」且从未演奏时轻点一下。
(function initLegend() {
  els.legendBody.innerHTML = renderLegend(LEGEND_ITEMS);
  const open = legendDrawerCtl.open;
  const close = legendDrawerCtl.shut;
  els.legendMore.addEventListener('click', open);
  els.legendClose.addEventListener('click', close);
  els.legendNoHint.addEventListener('change', () => {
    settings.legendHintOff = els.legendNoHint.checked;
    settings.touched = true;
    saveSettings();
  });
  els.legendNoHint.checked = !!settings.legendHintOff;
  if (!settings.legendHintOff) {
    // 首用轻提示：只在轨道图例旁，不遮挡任何演奏界面
    els.legendMore.classList.add('nudge');
    els.legendMore.addEventListener('click', () => els.legendMore.classList.remove('nudge'), { once: true });
  }
})();
els.settingsClose.addEventListener('click', () => els.settingsDrawer.classList.add('hidden'));
/** 选中某个曲风 chip：视觉态、aria-checked、roving tabindex 三件事必须一起动——
 *  少同步任何一个，屏幕阅读器与键盘用户看到的就是另一个界面。 */
function selectChip(chip) {
  for (const c of els.styleChips.children) {
    const on = c === chip;
    c.classList.toggle('sel', on);
    c.setAttribute('aria-checked', on ? 'true' : 'false'); // radiogroup 的 radio 语义要与视觉选中态同步
    c.tabIndex = on ? 0 : -1;                              // 单个 Tab 停点
  }
  settings.styleId = chip.dataset.style;
  settings.touched = true;
  saveSettings();
}
els.styleChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) selectChip(chip);
});
/* 曲风 chips 的键盘导航（补齐 role="radiogroup" 的应有行为）：
   方向键在组内移动并选中、Home/End 跳首尾。默认每个按钮都能 Tab，
   而正确的 radiogroup 是**一个 Tab 停点 + 方向键切换**——10 个 chip 不该吃掉 10 次 Tab。 */
els.styleChips.addEventListener('keydown', (e) => {
  const chips = [...els.styleChips.children];
  const i = chips.indexOf(document.activeElement);
  if (i < 0) return;
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  const next = step ? (i + step + chips.length) % chips.length
    : e.key === 'Home' ? 0
      : e.key === 'End' ? chips.length - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  selectChip(chips[next]);
  chips[next].focus();
});
for (const c of els.styleChips.children) {
  const on = c.dataset.style === settings.styleId;
  c.classList.toggle('sel', on);
  c.tabIndex = on ? 0 : -1;
  // 信息前置（轮次 44）：领域描述与速度区间在选择那一刻可见
  const st = STYLE_BY_ID[c.dataset.style];
  if (st) c.title = styleChipTitle(st);
}
for (const opt of els.goal.options) opt.title = goalTitle(GOAL_HINTS[opt.value]);

els.bpmAuto.addEventListener('change', () => {
  els.bpmRange.disabled = els.bpmAuto.checked;
  els.bpmVal.textContent = els.bpmAuto.checked ? '自动' : `${els.bpmRange.value}`;
});
els.bpmRange.addEventListener('input', () => { if (!els.bpmAuto.checked) els.bpmVal.textContent = `${els.bpmRange.value}`; });

/* ---------------- 音频与可视化 ---------------- */
const audio = getAudio();
// 点击琴键试听：点击本身是用户手势，ensure() 合法；未开演也能摸一摸这件乐器。
// 跟弹回声（轮次 55）：演奏中有和声上下文时，告诉用户这个音在当前和弦里是什么角色——
// 键盘从「试听」变成「跟弹学习乐器」，弹错音也能听见偏了多远。
// 可弹奏键盘（轮次 69 抽成 ui.js 的共享实现）：琴键点击与电脑键盘同路——
// 回声、跟弹下落、发声一条路，两个入口不各有各的账。
// enabled 是**必填**守卫：两个界面的监听器都常驻 window，不查视图会双触发（双发声，轮次 68）
const kb = attachPlayableKeyboard(els.keyboard, {
  echoEl: els.kbEcho,
  chordOf: () => lastChord,
  onNote: (midi) => {
    // 跟弹可视化（轮次 56）：演奏中你弹的音以紫色亮边落在击键线上——AI 的音符向下落，你的音符原地亮起
    if (player?.running && audio.ctx) fall.push({ midi, t: audio.ctx.currentTime + 0.01, dur: 0.45, vel: 0.8, user: true });
  },
  enabled: () => !els.viewStudio.classList.contains('active'),
});
const fall = new Fall(els.fallCanvas, () => audio.ctx?.currentTime ?? 0);
const tensionGraph = new TensionGraph(els.tensionCanvas);
const motifCard = new MotifCard(els.motifCanvas);
// 唯一性读数（轮次 27）：与 composer 同口径的字面指纹（onset×4:midi），逐小节更新
const sigOfNotes = (ns) => ns.map((n) => `${Math.round(n.startBeats * 4)}:${n.midi}`).join(',');
const seenMel = new Set(), seenLh = new Set();
let chorusChords = new Set(); // 本遍用过的和弦（曲终小结用）
let chorusStartUsd = 0, chorusStartTokens = 0, chorusStartMel = 0, chorusStartLh = 0;
// 跟弹回声与终止式（轮次 55）：lastChord 是键盘试听的和声上下文（onBar 更新）；
// chorusBarChords 是本遍每小节的 { rootPc, fn }——终止式识别的输入，曲终清空
let lastChord = null;
let chorusBarChords = [];

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
  tensionGraph.setSections([]);
  motifCard.reset();
  els.tensionStat.textContent = '';
  els.repStat.textContent = '';
  seenMel.clear(); seenLh.clear();
  lastChord = null; chorusBarChords = [];
  chorusChords = new Set(); chorusStartUsd = 0; chorusStartTokens = 0; chorusStartMel = 0; chorusStartLh = 0;
  els.playBtn.disabled = true;
  els.playBtn.textContent = '… 编曲中';

  const seed = Math.floor(Math.random() * 2 ** 31);
  // 轮次 62：buildPlan 是启动路径上唯一的外部 await（LLM 端点/计划装配），失败必须把按钮
  // 还给学生——旧实现先禁用 playBtn 再裸奔这个 await，异常路径让「… 编曲中」挂到刷新为止。
  try {
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
  } catch (e) {
    els.playBtn.disabled = false;
    els.playBtn.textContent = '▶ 开始演奏';
    toast(els.toast, '编曲失败：' + (e?.message ?? e));
    return;
  }
  renderPlan(els.planCard, plan);
  if (!settings.llmEnabled) els.planCard.querySelector('.badge')?.classList.add('dim');
  // 张力对照带：计划弧线在演奏前就位，实际张力随小节逐条长出来
  tensionGraph.setTarget(smooth(planTargetSeries(plan, plan.barsPerPhrase), 3));
  tensionGraph.setSections(plan.sections);
  tensionGraph.setTotalBars(plan.totalBars); // 双遍对照：第二遍起，上一遍曲线作为幽灵留在原地
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
      // 跟弹回声与终止式的输入（轮次 55）：最近和弦即试听上下文；终止式只认乐句末
      lastChord = { symbol: bar.chord.symbol, rootPc: bar.chord.rootPc, shape: bar.chord.shape };
      kb.mark(chordPcs(bar.chord.rootPc, bar.chord.shape)); // 和弦键亮起（轮次 57）：跟着亮键弹就在和声里
      chorusBarChords.push({ rootPc: bar.chord.rootPc, fn: bar.decision.chordFn });
      const cad = cadenceIntoBar(chorusBarChords, plan.meterNum, plan.barsPerPhrase, bar.index % plan.totalBars);
      // 实际速度 = 基速 × 该小节乘数：Coda 渐慢时这个数字当着用户的面掉下去
      const barSpeed = Math.round((60 / player.secPerBeat) * tempoMultAt(plan, bar.index));
      els.nowBar.textContent = `第 ${bar.index + 1} 小节 ${bar.label} · 强度 ${bar.intensity.toFixed(1)} · 速度 ${barSpeed}${cad ? ` · ${CADENCE_ZH[cad]}` : ''}${bar.loop > 0 ? `，第 ${bar.loop + 1} 遍` : ''}`;
      addDecision(els.decisionLog, bar);
      // 动机卡：第 2 小节是动机诞生点；此后每次「承袭」计一次
      if (bar.index === 1) motifCard.setMotif(bar.notes.filter((n) => n.hand === 'R').map((n) => n.midi));
      else if (bar.decision.develop === 'repeat' && motifCard.midis.length) motifCard.markRestatement();
      pushFnSegment(els.fnRibbon, bar, plan.sections);
      els.logEmpty.classList.add('hidden');
      // 张力对照带：逐小节长出实际张力，并给出可读读数
      const tension = barTension(bar);
      tensionGraph.push(tension);
      // 舞台灯光随张力呼吸（纯氛围层，信息仍有文字/形状通道）
      const light = stageLightFor(tension);
      els.stageWarm.style.opacity = light.warm;
      els.stageCool.style.opacity = light.cool;
      // hover 读数的元数据：当前小节的和弦与实际速度
      tensionGraph.pushMeta({ chord: bar.chord.symbol, speed: barSpeed });
      const st = tensionStats(tensionGraph.actual);
      const fit = barHarmonyFit(bar).fit;
      els.tensionStat.textContent = tensionGraph.actual.length
        ? `${st.mean.toFixed(2)} 均值 · ${st.min.toFixed(2)}–${st.max.toFixed(2)} 跨度 ${st.span.toFixed(2)} · 和弦音 ${(fit * 100).toFixed(0)}%`
        : '';
      // 唯一性读数：反重复系统成功时没有事件，这个安静的数字就是它的可见形态
      seenMel.add(sigOfNotes(bar.notes.filter((n) => n.hand === 'R')));
      seenLh.add(sigOfNotes(bar.notes.filter((n) => n.hand === 'L')));
      els.repStat.textContent = uniquenessLine(seenMel.size, seenLh.size, bar.index + 1);
      chorusChords.add(bar.chord.symbol);
      stats = accumulateLedger(stats, bar.decision); // 与工作室同一口径（fixture 不计）
      // 兜底归因（轮次 41/48）：把"这一小节为什么不是 Jev 弹的"说清楚，且只在事件首次发生时告知一次
      const fb = bar.decision.fixture && settings.channel !== 'fixture'
        ? (bar.decision.deadlineMiss ? 'slow' : 'down')
        : null;
      refreshStatus(fb);
      if (settings.channel !== 'fixture') {
        if (fb === 'slow' && !slowAnnounced) {
          slowAnnounced = true;
          toast(els.toast, '渠道跟不上演奏速度，本小节起由离线随机顶替——播放不中断，后续小节自动重试真实渠道', 6000);
        } else if (fb === 'down' && !fallbackAnnounced) {
          fallbackAnnounced = true;
          toast(els.toast, '真实渠道暂时不可用，本小节起由离线随机接管——播放不中断，后续小节自动重试真实渠道', 6000);
        } else if (!fb) {
          fallbackAnnounced = false; slowAnnounced = false;
        }
      }
      // 曲终（轮次 36 的手势在界面上的回声）：插入本遍小结，准备下一遍的记账
      if (bar.index % plan.totalBars === plan.totalBars - 1) {
        const chorus = Math.floor(bar.index / plan.totalBars) + 1;
        const summary = chorusSummary(
          chorus, plan.totalBars, chorusChords.size,
          seenMel.size - chorusStartMel, seenLh.size - chorusStartLh,
          stats.usd - chorusStartUsd,
        );
        if (summary) {
          const li = document.createElement('li');
          li.className = 'log-summary';
          li.textContent = summary;
          els.decisionLog.prepend(li);
        }
        chorusChords = new Set();
        chorusBarChords = [];
        chorusStartUsd = stats.usd; chorusStartTokens = stats.tokens;
        chorusStartMel = seenMel.size; chorusStartLh = seenLh.size;
      }
    },
    onNote(ev, voice) {
      // 琴键（轮次 71）：以声音的**真实**起止排程，而非请求的 ev.t/ev.dur——
      // 旧实现用 setTimeout(ev.t - currentTime) 把挂钟当成音频时钟，
      // 事件循环一拥塞、标签页一被节流，键就与声音错开，连奏还会累积漂移。
      const v = voice ?? { t0: ev.t, offAt: ev.t + ev.dur };
      kb.keySync?.schedule(ev.midi, v.t0, v.offAt, ev.vel);
      fall.push({ midi: ev.midi, t: ev.t, dur: ev.dur, vel: ev.vel, hand: ev.hand });
    },
    onError(err) {
      toast(els.toast, '演奏中断：' + err.message);
      stopAll();
    },
  });
  fall.start();
  tensionGraph.start();
  motifCard.start();
  player.start();
  els.stage.classList.remove('idle'); // 第一个音即将落地才摘空态（轮次 68）：计划期最长 12s，舞台不该两头都空着
  els.playBtn.textContent = '▶ 开始演奏';
  setButtons(true);
}

function stopAll() {
  player?.stop();
  fall.stop();
  tensionGraph.stop();
  motifCard.stop();
  kb.keySync?.clear(); // 状态机里可能还压着提前排程的音：不清就等着它们在停止后亮起来
  kb.clear();
  kb.mark(null); // 和弦键熄灭（轮次 57）：演奏结束，键盘回到无和声上下文的常态
  els.stage.classList.add('idle'); // 回到空态：节目单式引导重新出现（轮次 66）
  if (recording) { recording.stop().then((blob) => download(blob, `${plan?.title ?? 'jev-piano'}.webm`)); recording = null; els.recBtn.textContent = '● 录音'; }
  setButtons(false); // player 保留引用：已演奏的 records 仍可导出 MIDI
}

const download = downloadBlob; // 导出路径与工作室共用同一份实现（dom.js）

els.playBtn.addEventListener('click', start);
els.stopBtn.addEventListener('click', stopAll);
els.newBtn.addEventListener('click', start); // 换一版 = 新 seed 重排并立即演奏
els.pauseBtn.addEventListener('click', () => {
  if (!player) return;
  const on = !player.paused;
  player.pause(on);
  els.pauseBtn.querySelector('span').textContent = on ? '继续' : '暂停';
});
/* 空格 = 播放/暂停（轮次 72：简单操作直达核心体验）。
   守卫与 kbd.js 同宗——表单焦点/组合键/重触/输入法组合中不拦截；焦点落在按钮等
   交互元素上时交给浏览器原生的 click（否则会双触发）。
   三条边界（收口时补的，都是「看起来能用、实际会咬人」的地方）：
   ① 抽屉打开时不接管——用户正在读图例/改设置，按键不该让背后的乐曲起落；
   ② 输入法组合态（`isComposing`）一律放行，中文输入里空格是选词键；
   ③ 路由谓词与 `attachKeyboard` 的 `enabled` 同一条（`viewStudio.active`），
      别在这里另造一套「哪个界面在前台」的判据（轮次 68 的教训）。 */
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.isComposing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!els.legendDrawer.classList.contains('hidden')) return;
  if (!els.settingsDrawer.classList.contains('hidden')) return;
  const t = e.target;
  if (t && t !== document.body && t.closest?.('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) return;
  e.preventDefault();
  if (els.viewStudio.classList.contains('active')) {
    document.getElementById('stPlay')?.click();
    return;
  }
  if (player?.running) els.pauseBtn.click();
  else els.playBtn.click();
});
els.directorNote.addEventListener('input', () => {
  if (player?.composer) player.composer.directorNote = els.directorNote.value.trim();
});
els.midiBtn.addEventListener('click', () => {
  if (!player?.records?.length) return;
  // 速度弧线写入分段 set_tempo：导出的 MIDI 保留「尾段渐慢」的演奏意图
  const tempoMults = Array.from({ length: plan.totalBars }, (_, i) => tempoMultAt(plan, i));
  // 每小节一次和声变化 → 每小节换一次踏板（钢琴家在换和声处重踏是惯例）
  const pedalBars = Array.from({ length: plan.totalBars }, (_, i) => i);
  const bytes = exportMidi(player.records, { bpm: plan.bpm, meterNum: plan.meterNum, tempoMults, pedalBars });
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
  // 视觉选中态与 aria-selected 必须同源：tabpanel 的语义由 aria-selected 承载，
  // 只切 class 会让屏幕阅读器永远停在「实时即兴」上。
  els.tabLive.setAttribute('aria-selected', v === 'live' ? 'true' : 'false');
  els.tabStudio.setAttribute('aria-selected', v === 'studio' ? 'true' : 'false');
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
      syncKeyFields(); // 自动切的渠道同样要让 Key 字段跟着变，否则新渠道与界面状态不一致
      saveSettings();
    }
    refreshStatus();
    toast(els.toast, `检测到同源代理：Jev=${probe.jev ?? '无'} · LLM=${probe.llm ? '已配置' : '未配置'}`);
  }
})();
