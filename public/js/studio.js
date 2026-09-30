// studio.js — 第二界面「工作室」：jevthoven 式 生成 → 钢琴卷帘编辑 → 自然语言修改 → 导出。
// 与实时即兴共享同一决策内核（composer/jev）与音频引擎（audio 单例），但工作流不同：
// 先整曲批量生成（jevthoven 的 compose job，带进度与取消），再做**确定性编辑**（永不调用模型）；
// 自然语言修改由 Jev 从有限的确定性编辑命令中选择一个执行（jevthoven 的 revisions routed through Jev）。
import { buildPlan, Composer } from './composer.js';
import { askJev } from './jev.js';
import { getAudio } from './audio.js';
import { exportMidi } from './midi.js';
import { renderKeyboard, toast, sectionLabel } from './ui.js';
import { loadSettings } from './settings.js';
import { chordMidis, scaleMidis, nearest, NOTE_NAMES } from './music.js';
import { tempoMultAt } from './candidates.js';
import {
  clamp, snap, P_LO, P_HI, FN_COLOR, chordAt, quantizeNotes, densifyHand, sparserHand,
  transposeNotes, scaleVel, keywordAction, ACTIONS, ACTIONS_ZH, applyAction, validatePiece,
  barIndexAt, barFunction, pieceTension,
} from './studio-core.js';
const STORE_KEY = 'jevpiano.studio.v1'; // 自动保存/恢复的本地键（留在 DOM 层——savePiece/autosave/ensureStudio 用）
// 对外契约（测试与潜在外部使用方）保持从 studio.js 可导入——纯函数搬了家，门牌没换
export {
  quantizeNotes, chordAt, densifyHand, sparserHand, transposeNotes, scaleVel,
  keywordAction, ACTIONS, ACTIONS_ZH, applyAction, validatePiece, barIndexAt, barFunction, pieceTension,
};
import { barTension } from './tension.js';
import { barHarmonyFit } from './nct.js';


let tensionCache = null;
/** 张力受音符编辑影响（密度/音域分量），任何改动后必须作废 */
function invalidateTension() { tensionCache = null; nctCache = null; }
function tensionOf(piece) {
  if (!piece) return [];
  if (!tensionCache) tensionCache = pieceTension(piece);
  return tensionCache;
}

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
    chord: $('stChord'), info: $('stInfo'), keyboard: $('stKeyboard'),
  };
  kb = renderKeyboard(els.keyboard);
  bindRoll();
  bindVelLane();
  bindControls();
  window.__stDebug = () => ({ inited, hasPiece: !!piece, notes: piece?.notes.length ?? -1, savedVersion: piece?.version ?? null });
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
      if (cancelFlag) { toastify('已取消，保留已生成部分'); break; }
      const bar = await composer.nextBar();
      const off = i * plan.meterNum;
      for (const n of bar.notes) p.notes.push({ id: p.nid++, midi: n.midi, startBeats: off + n.startBeats, durBeats: n.durBeats, vel: n.vel, hand: n.hand });
      p.barChords.push({ startBeat: off, symbol: bar.chord.symbol, rootPc: chordRoot(bar.chord), shape: bar.chord.shape, fn: bar.decision.chordFn, intensity: bar.intensity });
      els.progress.style.transform = `scaleX(${(i + 1) / bars})`; // scaleX 而非 width：进度动画不触发布局
      els.progressText.textContent = `第 ${i + 1}/${bars} 小节 · ${bar.chord.symbol}`;
      updateInfo();
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
    composing = false;
    els.compose.disabled = false;
    els.compose.querySelector('span').textContent = '生成编曲';
    els.cancel.classList.add('hidden');
    setTimeout(() => els.progressWrap.classList.add('hidden'), 600);
    updateButtons();
  }
}

/** 力度轨：每个音符一根竖条，底部对齐、高度 ∝ 力度、颜色随手别（与卷帘一致）。
 *  与卷帘共用 ZOOM 像素/拍，横轴天然对齐；播放头 top:0/bottom:0 自动覆盖两条轨。 */
function drawVelLane() {
  const canvas = els.vel;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const beats = piece ? piece.totalBars * piece.plan.meterNum : 32;
  const W = Math.max(720, beats * ZOOM + 4);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${VEL_H}px`;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(VEL_H * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0d0a08';
  g.fillRect(0, 0, W, VEL_H);
  if (!piece) {
    g.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = 'rgba(139,129,104,0.8)';
    g.fillText('力度轨——生成后拖动竖条可改力度', 12, VEL_H / 2);
    return;
  }
  // 力度参考线（0.5 拍力度）
  g.strokeStyle = 'rgba(214,178,110,0.12)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, Math.round(VEL_H * (1 - 0.5)) + 0.5);
  g.lineTo(W, Math.round(VEL_H * (1 - 0.5)) + 0.5);
  g.stroke();
  const bw = Math.max(2, Math.min(6, ZOOM / 3));
  for (const n of piece.notes) {
    const x = n.startBeats * ZOOM + (n.durBeats * ZOOM - bw) / 2;
    const h = Math.max(2, n.vel * (VEL_H - 6));
    const base = n.hand === 'L' ? '92,184,174' : '232,192,106';
    g.fillStyle = `rgba(${base},0.85)`;
    g.fillRect(x, VEL_H - h, bw, h);
    g.fillStyle = `rgba(${base},1)`;
    g.fillRect(x, VEL_H - h, bw, 2);   // 顶端帽：让"改了没有"一眼可见
  }
}

/** 力度轨的指针交互：命中音符 → 拖动改力度 → 走既有 commit（自带 undo + 自动保存） */
function bindVelLane() {
  const canvas = els.vel;
  let drag = null, before = null;
  const velAt = (clientY) => {
    const r = canvas.getBoundingClientRect();
    return clamp(1 - (clientY - r.top) / VEL_H, 0.15, 1);
  };
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    const beat = (e.clientX - r.left) / ZOOM;
    // 命中窗口：横向 ±半个音符格，纵向整条轨
    let best = null, bestD = Infinity;
    for (const n of piece?.notes ?? []) {
      const d = Math.abs(n.startBeats - beat);
      if (d < bestD && d <= 0.5) { bestD = d; best = n; }
    }
    return best;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!piece || playing()) return;
    const n = pick(e);
    if (!n) return;
    before = JSON.stringify(piece.notes);
    drag = n;
    n.vel = velAt(e.clientY);
    canvas.setPointerCapture(e.pointerId);
    invalidateTension();
    drawVelLane();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.vel = velAt(e.clientY);
    invalidateTension();
    drawVelLane();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    const now = JSON.stringify(piece.notes);
    if (before !== null && now !== before) { undoStack.push(before); redoStack = []; trimUndo(); }
    before = null;
    invalidateTension();
    drawVelLane(); autosave(); updateInfo(); updateButtons();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function chordRoot(c) { return c.rootPc; }

/** 旋律里的非和弦音的 id 集合（用于亮边）。左手不参与。缓存随音符编辑作废。 */
let nctCache = null;
function nonChordIds(piece) {
  if (!piece) return new Set();
  if (nctCache) return nctCache;
  const ids = new Set();
  const meter = piece.plan?.meterNum || 4;
  for (const bc of piece.barChords ?? []) {
    const i = Math.round(bc.startBeat / meter);
    const mel = piece.notes.filter((n) => n.hand === 'R' && Math.floor(n.startBeats / meter) === i)
      .sort((a, b) => a.startBeats - b.startBeats);
    const { kinds } = barHarmonyFit({ chord: { rootPc: bc.rootPc, shape: bc.shape }, notes: mel });
    kinds.forEach((t, k) => { if (t !== 'chord' && mel[k]) ids.add(mel[k].id); });
  }
  nctCache = ids;
  return ids;
}

/** 画时间轴：张力面积（顶）+ 功能带 + 契合度带（底）。与卷帘共用 ZOOM，横轴天然对齐。 */
function drawTimeline(g, W, piece) {
  if (!piece) return;
  const meter = piece.plan.meterNum;
  const mode = piece.plan.mode;
  const xOf = (i) => piece.barChords[i].startBeat * ZOOM + (meter * ZOOM) / 2;

  // 1) 张力：面积 + 折线
  const t = tensionOf(piece);
  if (t.length) {
    g.save();
    g.beginPath();
    g.moveTo(0, H_TENSION);
    t.forEach((v, i) => g.lineTo(xOf(i), H_TENSION - v * H_TENSION));
    g.lineTo(W, H_TENSION);
    g.closePath();
    g.fillStyle = 'rgba(216,171,92,0.14)';
    g.fill();
    g.beginPath();
    t.forEach((v, i) => (i ? g.lineTo(xOf(i), H_TENSION - v * H_TENSION) : g.moveTo(xOf(i), H_TENSION - v * H_TENSION)));
    g.strokeStyle = 'rgba(240,205,138,0.72)';
    g.lineWidth = 1.2;
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }

  // 2) 功能带：每小节一段，颜色即功能
  for (let i = 0; i < piece.barChords.length; i++) {
    const bc = piece.barChords[i];
    g.fillStyle = `${FN_COLOR[barFunction(bc, mode)]}d0`;
    g.fillRect(bc.startBeat * ZOOM, H_TENSION, Math.max(1, meter * ZOOM - 1), H_FN);
  }

  // 3) 段落边界：竖线（形状线索）+ 段落名（文字线索）——不依赖颜色
  for (const s of piece.sections ?? []) {
    const x = s.start * meter * ZOOM;
    g.save();
    g.strokeStyle = 'rgba(240,205,138,0.45)';
    g.lineWidth = 1;
    g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, HEADER); g.stroke();
    g.setLineDash([]);
    g.font = '600 9px var(--mono, monospace)';
    g.fillStyle = 'rgba(240,205,138,0.85)';
    g.textBaseline = 'top';
    g.fillText(sectionLabel(s), x + 3, 1);
    g.restore();
  }

  // 4) 契合度带：每小节一根竖条，高度 = 和弦音占比。越高越「在调上」。
  const fitTop = H_TENSION + H_FN + H_CHORD;
  for (let i = 0; i < piece.barChords.length; i++) {
    const bc = piece.barChords[i];
    const meter2 = meter;
    const mel = piece.notes.filter((n) => n.hand === 'R' && Math.floor(n.startBeats / meter2) === i);
    const fit = mel.length ? barHarmonyFit({ chord: { rootPc: bc.rootPc, shape: bc.shape }, notes: mel }).fit : 1;
    const h = Math.max(1, fit * H_FIT);
    g.fillStyle = `rgba(216,171,92,${0.18 + fit * 0.5})`;
    g.fillRect(bc.startBeat * ZOOM, fitTop + (H_FIT - h), Math.max(1, meter2 * ZOOM - 1), h);
  }
  g.save();
  g.font = '8px var(--mono, monospace)';
  g.fillStyle = 'rgba(154,144,120,0.8)';
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('契合度', 2, fitTop + 1);
  g.restore();
}

/* ---------------- 钢琴卷帘 ---------------- */

function drawRoll() {
  const canvas = els.roll;
  const dpr = window.devicePixelRatio || 1;
  const beats = piece ? piece.totalBars * piece.plan.meterNum : 32;
  const W = Math.max(720, beats * ZOOM + 4);
  const H = HEADER + (P_HI - P_LO + 1) * ROW;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 键床底色：黑键行更深
  g.fillStyle = '#0b0907';
  g.fillRect(0, 0, W, H);
  for (let m = P_LO; m <= P_HI; m++) {
    const pc = ((m % 12) + 12) % 12;
    if ([1, 3, 6, 8, 10].includes(pc)) {
      g.fillStyle = '#110d0a';
      g.fillRect(0, HEADER + (P_HI - m) * ROW, W, ROW);
    }
  }
  // 乐句分块（每 8 小节交替微着色）
  if (piece) {
    const ph = piece.plan.barsPerPhrase * piece.plan.meterNum * ZOOM;
    for (let x = 0, i = 0; x < W; x += ph, i++) {
      if (i % 2 === 1) { g.fillStyle = 'rgba(216,171,92,0.045)'; g.fillRect(x, 0, ph, H); }
    }
  }
  // 纵向网格：小节强线 + 拍弱线
  if (piece) {
    const meter = piece.plan.meterNum;
    for (let b = 0; b <= piece.totalBars * meter; b++) {
      const x = Math.round(b * ZOOM) + 0.5;
      g.strokeStyle = b % meter === 0 ? 'rgba(214,178,110,0.4)' : 'rgba(214,178,110,0.1)';
      g.beginPath(); g.moveTo(x, HEADER); g.lineTo(x, H); g.stroke();
    }
    // 和弦名（卷帘头部）+ 与之对齐的功能带与张力曲线
    g.font = '600 10px Georgia, serif';
    g.fillStyle = 'rgba(240,205,138,0.85)';
    for (const bc of piece.barChords) g.fillText(bc.symbol, bc.startBeat * ZOOM + 4, H_TENSION + H_FN + 13);
    drawTimeline(g, W, piece);
    // hover 读数：crosshair + 文字（数据全现成：和弦/张力缓存/契合度/速度）
    if (hoverBar != null && hoverBar < piece.barChords.length) {
      const bc = piece.barChords[hoverBar];
      const t = tensionOf(piece)[hoverBar];
      const meterH = piece.plan.meterNum;
      const mel = piece.notes.filter((n) => n.hand === 'R' && Math.floor(n.startBeats / meterH) === hoverBar);
      const fit = mel.length ? barHarmonyFit({ chord: { rootPc: bc.rootPc, shape: bc.shape }, notes: mel }).fit : 1;
      const mult = tempoMultAt(piece.plan, hoverBar);
      const x = bc.startBeat * ZOOM + 0.5;
      g.save();
      g.strokeStyle = 'rgba(240,205,138,0.4)';
      g.lineWidth = 1;
      g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.setLineDash([]);
      g.font = '600 10px Georgia, serif';
      g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillStyle = 'rgba(240,205,138,0.95)';
      const speed = Math.round((Number(els.bpm.value) || piece.plan.bpm) * mult);
      g.fillText(`第 ${hoverBar + 1} 小节 · ${bc.symbol} · 张力 ${Number.isFinite(t) ? t.toFixed(2) : '—'} · 契合度 ${Math.round(fit * 100)}% · 速度 ${speed}`, 6, H_TENSION + 1);
      g.restore();
    }
    // 音符。**一维一通道**：手别 = 填色，非和音 = 亮边（左手恒为纯色，不受此影响）
    const nct = nonChordIds(piece);
    for (const n of piece.notes) {
      const x = n.startBeats * ZOOM, w = Math.max(4, n.durBeats * ZOOM - 1.5);
      const y = HEADER + (P_HI - n.midi) * ROW;
      const base = n.hand === 'L' ? '92,184,174' : '232,192,106';
      const dim = muted[n.hand] ? 0.35 : 1;
      g.fillStyle = `rgba(${base},${(0.35 + n.vel * 0.5) * dim})`;
      const isNct = n.hand === 'R' && nct.has(n.id);
      g.strokeStyle = isNct ? `rgba(240,205,138,${0.95 * dim})` : `rgba(${base},${0.9 * dim})`;
      g.lineWidth = isNct ? 1.6 : 1;
      g.beginPath();
      if (g.roundRect) g.roundRect(x + 0.5, y + 1, w, ROW - 2, 2); else g.rect(x + 0.5, y + 1, w, ROW - 2);
      g.fill(); g.stroke();
    }
  } else {
    g.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = 'rgba(139,129,104,0.8)';
    g.fillText('点左侧「生成编曲」——每一小节仍由 Jev 逐小节决策。', 24, H / 2 - 16);
    g.fillText('生成后这里会出现可编辑的整曲：可量化、拖力度、导出 MIDI。', 24, H / 2 + 2);
  }
}

function rollPos(e) {
  const rect = els.roll.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  return { beat: px / ZOOM, pitch: P_HI - Math.floor((py - HEADER) / ROW), px };
}

function noteAt(beat, pitch) {
  if (!piece) return null;
  for (let i = piece.notes.length - 1; i >= 0; i--) {
    const n = piece.notes[i];
    if (n.midi === pitch && beat >= n.startBeats && beat <= n.startBeats + n.durBeats) return n;
  }
  return null;
}

// 卷帘 hover（轮次 34）：光标所在小节的读数（编辑主战场的逐小节检视，与实时界面的张力带 hover 同源）
let hoverBar = null;

function bindRoll() {
  let drag = null;
  let snapBefore = null;

  const commit = () => {
    const now = JSON.stringify(piece.notes);
    if (snapBefore !== null && now !== snapBefore) { undoStack.push(snapBefore); redoStack = []; trimUndo(); }
    snapBefore = null;
    invalidateTension();
    drawRoll(); drawVelLane(); autosave(); updateInfo(); updateButtons();
  };

  els.roll.addEventListener('pointerdown', (e) => {
    if (!piece || playing()) return;
    const { beat, pitch, px } = rollPos(e);
    if (pitch < P_LO || pitch > P_HI) return;
    snapBefore = JSON.stringify(piece.notes);
    const hit = noteAt(beat, pitch);
    if (hit) {
      const edge = (hit.startBeats + hit.durBeats) * ZOOM;
      drag = Math.abs(px - edge) < 7
        ? { mode: 'resize', note: hit }
        : { mode: 'move', note: hit, grab: beat - hit.startBeats };
    } else {
      const note = { id: piece.nid++, midi: pitch, startBeats: clamp(snap(Math.max(0, beat - 0.5)), 0, piece.totalBars * piece.plan.meterNum), durBeats: 1, vel: 0.75, hand: pitch >= 60 ? 'R' : 'L' };
      piece.notes.push(note);
      drag = { mode: 'resize', note };
    }
    els.roll.setPointerCapture(e.pointerId);
  });
  els.roll.addEventListener('pointermove', (e) => {
    if (!drag || !piece) return;
    const { beat, pitch } = rollPos(e);
    const n = drag.note;
    if (drag.mode === 'move') {
      n.startBeats = clamp(snap(beat - drag.grab), 0, piece.totalBars * piece.plan.meterNum - n.durBeats);
      n.midi = clamp(pitch, P_LO, P_HI);
    } else {
      n.durBeats = clamp(snap(beat - n.startBeats), 0.25, 8);
    }
    drawRoll();
  });
  els.roll.addEventListener('pointerup', () => { if (drag) { drag = null; commit(); } });
  els.roll.addEventListener('pointermove', (e) => {
    if (!piece) return;
    const { beat } = rollPos(e);
    const i = barIndexAt(beat, piece.plan.meterNum, piece.totalBars);
    const next = i >= 0 ? i : null;
    if (next !== hoverBar) { hoverBar = next; drawRoll(); }
  });
  els.roll.addEventListener('pointerleave', () => { if (hoverBar != null) { hoverBar = null; drawRoll(); } });
  els.roll.addEventListener('dblclick', (e) => {
    if (!piece || playing()) return;
    const { beat, pitch } = rollPos(e);
    const hit = noteAt(beat, pitch);
    if (!hit) return;
    snapBefore = JSON.stringify(piece.notes);
    piece.notes.splice(piece.notes.indexOf(hit), 1);
    commit();
  });
}

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
  els.playhead.style.left = `${x}px`;
  els.playhead.classList.remove('hidden');
  const chord = piece ? chordAt(piece.barChords, disp) : null;
  if (chord) els.chord.textContent = chord.symbol;
  // 播放头跟随滚动
  const view = els.rollWrap.clientWidth;
  if (x < els.rollWrap.scrollLeft || x > els.rollWrap.scrollLeft + view - 60) {
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
    const bytes = exportMidi(piece.notes, { bpm: Number(els.bpm.value), meterNum: piece.plan.meterNum, tempoMults });
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

