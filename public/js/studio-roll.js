// studio-roll.js — 工作室钢琴卷帘视图（轮次 54 从 studio.js 拆出）：
// 卷帘与力度轨的绘制、指针交互（移动/缩放/双击删音/拖力度）、hover 逐小节读数、
// 时间轴头部（张力面积 + 功能带 + 段落界 + 契合度带），以及张力/非和声音两份分析缓存
// （只被绘制路径消费，随音符编辑作废）。**只画不决策**：piece 的单一真相源在 studio.js，
// 本模块经 deps 闭包读写，由 ensureStudio 创建一次（createRollView）。
import { sectionLabel } from './ui.js';
import { tempoMultAt } from './candidates.js';
import { barHarmonyFit } from './nct.js';
import { cadenceIntoBar, CADENCE_ZH } from './cadence.js';
import {
  clamp, snap, P_LO, P_HI, FN_COLOR, barIndexAt, barFunction, pieceTension, findNoteAt,
  nonChordIds as coreNonChordIds,
  ZOOM, ROW, VEL_H, H_TENSION, H_FN, H_CHORD, H_FIT, HEADER,
} from './studio-core.js';

/**
 * 创建卷帘视图。deps（全部由 studio.js 提供，闭包持有其可变状态）：
 * - els       DOM 引用表（本模块用 vel / roll / bpm 三个键）
 * - getPiece  () => piece 当前曲目；piece 会被 studio.js 整体替换，故走访问器而非值传递
 * - playing   () => 是否回放中（回放中禁止编辑）
 * - pushUndo  (快照串) => void 编辑落账（撤销/重做栈由 studio.js 持有）
 * - onCommit  () => void 编辑提交后的收尾（自动保存/信息行/按钮态——studio.js 的职责）
 * - muted     静音状态对象（引用共享：控件写它、绘制读它）
 * 返回 { bind, bindVel, draw, drawVel, invalidate }；bind/bindVel 各只调一次。
 */
export function createRollView(deps) {
  let tensionCache = null;
  let nctCache = null;
  // 卷帘 hover（轮次 34）：光标所在小节的读数（编辑主战场的逐小节检视，与实时界面的张力带 hover 同源）
  let hoverBar = null;

  /** 张力与非和声音两份缓存随音符编辑作废（密度/音域/和声贴合分量都会变） */
  function invalidate() { tensionCache = null; nctCache = null; }

  function tensionOf(piece) {
    if (!piece) return [];
    if (!tensionCache) tensionCache = pieceTension(piece);
    return tensionCache;
  }

  /** 非和弦音 id（卷帘亮边）的**缓存门面**：计算本身是纯函数（studio-core.js），缓存随音符编辑作废。 */
  function nonChordIds(piece) {
    if (!nctCache) nctCache = coreNonChordIds(piece);
    return nctCache;
  }

  /** 力度轨：每个音符一根竖条，底部对齐、高度 ∝ 力度、颜色随手别（与卷帘一致）。
   *  与卷帘共用 ZOOM 像素/拍，横轴天然对齐；播放头 top:0/bottom:0 自动覆盖两条轨。 */
  function drawVelLane() {
    const canvas = deps.els.vel;
    if (!canvas) return;
    const piece = deps.getPiece();
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
    const canvas = deps.els.vel;
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
      for (const n of deps.getPiece()?.notes ?? []) {
        const d = Math.abs(n.startBeats - beat);
        if (d < bestD && d <= 0.5) { bestD = d; best = n; }
      }
      return best;
    };
    canvas.addEventListener('pointerdown', (e) => {
      const piece = deps.getPiece();
      if (!piece || deps.playing()) return;
      const n = pick(e);
      if (!n) return;
      before = JSON.stringify(piece.notes);
      drag = n;
      n.vel = velAt(e.clientY);
      canvas.setPointerCapture(e.pointerId);
      invalidate();
      drawVelLane();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.vel = velAt(e.clientY);
      invalidate();
      drawVelLane();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      const now = JSON.stringify(deps.getPiece().notes);
      if (before !== null && now !== before) { deps.pushUndo(before); }
      before = null;
      invalidate();
      drawVelLane(); deps.onCommit();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
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
      // canvas 的 font 不解析 CSS 变量（轮次 54 发现、56 修复）——字面字体栈，与 styles.css --mono 同族（有契约测试守）
      g.font = '600 9px "Cascadia Mono", Consolas, monospace';
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
    g.font = '8px "Cascadia Mono", Consolas, monospace';
    g.fillStyle = 'rgba(154,144,120,0.8)';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('契合度', 2, fitTop + 1);
    g.restore();
  }

  /* ---------------- 卷帘本体 ---------------- */

  function drawRoll() {
    const canvas = deps.els.roll;
    const piece = deps.getPiece();
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
        const speed = Math.round((Number(deps.els.bpm.value) || piece.plan.bpm) * mult);
        // 终止式（轮次 55）：hover 到乐句末小节时，把「进入该小节」的终止式一并读出
        const cad = cadenceIntoBar(piece.barChords, piece.plan.meterNum, piece.plan.barsPerPhrase, hoverBar);
        g.fillText(`第 ${hoverBar + 1} 小节 · ${bc.symbol} · 张力 ${Number.isFinite(t) ? t.toFixed(2) : '—'} · 契合度 ${Math.round(fit * 100)}% · 速度 ${speed}${cad ? ` · ${CADENCE_ZH[cad]}` : ''}`, 6, H_TENSION + 1);
        g.restore();
      }
      // 音符。**一维一通道**：手别 = 填色，非和音 = 亮边（左手恒为纯色，不受此影响）
      const nct = nonChordIds(piece);
      for (const n of piece.notes) {
        const x = n.startBeats * ZOOM, w = Math.max(4, n.durBeats * ZOOM - 1.5);
        const y = HEADER + (P_HI - n.midi) * ROW;
        const base = n.hand === 'L' ? '92,184,174' : '232,192,106';
        const dim = deps.muted[n.hand] ? 0.35 : 1;
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
    const rect = deps.els.roll.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { beat: px / ZOOM, pitch: P_HI - Math.floor((py - HEADER) / ROW), px };
  }

  function noteAt(beat, pitch) {
    const piece = deps.getPiece();
    return piece ? findNoteAt(piece.notes, beat, pitch) : null;
  }

  function bindRoll() {
    let drag = null;
    let snapBefore = null;

    const commit = () => {
      const now = JSON.stringify(deps.getPiece().notes);
      if (snapBefore !== null && now !== snapBefore) { deps.pushUndo(snapBefore); }
      snapBefore = null;
      invalidate();
      drawRoll(); drawVelLane(); deps.onCommit();
    };

    deps.els.roll.addEventListener('pointerdown', (e) => {
      const piece = deps.getPiece();
      if (!piece || deps.playing()) return;
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
      deps.els.roll.setPointerCapture(e.pointerId);
    });
    deps.els.roll.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const piece = deps.getPiece();
      if (!piece) return;
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
    deps.els.roll.addEventListener('pointerup', () => { if (drag) { drag = null; commit(); } });
    deps.els.roll.addEventListener('pointermove', (e) => {
      const piece = deps.getPiece();
      if (!piece) return;
      const { beat } = rollPos(e);
      const i = barIndexAt(beat, piece.plan.meterNum, piece.totalBars);
      const next = i >= 0 ? i : null;
      if (next !== hoverBar) { hoverBar = next; drawRoll(); }
    });
    deps.els.roll.addEventListener('pointerleave', () => { if (hoverBar != null) { hoverBar = null; drawRoll(); } });
    deps.els.roll.addEventListener('dblclick', (e) => {
      const piece = deps.getPiece();
      if (!piece || deps.playing()) return;
      const { beat, pitch } = rollPos(e);
      const hit = noteAt(beat, pitch);
      if (!hit) return;
      snapBefore = JSON.stringify(piece.notes);
      piece.notes.splice(piece.notes.indexOf(hit), 1);
      commit();
    });
  }

  return { bind: bindRoll, bindVel: bindVelLane, draw: drawRoll, drawVel: drawVelLane, invalidate };
}
