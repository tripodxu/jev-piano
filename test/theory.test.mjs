// theory.test.mjs — music.js 乐理内核与曲风预设的完整性校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRoman, chordMidis, chordPcs, lhVoicing, scaleMidis, nearest, chordLabel,
  STYLES, LH_DEFS, STYLE_BY_ID, keywordPlan,
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
