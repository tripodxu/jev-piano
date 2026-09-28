// theory.test.mjs — music.js 乐理内核与曲风预设的完整性校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoman, chordMidis, chordPcs, lhVoicing, scaleMidis, nearest, chordLabel,
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

test('chordLabel', () => {
  assert.equal(chordLabel(9, 'm7'), 'Am7');
  assert.equal(chordLabel(0, ''), 'C');
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
