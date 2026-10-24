// studio.js — 第二界面「工作室」：jevthoven 式 生成 → 钢琴卷帘编辑 → 自然语言修改 → 导出。
// 与实时即兴共享同一决策内核（composer/jev）与音频引擎（audio 单例），但工作流不同：
// 先整曲批量生成（jevthoven 的 compose job，带进度与取消），再做**确定性编辑**（永不调用模型）；
// 自然语言修改由 Jev 从有限的确定性编辑命令中选择一个执行（jevthoven 的 revisions routed through Jev）。
// 卷帘视图与指针交互在 studio-roll.js（轮次 54 拆出）；本文件持有 piece/撤销/回放/台账等状态与工作流。
import { buildPlan, Composer } from './composer.js';
import { askJev } from './jev.js';
import { getAudio } from './audio.js';
import { exportMidi } from './midi.js';
import { renderKeyboard, toast, setStatus, emptyLedger, accumulateLedger, ledgerPills, CHANNEL_LABEL, keyEchoText } from './ui.js';
import { loadSettings } from './settings.js';
import { NOTE_NAMES } from './music.js';
import { tempoMultAt } from './candidates.js';
import { createRollView } from './studio-roll.js';
import {
  clamp, chordAt, quantizeNotes, densifyHand, sparserHand,
  transposeNotes, scaleVel, keywordAction, ACTIONS, ACTIONS_ZH, applyAction, validatePiece,
  barIndexAt, barFunction, pieceTension,
  // 卷帘布局常量（轮次 49 回填——轮次 38 拆分时它们被搬走却没 export 回来，见 studio-core.js 注释）
  ZOOM, ROW, VEL_H, H_TENSION, H_FN, H_CHORD, H_FIT, HEADER,
} from './studio-core.js';
const STORE_KEY = 'jevpiano.studio.v1'; // 自动保存/恢复的本地键（留在 DOM 层——savePiece/autosave/ensureStudio 用）
// 对外契约（测试与潜在外部使用方）保持从 studio.js 可导入——纯函数搬了家，门牌没换
export {
  quantizeNotes, chordAt, densifyHand, sparserHand, transposeNotes, scaleVel,
  keywordAction, ACTIONS, ACTIONS_ZH, applyAction, validatePiece, barIndexAt, barFunction, pieceTension,
  // 布局常量也走再导出：外部（测试/潜在使用方）只认 studio.js 这个门牌
  ZOOM, ROW, VEL_H, H_TENSION, H_FN, H_CHORD, H_FIT, HEADER,
};


/** 计费台账（轮次 50）：与实时界面共用 accumulateLedger 口径，生成过程的每一小节都记账 */
let ledger = emptyLedger();

/** 把台账刷到顶栏 pill。渠道名从当前设置读——工作室与实时界面看的是同一个渠道。 */
function refreshLedger() {
  if (!els?.tokens) return;
  const s = loadSettings();
  const p = ledgerPills(ledger);
  setStatus({ channel: els.channel, tokens: els.tokens, cost: els.cost, latency: els.latency }, {
    channel: CHANNEL_LABEL[s.channel] ?? s.channel,
    tokens: p.tokens, cost: p.cost, latency: p.latency,
  });
}

function resetLedger() { ledger = emptyLedger(); }

/* ---------------- 卷帘视图（studio-roll.js，轮次 54 拆出） ---------------- */

let roll = null; // ensureStudio 时创建；绘制/指针交互/hover 与两份分析缓存的宿主

/** 张力受音符编辑影响（密度/音域分量），任何改动后必须作废——缓存本体住在卷帘视图里，这里转发 */
function invalidateTension() { roll?.invalidate(); }

// 薄转发：setPiece/compose/undo/量化/静音等调用方不必感知拆分
function drawRoll() { roll?.draw(); }
function drawVelLane() { roll?.drawVel(); }

/* ==================== 工作室界面（DOM 逻辑，惰性初始化） ==================== */

let inited = false;
let els = null;
let kb = null;
let piece = null;            // { version:1, plan, notes, barChords, totalBars, nid }
let undoStack = [], redoStack = [];
let composing = false, cancelFlag = false;
let muted = { R: false, L: false };
let loop = true;
let playheadTimer = null;
let rp = null;               // 回放状态

/** 键盘试听的和声上下文（轮次 55）：回放中取播放头所在小节的和弦，静止时取最后一小节 */
function chordCtx() {
  if (!piece?.barChords?.length) return null;
  if (rp?.playing && rp.totalBeats > 0) {
    const beat = (rp.audio.ctx.currentTime - rp.t0) / rp.beatDur;
    if (beat >= 0) return chordAt(piece.barChords, beat % rp.totalBeats) ?? piece.barChords[piece.barChords.length - 1];
  }
  return piece.barChords[piece.barChords.length - 1];
}

export function ensureStudio() {
  if (inited) return;
  inited = true;
  const $ = (id) => document.getElementById(id);
  els = {
    prompt: $('stPrompt'), style: $('stStyle'), bars: $('stBars'),
    compose: $('stCompose'), cancel: $('stCancel'), variation: $('stVariation'), newBtn: $('stNew'),
    progressWrap: $('stProgressWrap'), progress: $('stProgress'), progressText: $('stProgressText'),
    revise: $('stRevise'), reviseBtn: $('stReviseBtn'),
    midi: $('stMidi'), saveJson: $('stSaveJson'), loadBtn: $('stLoadBtn'), loadJson: $('stLoadJson'),
    roll: $('stRoll'), rollWrap: $('stRollWrap'), playhead: $('stPlayhead'), vel: $('stVel'),
    quant: $('stQuant'), quantGrid: $('stQuantGrid'),
    play: $('stPlay'), loopBtn: $('stLoop'), muteR: $('stMuteR'), muteL: $('stMuteL'),
    bpm: $('stBpm'), undo: $('stUndo'), redo: $('stRedo'),
    chord: $('stChord'), info: $('stInfo'), keyboard: $('stKeyboard'), kbEcho: $('stKbEcho'),
    // 顶栏计费 pill 与实时界面**共用同一份 DOM**：工作室生成也必须记账，否则一次 32 小节的
    // 花费对用户完全不可见（轮次 50 修复）
    channel: $('stChannel'), tokens: $('stTokens'), cost: $('stCost'), latency: $('stLatency'),
  };
  kb = renderKeyboard(els.keyboard, {
    onKey: (midi) => {
      els.kbEcho.textContent = keyEchoText(midi, chordCtx()); // 跟弹回声（轮次 55）：同实时页
      getAudio().ensure()
        .then(() => getAudio().play(midi, getAudio().ctx.currentTime + 0.01, 0.9, 0.7))
        .catch(() => { /* 同实时页：试听是增强 */ });
    },
  });
  roll = createRollView({
    els,                           // DOM 引用表（卷帘用 vel/roll/bpm 三个键）
    getPiece: () => piece,         // piece 的单一真相源在本文件，可被整体替换——走访问器
    playing,                       // 回放中禁止编辑
    pushUndo,                      // 编辑落账（撤销栈在本文件）
    onCommit,                      // 编辑提交后的收尾：自动保存/信息行/按钮态
    muted,                         // 静音状态（对象引用共享：控件写、绘制读）
  });
  roll.bind();
  roll.bindVel();
  bindControls();
  window.__stDebug = () => ({ inited, hasPiece: !!piece, notes: piece?.notes.length ?? -1, savedVersion: piece?.version ?? null });
  refreshLedger(); // 进工作室就把 pill 对齐到当前渠道（此前显示的是实时界面留下的存量）
  // 恢复上次的工作台
  try {
    const saved = validatePiece(JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'));
    if (saved) { setPiece(saved); toastify('已恢复上次的工作台'); }
  } catch { /* ignore */ }
  updateButtons();
}

function toastify(msg) { toast(document.getElementById('toast'), msg); }

/** 自动保存写入：存储不可用（隐私模式/配额满）时返回 false，由调用方提示用户 */
export function savePiece(piece, storage) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(piece));
    return true;
  } catch {
    return false;
  }
}

function setPiece(p) {
  piece = p;
  undoStack = []; redoStack = [];
  invalidateTension();
  els.bpm.value = p.bpm ?? p.plan.bpm;
  drawRoll();
  drawVelLane();
  updateInfo();
  autosave();
}

/* ---------------- 生成任务（compose job） ---------------- */

async function compose(newSeed) {
  if (composing) return;
  const s = loadSettings();
  const seed = newSeed ?? Math.floor(Math.random() * 2 ** 31);
  const bars = Number(els.bars.value);
  composing = true; cancelFlag = false;
  resetLedger(); // 新一次生成 = 新一本账，避免上一轮的花费混进来
  els.compose.disabled = true;
  els.compose.querySelector('span').textContent = '生成中…';
  els.cancel.classList.remove('hidden');
  els.progressWrap.classList.remove('hidden');
  els.variation.disabled = true;

  try {
    const plan = await buildPlan({
      prompt: els.prompt.value.trim() || '一段安静的即兴',
      goal: '随机冒险',
      styleId: els.style.value,
      seed, bars,
      keyPc: loadSettings().keySel && loadSettings().keySel !== 'auto' ? Number(loadSettings().keySel) : null,
    }, {
      llm: s.llmEnabled ? { enabled: true, baseUrl: s.llmBaseUrl, model: s.llmModel, apiKey: s.llmKey, proxy: s.llmProxy } : { enabled: false },
    });
    const composer = new Composer(plan, {
      channel: s.channel,
      apiKey: s.channel === 'typesafe' ? s.typesafeKey : s.openrouterKey,
    });
    const p = {
      version: 1, plan, totalBars: bars, nid: 1,
      notes: [], barChords: [], bpm: plan.bpm, sections: plan.sections ?? [],
    };
    piece = p;
    invalidateTension();
    for (let i = 0; i < bars; i++) {
      if (cancelFlag) { refreshLedger(); toastify('已取消，保留已生成部分'); break; }
      const bar = await composer.nextBar();
      const off = i * plan.meterNum;
      for (const n of bar.notes) p.notes.push({ id: p.nid++, midi: n.midi, startBeats: off + n.startBeats, durBeats: n.durBeats, vel: n.vel, hand: n.hand });
      p.barChords.push({ startBeat: off, symbol: bar.chord.symbol, rootPc: chordRoot(bar.chord), shape: bar.chord.shape, fn: bar.decision.chordFn, intensity: bar.intensity });
      ledger = accumulateLedger(ledger, bar.decision); // 每小节记账（fixture 不计——离线随机无费用）
      els.progress.style.transform = `scaleX(${(i + 1) / bars})`; // scaleX 而非 width：进度动画不触发布局
      els.progressText.textContent = `第 ${i + 1}/${bars} 小节 · ${bar.chord.symbol}`;
      updateInfo();
      refreshLedger(); // 生成中数字就在涨——花费对用户可见
      drawRoll(); drawVelLane(); // jevthoven 式 complete-bar preview：边生成边可见
      await new Promise((r) => setTimeout(r, 0)); // 让出主线程刷新 UI
    }
    undoStack = []; redoStack = [];
    els.bpm.value = plan.bpm;
    autosave();
    if (!cancelFlag) toastify('编曲完成，可直接编辑或播放');
  } catch (e) {
    toastify('生成失败：' + (e?.message ?? e));
  } finally {
    refreshLedger(); // 成功/取消/失败三条路径都在此落账——已生成部分的花费照实显示
    composing = false;
    els.compose.disabled = false;
    els.compose.querySelector('span').textContent = '生成编曲';
    els.cancel.classList.add('hidden');
    setTimeout(() => els.progressWrap.classList.add('hidden'), 600);
    updateButtons();
  }
}

function chordRoot(c) { return c.rootPc; }

/* ---------------- 回放（固定音符的 lookahead 调度器 + 循环） ---------------- */

function playing() { return !!rp?.playing; }

function startPlay() {
  if (!piece?.notes.length) return;
  const audio = getAudio();
  rp = {
    playing: true,
    audio,
    notes: [...piece.notes].sort((a, b) => a.startBeats - b.startBeats),
    bpm: clamp(Number(els.bpm.value) || piece.plan.bpm, 40, 200),
    totalBeats: piece.totalBars * piece.plan.meterNum,
    ptr: 0, iter: 0, endFired: false,
  };
  rp.beatDur = 60 / rp.bpm;
  rp.t0 = audio.ctx.currentTime + 0.25;
  rp.timer = setInterval(() => tickPlay(), 30);
  playheadTimer = setInterval(() => drawPlayhead(), 33);
  els.play.querySelector('span').textContent = '停止';
}

function tickPlay() {
  const now = rp.audio.ctx.currentTime;
  const horizon = now + 0.15;
  for (;;) {
    if (rp.ptr >= rp.notes.length) {
      if (loop && rp.totalBeats > 0) { rp.iter++; rp.ptr = 0; continue; }
      stopPlay();
      return;
    }
    const n = rp.notes[rp.ptr];
    const t = rp.t0 + (n.startBeats + rp.iter * rp.totalBeats) * rp.beatDur;
    if (t > horizon) break;
    if (t > now - 0.05 && !muted[n.hand]) {
      rp.audio.play(n.midi, t, Math.max(0.1, n.durBeats * rp.beatDur), n.vel);
      const delay = Math.max(0, (t - rp.audio.ctx.currentTime) * 1000);
      setTimeout(() => kb.flash(n.midi, Math.max(80, n.durBeats * rp.beatDur * 1000)), delay);
    }
    rp.ptr++;
  }
}

function drawPlayhead() {
  if (!rp?.playing) return;
  const beat = (rp.audio.ctx.currentTime - rp.t0) / rp.beatDur;
  if (beat < 0) return;
  const disp = loop ? beat % rp.totalBeats : Math.min(beat, rp.totalBeats);
  const x = disp * ZOOM;
  // 30Hz 的循环里，**先读布局再写**：先写 style.left 再读 clientWidth 会让浏览器每帧强制一次同步 reflow。
  const view = els.rollWrap.clientWidth;
  const sl = els.rollWrap.scrollLeft;
  const chord = piece ? chordAt(piece.barChords, disp) : null;
  els.playhead.style.left = `${x}px`;
  els.playhead.classList.remove('hidden');
  if (chord && els.chord.textContent !== chord.symbol) els.chord.textContent = chord.symbol; // 同一小节内和弦不变，别每帧写 DOM
  // 播放头跟随滚动
  if (x < sl || x > sl + view - 60) {
    els.rollWrap.scrollLeft = Math.max(0, x - view * 0.4);
  }
}

function stopPlay() {
  if (rp) { clearInterval(rp.timer); rp.playing = false; }
  if (playheadTimer) { clearInterval(playheadTimer); playheadTimer = null; }
  els.play.querySelector('span').textContent = '播放';
  els.playhead.classList.add('hidden');
  rp = null;
}

/* ---------------- 撤销 / 重做 / 自动保存 ---------------- */

function trimUndo() { while (undoStack.length > 50) undoStack.shift(); }

/** 编辑落账（卷帘/力度轨的拖动提交共用）：压撤销、清重做、截断 */
function pushUndo(snap) { undoStack.push(snap); redoStack = []; trimUndo(); }

/** 编辑收尾（卷帘已自行重绘并作废缓存）：自动保存 + 信息行 + 按钮态 */
function onCommit() { autosave(); updateInfo(); updateButtons(); }

function doUndo() {
  if (!piece || !undoStack.length) return;
  redoStack.push(JSON.stringify(piece.notes));
  piece.notes = JSON.parse(undoStack.pop());
  invalidateTension();
  drawRoll(); drawVelLane(); autosave(); updateInfo(); updateButtons();
}
function doRedo() {
  if (!piece || !redoStack.length) return;
  undoStack.push(JSON.stringify(piece.notes));
  piece.notes = JSON.parse(redoStack.pop());
  invalidateTension();
  drawRoll(); drawVelLane(); autosave(); updateInfo(); updateButtons();
}

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!piece) return;
    if (!savePiece({ ...piece, bpm: Number(els.bpm.value) }, localStorage)) {
      toastify('自动保存失败：浏览器存储不可用（隐私模式或空间已满），请及时导出 JSON 备份');
    }
  }, 500);
}

function updateInfo() {
  if (!piece) { els.info.textContent = '先生成一段编曲'; return; }
  els.info.textContent = `${piece.totalBars} 小节 · ${piece.notes.length} 音 · ${NOTE_NAMES[piece.plan.keyPc]} ${piece.plan.mode}`;
}

function updateButtons() {
  const has = !!piece && !composing;
  els.play.disabled = !has || !piece.notes.length;
  els.loopBtn.disabled = !has;
  els.bpm.disabled = !has;
  els.midi.disabled = !has || !piece.notes.length;
  els.saveJson.disabled = !has;
  els.loadBtn.disabled = composing;
  els.reviseBtn.disabled = !has;
  els.variation.disabled = composing || !has;
  els.undo.disabled = !has || !undoStack.length;
  els.redo.disabled = !has || !redoStack.length;
  els.quant.disabled = !has;
  els.quantGrid.disabled = !has;
}

/* ---------------- 自然语言修改（Jev 选择确定性编辑命令） ---------------- */

async function revise() {
  if (!piece) return;
  const request = els.revise.value.trim();
  if (!request) { toastify('先写下你想怎么改'); return; }
  els.reviseBtn.disabled = true;
  try {
    const s = loadSettings();
    let action;
    if (s.channel === 'fixture') {
      action = keywordAction(request);
    } else {
      const perBar = (hand) => piece.notes.filter((n) => n.hand === hand).length / piece.totalBars;
      const avgVel = piece.notes.reduce((s2, n) => s2 + n.vel, 0) / Math.max(1, piece.notes.length);
      try {
        const out = await askJev({
          state: {
            request,
            piece: {
              style: piece.plan.styleName, key: `${NOTE_NAMES[piece.plan.keyPc]} ${piece.plan.mode}`,
              bpm: Number(els.bpm.value), bars: piece.totalBars,
              lh_notes_per_bar: Number(perBar('L').toFixed(1)), rh_notes_per_bar: Number(perBar('R').toFixed(1)),
              avg_velocity: Number(avgVel.toFixed(2)),
            },
          },
          questions: {
            action: {
              type: 'choice',
              instructions: 'You are directing edits to a finished piano composition. Based on the user request and the piece summary, pick the single best deterministic edit command. Answer ONLY with the Choice question "action".',
              criteria: { ...ACTIONS },
            },
          },
        }, { channel: s.channel, apiKey: s.channel === 'typesafe' ? s.typesafeKey : s.openrouterKey, attempts: 2, timeoutMs: 8000 });
        action = ACTIONS[out.answers.action?.value] ? out.answers.action.value : keywordAction(request);
      } catch {
        action = keywordAction(request);
      }
    }
    const before = JSON.stringify(piece.notes);
    applyAction(piece, action);
    if (JSON.stringify(piece.notes) !== before) {
      undoStack.push(before); redoStack = []; trimUndo();
      invalidateTension();
      drawRoll(); drawVelLane(); autosave(); updateInfo(); updateButtons();
      toastify(`Jev 已执行：${ACTIONS_ZH[action]}`);
    } else {
      toastify(`Jev 选择「${ACTIONS_ZH[action]}」，但没有可调整的地方`);
    }
  } finally {
    els.reviseBtn.disabled = !piece;
  }
}

/* ---------------- 控件绑定 ---------------- */

function bindControls() {
  els.compose.addEventListener('click', () => compose(null));
  els.cancel.addEventListener('click', () => { cancelFlag = true; });
  els.variation.addEventListener('click', () => compose(null)); // 新 seed、同一灵感
  els.newBtn.addEventListener('click', () => {
    stopPlay(); piece = null; undoStack = []; redoStack = [];
    localStorage.removeItem(STORE_KEY);
    drawRoll(); drawVelLane(); updateInfo(); updateButtons();
    els.chord.textContent = '—';
    toastify('已清空工作台');
  });

  els.play.addEventListener('click', async () => {
    if (playing()) { stopPlay(); return; }
    if (!piece?.notes.length) return;
    try { await getAudio().ensure(); } catch (e) { toastify('无法启动音频：' + e.message); return; }
    startPlay();
  });
  els.loopBtn.addEventListener('click', () => { loop = !loop; els.loopBtn.classList.toggle('sel', loop); });
  els.muteR.addEventListener('change', () => { muted.R = els.muteR.checked; drawRoll(); drawVelLane(); });
  els.muteL.addEventListener('change', () => { muted.L = els.muteL.checked; drawRoll(); drawVelLane(); });
  els.undo.addEventListener('click', doUndo);
  els.redo.addEventListener('click', doRedo);
  els.quant.addEventListener('click', () => {
    if (!piece || playing()) return;
    const before = JSON.stringify(piece.notes);
    const moved = quantizeNotes(piece, { grid: Number(els.quantGrid.value) || 0.25, strength: 1 });
    if (!moved) { toastify('所有音符已经在网格上'); return; }
    undoStack.push(before); redoStack = []; trimUndo();
    invalidateTension();
    drawRoll(); drawVelLane(); autosave(); updateInfo(); updateButtons();
    toastify(`已量化 ${moved} 个音符到 ${els.quantGrid.selectedOptions[0]?.text ?? ''} 网格`);
  });
  window.addEventListener('keydown', (e) => {
    if (!document.getElementById('viewStudio').classList.contains('active')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
  });

  els.reviseBtn.addEventListener('click', revise);

  els.midi.addEventListener('click', () => {
    if (!piece) return;
    // 速度弧线写入分段 set_tempo（旧 JSON 无 sections 时 tempoMultAt 走兼容路径，尾部缓降）
    const tempoMults = Array.from({ length: piece.totalBars }, (_, i) => tempoMultAt(piece.plan, i));
    // 换踏只发生在和声真正变化的小节（相邻同名和弦不重复踏）
    const pedalBars = (piece.barChords ?? [])
      .filter((bc, i) => i === 0 || bc.symbol !== piece.barChords[i - 1].symbol)
      .map((bc) => barIndexAt(bc.startBeat, piece.plan.meterNum, piece.totalBars))
      .filter((i) => i >= 0);
    const bytes = exportMidi(piece.notes, { bpm: Number(els.bpm.value), meterNum: piece.plan.meterNum, tempoMults, pedalBars });
    const blob = new Blob([bytes], { type: 'audio/midi' });
    download(blob, `${piece.plan.title}.mid`);
  });
  els.saveJson.addEventListener('click', () => {
    if (!piece) return;
    const data = { ...piece, version: 1, bpm: Number(els.bpm.value) };
    download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `${piece.plan.title}.jevpiano.json`);
  });
  els.loadBtn.addEventListener('click', () => els.loadJson.click());
  els.loadJson.addEventListener('change', async () => {
    const file = els.loadJson.files?.[0];
    if (!file) return;
    try {
      const p = validatePiece(JSON.parse(await file.text()));
      if (!p) { toastify('JSON 校验失败：不是有效的 jev-piano 项目'); return; }
      stopPlay(); setPiece(p); updateInfo(); updateButtons();
      toastify(`已载入「${p.plan.title}」`);
    } catch (e) {
      toastify('载入失败：' + e.message);
    } finally {
      els.loadJson.value = '';
    }
  });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** 切回实时即兴时由 main 调用：停掉工作室回放 */
export function stopStudio() {
  if (inited && playing()) stopPlay();
}

