// theory.test.mjs — music.js 乐理内核与曲风预设的完整性校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoman, chordMidis, chordPcs, lhVoicing, scaleMidis, nearest, chordLabel, midiName,
  STYLES, LH_DEFS, STYLE_BY_ID, keywordPlan,
  HARMONIC_FUNCTIONS, functionOf, modePalette,
} from '../public/js/music.js';
import { mulberry32 } from './rng-shim.mjs';

test('parseRoman: 属七/大七/半减/变音/小九等后缀', () => {
  assert.deepEqual(parseRoman('V7'), { rootPc: 7, shape: '7' });
  assert.deepEqual(parseRoman('Imaj7'), { rootPc: 0, shape: 'maj7' });
  assert.deepEqual(parseRoman('ii m7b5'), { rootPc: 2, shape: 'm7b5' });   // 带空格（jazz minor 池）
  assert.deepEqual(parseRoman('bVI'), { rootPc: 8, shape: '' });
  assert.deepEqual(parseRoman('bVII'), { rootPc: 10, shape: '' });
  assert.deepEqual(parseRoman('vi7'), { rootPc: 9, shape: 'm7' });
  assert.deepEqual(parseRoman('V 7sus4'), { rootPc: 7, shape: '7sus4' });
  assert.deepEqual(parseRoman('i m9'), { rootPc: 0, shape: 'm9' });
  assert.deepEqual(parseRoman('ii m9'), { rootPc: 2, shape: 'm9' });
  assert.deepEqual(parseRoman('iii m7'), { rootPc: 4, shape: 'm7' });
  assert.deepEqual(parseRoman('bVII7'), { rootPc: 10, shape: '7' });
  assert.deepEqual(parseRoman('bVImaj7'), { rootPc: 8, shape: 'maj7' });
  assert.deepEqual(parseRoman('IV 9'), { rootPc: 5, shape: '9' });
});

test('chordMidis: Am 的音都在 {9,0,4} 且在音域内', () => {
  const ms = chordMidis(9, 'm', 60, 84);
  assert.ok(ms.length >= 5);
  for (const m of ms) {
    assert.ok(m >= 60 && m <= 84);
    assert.ok([9, 0, 4].includes(((m % 12) + 12) % 12));
  }
});

test('lhVoicing: bass 在 36..47，upper 三音在 48..64 且都是和弦音', () => {
  const v = lhVoicing(9, 'm7');
  assert.equal(((v.bass % 12) + 12) % 12, 9);
  assert.ok(v.bass >= 36 && v.bass <= 47);
  assert.equal(v.upper.length, 3);
  for (const n of v.upper) {
    assert.ok(n >= 48 && n <= 64, `upper ${n} out of 48..64`);
    assert.ok([9, 0, 4, 7].includes(((n % 12) + 12) % 12));
  }
});

test('scaleMidis: C 宫五声 60..84 共 11 音且 pc 正确', () => {
  const ms = scaleMidis(0, 'pentatonicMajor', 60, 84);
  assert.equal(ms.length, 11);
  for (const m of ms) assert.ok([0, 2, 4, 7, 9].includes(m % 12));
});

test('nearest', () => {
  assert.equal(nearest(66, [60, 62, 64, 67, 69]), 67);
  assert.equal(nearest(60, [62, 64]), 62);
});

test('chordLabel: 降号侧用降号拼写（C 小调的 bVI/bVII/bIII 必须是 Ab/Bb/Eb）', () => {
  assert.equal(chordLabel(0, ''), 'C');
  assert.equal(chordLabel(9, 'm7'), 'Am7');
  assert.equal(chordLabel(7, '7'), 'G7');
  // 核心三条：旧实现全部返回 G#/A#/D#，在 C 小调里是错的记谱
  assert.equal(chordLabel(8, ''), 'Ab', 'bVI 必须是 Ab');
  assert.equal(chordLabel(10, ''), 'Bb', 'bVII 必须是 Bb');
  assert.equal(chordLabel(3, ''), 'Eb', 'bIII 必须是 Eb');
  assert.equal(chordLabel(8, '7sus4'), 'Ab7sus4', '后缀跟着根名走');
  assert.equal(chordLabel(3, 'm7b5'), 'Ebm7b5', '半减后缀不丢');
  assert.equal(chordLabel(2, 'ø'), 'Dø', '半减记号保留');
});

test('chordLabel: 拼写表是 12 个音级的单射（不能两个音级同名）', () => {
  const names = [];
  for (let pc = 0; pc < 12; pc++) names.push(chordLabel(pc, ''));
  assert.equal(new Set(names).size, 12, `拼写表非单射: ${names.join(' ')}`);
});

test('midiName: 保持升号——它标的是琴键的物理键名，不是和声拼写', () => {
  assert.equal(midiName(60), 'C4');
  assert.equal(midiName(61), 'C#4', '琴键只有 C#，没有 Db');
  assert.equal(midiName(68), 'G#4', '琴键只有 G#，没有 Ab');
});

test('STYLES 完整性：所有进行可解析、bpm 有序、lh 有定义、拍号合理', () => {
  assert.ok(STYLES.length >= 8);
  for (const s of STYLES) {
    assert.ok(s.bpm[0] <= s.bpm[1], `${s.id} bpm 区间倒置`);
    for (const lh of s.lh) assert.ok(LH_DEFS[lh], `${s.id} 未知织体 ${lh}`);
    for (const mode of Object.keys(s.progs)) {
      for (const prog of s.progs[mode]) {
        for (const sym of prog) {
          const parsed = parseRoman(sym);
          assert.ok(parsed, `${s.id}/${mode} 无法解析: ${sym}`);
          assert.ok(typeof parsed.rootPc === 'number');
        }
      }
    }
  }
  assert.deepEqual(STYLE_BY_ID.waltz.meters, ['3/4']);
  for (const s of STYLES) if (s.id !== 'waltz') assert.ok(s.meters.includes('4/4'));
  // newage / oriental 声明 pentatonic 模式，必须有对应进行池
  for (const s of STYLES) for (const m of s.modes) assert.ok(s.progs[m], `${s.id} 缺少 ${m} 进行池`);
});

test('keywordPlan: 关键词命中返回合法计划片段', () => {
  const rng = mulberry32(42);
  const p = keywordPlan('雨夜的城市，一个人走在霓虹下', rng);
  assert.ok(STYLE_BY_ID[p.styleId]);
  assert.ok(Number.isInteger(p.bpm));
  const st = STYLE_BY_ID[p.styleId];
  assert.ok(p.bpm >= st.bpm[0] && p.bpm <= st.bpm[1]);
  assert.ok(p.title.length > 0);
  assert.ok(['flat', 'rise', 'arch', 'fall'].includes(p.arc));
  assert.ok(Array.isArray(p.mood) && p.mood.length >= 2);
});

/* ---------------- 和声功能层：功能分类与调式色板 ---------------- */

test('modePalette: 色板 = 调式音级的全部音级拼成的罗马数字（可被 parseRoman 解析）', () => {
  for (const mode of ['major', 'minor', 'dorian', 'mixolydian', 'pentatonicMajor', 'pentatonicMinor']) {
    const pal = modePalette(mode);
    assert.ok(pal.length >= 5, `${mode} 色板过少: ${pal.length}`);
    assert.equal(new Set(pal.map((p) => p.rootPc)).size, pal.length, `${mode} 色板有重复根音`);
    for (const c of pal) {
      assert.ok(parseRoman(c.sym), `${mode}/${c.sym} 不可解析`);
      assert.ok(HARMONIC_FUNCTIONS[c.fn], `${mode}/${c.sym} 功能 ${c.fn} 不在四功能内`);
    }
  }
  assert.equal(modePalette('major').length, 7, 'C 大调 7 个音级');
  assert.equal(modePalette('pentatonicMinor').length, 5, '五声 5 个音级');
});

test('functionOf: 功能和弦映射到 T/S/D/Tp', () => {
  assert.equal(functionOf('I', 'major'), 'T');
  assert.equal(functionOf('V', 'major'), 'D');
  assert.equal(functionOf('IV', 'major'), 'S');
  assert.equal(functionOf('ii', 'major'), 'S');
  assert.equal(functionOf('vi', 'major'), 'Tp');
  assert.equal(functionOf('i', 'minor'), 'T');
  assert.equal(functionOf('V', 'minor'), 'D');
  assert.equal(functionOf('iv', 'minor'), 'S');
  assert.equal(functionOf('bVI', 'minor'), 'Tp');
  assert.equal(functionOf('不是罗马数字', 'major'), null, '不可解析应返回 null');
});

test('functionOf 与 modePalette 自洽（色板每项的 fn 都等于 functionOf(sym)）', () => {
  for (const mode of ['major', 'minor', 'dorian', 'pentatonicMinor']) {
    for (const c of modePalette(mode)) {
      assert.equal(c.fn, functionOf(c.sym, mode), `${mode}/${c.sym} 功能不自洽`);
    }
  }
});

test('色板确实是进行池的上界扩充：romantic 小调色板根音多于其进行池', () => {
  const pools = STYLE_BY_ID.romantic.progs.minor;
  const poolRoots = new Set(pools.flat().map((s) => parseRoman(s).rootPc));
  const palRoots = new Set(modePalette('minor').map((c) => c.rootPc));
  assert.ok(palRoots.size > poolRoots.size, `色板 ${palRoots.size} 应多于池 ${poolRoots.size}`);
  for (const r of poolRoots) assert.ok(palRoots.has(r), `池里的根音 ${r} 必须也在色板中（不回归既有风格色彩）`);
});

test('sanitizeSections: LLM 段落校验严格，任一不合格即回退 null（交给模板派生）', async () => {
  const { sanitizeSections } = await import('../public/js/composer.js');
  assert.equal(sanitizeSections(null, 32), null);
  assert.equal(sanitizeSections('不是数组', 32), null);
  assert.equal(sanitizeSections([{ arc: 'arch', level: 1.5, bars: 16 }], 32), null, '只有 1 段');
  assert.equal(sanitizeSections([{ arc: '乱写', level: 1.5, bars: 16 }, { arc: 'flat', level: 1, bars: 16 }], 32), null, '非法 arc');
  assert.equal(sanitizeSections([{ arc: 'arch', level: 9, bars: 16 }, { arc: 'flat', level: 1, bars: 16 }], 32), null, 'level 越界');
  assert.equal(sanitizeSections([{ arc: 'arch', level: 1, bars: 16 }, { arc: 'flat', level: 1, bars: 16 }, { arc: 'x', level: 1, bars: 8 }], 32), null, '第三段非法则整体作废');
  // 合法输入：start 必须首尾相接、长度之和等于总长
  const ok = sanitizeSections([{ id: 'A', arc: 'flat', level: 1.2, bars: 16 }, { id: 'B', arc: 'rise', level: 2.4, bars: 16 }], 32);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].start, 0);
  assert.equal(ok[1].start, 16);
  assert.equal(ok.reduce((s, x) => s + x.bars, 0), 32);
  // 不给 bars 时应均分剩余（提示词可以只要求 id/arc/level）
  const even = sanitizeSections([{ id: 'A', arc: 'flat', level: 1.2 }, { id: 'B', arc: 'rise', level: 2.4 }], 32);
  assert.equal(even[0].bars, 16);
  assert.equal(even[1].bars, 16);
});

test('buildPlan: 总是带合法 sections（LLM 不可用时由模板派生）', async () => {
  const { buildPlan } = await import('../public/js/composer.js');
  for (const bars of [16, 32, 64]) {
    const plan = await buildPlan({ prompt: '雨夜的城市', goal: '随机冒险', styleId: 'random', seed: 5, bars }, {});
    assert.ok(Array.isArray(plan.sections) && plan.sections.length >= 2, `bars=${bars} 缺 sections`);
    assert.equal(plan.sections.reduce((s, x) => s + x.bars, 0), plan.totalBars, `bars=${bars} 段落长度之和应等于 totalBars`);
    for (const s of plan.sections) {
      assert.ok(['flat', 'rise', 'arch', 'fall'].includes(s.arc));
      assert.ok(s.level >= 0 && s.level <= 3);
    }
  }
});
