// music.js — 乐理内核 + 曲风预设。零依赖，全部纯函数。
// 约定：midi 60 = C4；keyPc ∈ 0..11（0=C）；"major/minor" 指自然大调/自然小调（和声借用由和弦候选处理）。

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function midiName(m) {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonicMajor: [0, 2, 4, 7, 9],   // 宫调式
  pentatonicMinor: [0, 3, 5, 7, 10],  // 羽调式
};

// 和弦形状：音程表（半音）
export const CHORD_SHAPES = {
  '': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
  '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11], 'm7b5': [0, 3, 6, 10],
  '9': [0, 4, 7, 10, 14], 'm9': [0, 3, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14],
  '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], 'sus4': [0, 5, 7], '7sus4': [0, 5, 7, 10],
  'add9': [0, 4, 7, 14],
};

// 罗马数字 → { rootPc, shape }。规则：大写=大三/属系，小写=小三系；
// 后缀 maj9/maj7/m7b5/m9/m7/7sus4/sus4/add9/7/9/6/o/ø；b/# 变音记号。
// 池子里允许写空格（如 'ii m7b5'、'V 7sus4'），统一去掉再解析。
const ROMAN_RE = /^(#|b)?([ivIV]+)(maj9|maj7|m7b5|m9|m7|7sus4|sus4|add9|7|9|6|o|ø)?$/;
const DEGREE_SEMI = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };

export function parseRoman(rawSym) {
  const sym = String(rawSym).trim().replace(/\s+/g, '');
  const m = ROMAN_RE.exec(sym);
  if (!m) return null;
  const [, acc, roman, suffix = ''] = m;
  const base = DEGREE_SEMI[roman.toLowerCase()];
  let root = base + (acc === 'b' ? -1 : acc === '#' ? 1 : 0);
  root = ((root % 12) + 12) % 12;
  const upper = roman === roman.toUpperCase();
  let shape;
  switch (suffix) {
    case 'o': shape = 'dim'; break;
    case 'ø': shape = 'm7b5'; break;
    case 'maj7': shape = 'maj7'; break;
    case 'maj9': shape = 'maj9'; break;
    case 'm7b5': shape = 'm7b5'; break;
    case 'm9': shape = 'm9'; break;
    case 'm7': shape = 'm7'; break;
    case '7sus4': shape = '7sus4'; break;
    case 'sus4': shape = 'sus4'; break;
    case 'add9': shape = 'add9'; break;
    case '7': shape = upper ? '7' : 'm7'; break;
    case '9': shape = upper ? '9' : 'm9'; break;
    case '6': shape = upper ? '6' : 'm6'; break;
    default: shape = upper ? '' : 'm';
  }
  return { rootPc: root, shape };
}

export function chordLabel(rootPc, shape) {
  return NOTE_NAMES[rootPc] + (shape === '' ? '' : shape);
}

/** 某和弦的全部音级（pc 集合） */
export function chordPcs(rootPc, shape) {
  return (CHORD_SHAPES[shape] || CHORD_SHAPES['']).map((i) => (rootPc + i) % 12);
}

/** 音阶内全部 midi（[low, high]） */
export function scaleMidis(keyPc, mode, low, high) {
  const set = SCALES[mode] || SCALES.major;
  const out = [];
  for (let m = low; m <= high; m++) if (set.includes(((m - keyPc) % 12 + 12) % 12)) out.push(m);
  return out;
}

/** 和弦音 midi（[low, high]） */
export function chordMidis(rootPc, shape, low, high) {
  const pcs = chordPcs(rootPc, shape);
  const out = [];
  for (let m = low; m <= high; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

export function nearest(target, pool) {
  if (!pool.length) return target;
  let best = pool[0];
  for (const m of pool) if (Math.abs(m - target) < Math.abs(best - target)) best = m;
  return best;
}

/**
 * 左手声位：低音（36..47 的根音）+ 上三声部（48..64，优先色彩音）。
 * 返回 { bass, upper: [] }
 */
export function lhVoicing(rootPc, shape) {
  const bass = 36 + rootPc; // 36..47
  const intervals = (CHORD_SHAPES[shape] || CHORD_SHAPES['']).slice(1);
  const upper = intervals.slice(-3).map((i) => {
    let n = 48 + ((rootPc + i) % 12);
    if (shape === '' || shape === '6' || shape === 'sus4' || shape === 'add9') n += 12; // 三和弦上移一个八度更开阔
    return Math.min(n, 64);
  });
  return { bass, upper };
}

/* ============================ 曲风预设 ============================ */

// 节奏型：以 16 分音符为格的 onset 数组（4/4 一小节 16 格，3/4 为 12 格）。
// tier: 0 稀疏 / 1 中等 / 2 密集。
const R44 = {
  sparse: [
    { on: [0], tier: 0 }, { on: [0, 8], tier: 0 }, { on: [0, 10], tier: 0 },
    { on: [0, 6], tier: 0 }, { on: [0, 4, 12], tier: 0 }, { on: [8], tier: 0 },
  ],
  mid: [
    { on: [0, 4, 8, 12], tier: 1 }, { on: [0, 3, 6, 10, 12], tier: 1 },
    { on: [0, 4, 6, 8, 12], tier: 1 }, { on: [0, 2, 4, 8, 10, 12], tier: 1 },
    { on: [0, 6, 8, 14], tier: 1 }, { on: [2, 4, 8, 12, 14], tier: 1 },
  ],
  dense: [
    { on: [0, 2, 4, 6, 8, 10, 12, 14], tier: 2 }, { on: [0, 2, 3, 4, 6, 8, 10, 12, 14], tier: 2 },
    { on: [0, 1, 2, 4, 6, 8, 9, 12, 14], tier: 2 }, { on: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15], tier: 2 },
  ],
};
const R34 = {
  sparse: [{ on: [0], tier: 0 }, { on: [0, 6], tier: 0 }, { on: [0, 8], tier: 0 }, { on: [4], tier: 0 }],
  mid: [{ on: [0, 4, 8], tier: 1 }, { on: [0, 3, 6, 10], tier: 1 }, { on: [0, 4, 6, 8], tier: 1 }, { on: [2, 4, 8, 10], tier: 1 }],
  dense: [{ on: [0, 2, 4, 6, 8, 10], tier: 2 }, { on: [0, 1, 2, 4, 6, 7, 8, 10], tier: 2 }, { on: [0, 2, 3, 4, 6, 8, 9, 10], tier: 2 }],
};

/** 按拍号取节奏池（16 分格 onset 数组） */
export const RHYTHM_POOLS = { 4: R44, 3: R34 };

export const LH_DEFS = {
  block: 'block chords: sustained chord on beat 1, bass root below',
  ballad: 'ballad: bass root on beat 1, mid chord on beat 3',
  alberti: 'alberti bass: rolling low-high-mid-high eighths, classical style',
  arp: 'broken-chord arpeggio in even eighths, flowing',
  broken: 'gentle 16th broken chord, soft and wide',
  waltz: 'waltz: bass on 1, chords on 2 and 3 (3/4)',
  shell: 'jazz shell: root+7th voicing on 1 and 3, laid back',
  stride: 'stride: alternating bass root/fifth and offbeat chords, swinging',
  walk: 'walking bass: quarter notes moving through chord tones (jazz)',
  octave: 'octave pulse: root octaves on eighth notes, driving',
  pad: 'long sustained pad chord for the whole bar, ambient',
};

/**
 * 曲风预设。
 * meters 允许的拍号；bpm 区间；modes 可用调式；
 * progs[mode] 是罗马数字进行池（每条 4 和弦，循环填充）；
 * lh 左手织体候选；density 旋律密度基线；swing 摇摆量；brightness 音色亮度；rh 低音区。
 */
export const STYLES = [
  {
    id: 'classical', name: '古典 · 优雅', desc: 'Alberti 低音， clarity 优先，如小奏鸣曲',
    meters: ['4/4'], bpm: [84, 116], modes: ['major', 'dorian'],
    progs: {
      major: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'V', 'I'], ['I', 'vi', 'ii', 'V'], ['I', 'V', 'IV', 'I']],
      dorian: [['i', 'IV', 'i', 'v'], ['i', 'III', 'IV', 'iv']],
    },
    lh: ['alberti', 'arp', 'block'], density: 0.45, swing: 0, brightness: 0.55,
  },
  {
    id: 'romantic', name: '浪漫 · 抒情', desc: '歌唱性旋律，分解和弦如夜曲',
    meters: ['4/4'], bpm: [58, 80], modes: ['minor', 'major'],
    progs: {
      minor: [['i', 'bVI', 'bIII', 'bVII'], ['i', 'iv', 'V', 'i'], ['i', 'bVII', 'iv', 'i'], ['i', 'bVI', 'iv', 'V']],
      major: [['I', 'vi', 'IV', 'V'], ['I', 'IV', 'vi', 'V']],
    },
    lh: ['arp', 'block', 'broken'], density: 0.4, swing: 0, brightness: 0.4,
  },
  {
    id: 'jazz', name: '爵士 · 摇摆', desc: 'ii-V-I，七九和弦，shell 与 walking bass',
    meters: ['4/4'], bpm: [88, 132], modes: ['major', 'minor'],
    progs: {
      major: [['Imaj7', 'vi7', 'ii7', 'V7'], ['iii7', 'vi7', 'ii7', 'V7'], ['Imaj7', 'IVmaj7', 'iii7', 'vi7'], ['ii7', 'V7', 'Imaj7', 'VImaj7']],
      minor: [['ii m7b5', 'V7', 'i m9', 'iv m7'], ['i m9', 'iv m7', 'bVII7', 'bVImaj7']],
    },
    lh: ['shell', 'stride', 'walk'], density: 0.5, swing: 0.3, brightness: 0.5,
  },
  {
    id: 'pop', name: '流行 · 抒情', desc: 'I-V-vi-IV 骨架，琶音推进，副歌上扬',
    meters: ['4/4'], bpm: [70, 104], modes: ['major', 'minor'],
    progs: {
      major: [['I', 'V', 'vi', 'IV'], ['vi', 'IV', 'I', 'V'], ['I', 'vi', 'IV', 'V']],
      minor: [['i', 'bVI', 'bIII', 'bVII'], ['i', 'bVII', 'bVI', 'bVII']],
    },
    lh: ['arp', 'block', 'octave'], density: 0.5, swing: 0, brightness: 0.5,
  },
  {
    id: 'lofi', name: 'Lo-Fi · 慢摇', desc: 'maj7/9 色彩，摇摆八分，雨窗氛围',
    meters: ['4/4'], bpm: [62, 80], modes: ['major', 'dorian', 'minor'],
    progs: {
      major: [['Imaj9', 'vi m9', 'ii m9', 'V 7sus4'], ['Imaj7', 'IVmaj7', 'vi m7', 'V7'], ['iii m7', 'vi m9', 'ii m9', 'V 7']],
      dorian: [['i m9', 'IV 9', 'i m7', 'v 7']],
      minor: [['i m9', 'iv m9', 'bVII 9', 'bVImaj7']],
    },
    lh: ['broken', 'block', 'arp'], density: 0.35, swing: 0.28, brightness: 0.3,
  },
  {
    id: 'newage', name: '新世纪 · 空灵', desc: '长音 pad 与宽琶音，如星空与水面',
    meters: ['4/4'], bpm: [60, 84], modes: ['major', 'minor', 'pentatonic'],
    progs: {
      major: [['I', 'IV', 'I', 'V'], ['I', 'iii', 'IV', 'I'], ['IV', 'I', 'V', 'IV']],
      minor: [['i', 'bVII', 'bVI', 'bVII'], ['i', 'bVI', 'bIII', 'bVII']],
      pentatonic: [['I', 'bVII', 'IV', 'I'], ['i', 'bVII', 'i', 'bVI']],
    },
    lh: ['pad', 'broken', 'arp'], density: 0.3, swing: 0, brightness: 0.45,
  },
  {
    id: 'waltz', name: '圆舞曲', desc: '3/4 蓬-嚓-嚓，旋转的舞蹈感',
    meters: ['3/4'], bpm: [92, 138], modes: ['major', 'minor'],
    progs: {
      major: [['I', 'I', 'V', 'V'], ['I', 'IV', 'V', 'I'], ['I', 'vi', 'IV', 'V'], ['I', 'V', 'I', 'IV']],
      minor: [['i', 'iv', 'V', 'i'], ['i', 'bVI', 'iv', 'V']],
    },
    lh: ['waltz', 'block'], density: 0.45, swing: 0, brightness: 0.5,
  },
  {
    id: 'oriental', name: '东方 · 五声', desc: '宫/羽五声，四五度叠置，留白如水墨',
    meters: ['4/4'], bpm: [66, 100], modes: ['pentatonic'],
    progs: {
      pentatonic: [['I', 'bVII', 'I', 'V'], ['i', 'bVI', 'bIII', 'bVII'], ['I', 'vi', 'IV', 'I'], ['i', 'bVII', 'iv', 'i']],
    },
    lh: ['octave', 'block', 'arp'], density: 0.4, swing: 0, brightness: 0.55,
  },
];

export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s]));

/** 从关键词推断风格/调式/弧线的简易映射（LLM 不可用时的兜底） */
const KEYWORD_HINTS = [
  { re: /雨|rain|夜|night|lonely|孤|泪|tear/i, style: 'romantic', mode: 'minor', arc: 'fall', mood: ['rainy', 'melancholy'] },
  { re: /星|star|梦|dream|云|cloud|仙/i, style: 'newage', mode: 'major', arc: 'arch', mood: ['dreamy', 'floating'] },
  { re: /咖啡|cafe|慢|slow|懒|lazy|雨窗|黄昏|dusk/i, style: 'lofi', mode: 'major', arc: 'flat', mood: ['cosy', 'hazy'] },
  { re: /爵士|jazz|蓝调|blues|摇摆|swing|酒吧|bar\b/i, style: 'jazz', mode: 'major', arc: 'arch', mood: ['smoky', 'groovy'] },
  { re: /战斗|战|燃|epic|英雄|hero|龙|dragon|江湖/i, style: 'oriental', mode: 'pentatonic', arc: 'rise', mood: ['heroic', 'flowing'] },
  { re: /欢|喜|happy|阳光|sun|春|spring|节|庆典|fest/i, style: 'classical', mode: 'major', arc: 'rise', mood: ['bright', 'playful'] },
  { re: /海|sea|ocean|溪|stream|林|forest|风|wind/i, style: 'newage', mode: 'pentatonic', arc: 'flat', mood: ['serene', 'wide'] },
  { re: /雪|snow|冬|winter|月光|moon/i, style: 'romantic', mode: 'minor', arc: 'arch', mood: ['still', 'silver'] },
  { re: /思念|miss|回忆|memory|故乡|home|farewell|离别/i, style: 'pop', mode: 'minor', arc: 'arch', mood: ['nostalgic', 'tender'] },
  { re: /童话|fairy|舞|dance|旋转|waltz/i, style: 'waltz', mode: 'major', arc: 'arch', mood: ['whirling', 'graceful'] },
];

const TITLE_MOODS = ['雨夜', '星光', '微风', '蓝色', '清晨', '午后', '远方', '旧梦', '巷口', '暖冬', '潮汐', '萤火'];
const TITLE_KINDS = ['即兴曲', '小夜曲', '圆舞曲', '随想曲', '练习曲', '叙事曲', '前奏曲', '小品'];

/** 关键词兜底：返回 plan 片段 */
export function keywordPlan(text, rng) {
  const hit = KEYWORD_HINTS.find((h) => h.re.test(text));
  const style = hit ? STYLE_BY_ID[hit.style] : STYLE_BY_ID[STYLES[Math.floor(rng() * STYLES.length)].id];
  const mode = hit ? hit.mode : style.modes[Math.floor(rng() * style.modes.length)];
  const arc = hit ? hit.arc : ['flat', 'rise', 'arch', 'fall'][Math.floor(rng() * 4)];
  const mood = hit ? hit.mood : ['gentle', 'wandering'];
  const bpm = Math.round(style.bpm[0] + rng() * (style.bpm[1] - style.bpm[0]));
  return {
    styleId: style.id,
    mode,
    arc,
    mood,
    bpm,
    swing: style.swing,
    density: style.density,
    brightness: style.brightness,
    title: `${TITLE_MOODS[Math.floor(rng() * TITLE_MOODS.length)]}${TITLE_KINDS[Math.floor(rng() * TITLE_KINDS.length)]}`,
    notes: '',
    source: 'keyword',
  };
}
