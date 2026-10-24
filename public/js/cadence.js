// cadence.js — 终止式识别（分析层，只读已生成的小节，不参与决策；轮次 55）。
// Kostka-Payne 口径：终止式是**乐句末**的和声进行，判据用决策层已有的功能归因（fn）+ 根音运动：
//   完全终止 authentic：V→I（fn D→T 且根音下行五度）
//   变格终止 plagal：  IV→I（fn S→T 且根音上行四度）
//   阻碍终止 deceptive：V→vi / V→VI（fn D→Tp 且根音下行三度）
//   半终止 half：      乐句收在自己的属和弦上（fn D 收尾，不看前一拍）
// 只有功能归因而根音不动的（如 V→V、同功能对置）不构成终止式——
// 终止感一半来自功能到位，一半来自「低音真的走了」。

export const CADENCE_ZH = { authentic: '完全终止', plagal: '变格终止', deceptive: '阻碍终止', half: '半终止' };

const pcOf = (x) => (Number.isFinite(x?.rootPc) ? ((x.rootPc % 12) + 12) % 12 : null);

/** 两个相邻小节的和弦是否构成终止式（纯进行判据，不含乐句位置）。返回 type 或 null。 */
export function cadenceAt(prev, cur) {
  const a = pcOf(prev), b = pcOf(cur);
  if (a == null || b == null) return null;
  const d = (a - b + 12) % 12; // 根音运动（半音，模 12）：V(7)→I(0) 的 d=7，IV(5)→I(0) 的 d=5
  if (prev.fn === 'D') {
    if (cur.fn === 'T' && d === 7) return 'authentic';
    if (cur.fn === 'Tp' && (d === 10 || d === 11)) return 'deceptive'; // →vi（大调）或 →VI（小调）
  }
  if (prev.fn === 'S' && cur.fn === 'T' && d === 5) return 'plagal';
  return null;
}

/** barIndex 是乐句末小节时，识别「进入该小节」的终止式；否则 null。
 *  barChords 每小节一项（startBeat = bar×meterNum）；乐句长缺失时按 4 小节退化。 */
export function cadenceIntoBar(barChords, meterNum, barsPerPhrase, barIndex) {
  if (!Array.isArray(barChords) || !Number.isInteger(barIndex) || barIndex < 0 || barIndex >= barChords.length) return null;
  const phrase = Number(barsPerPhrase) || 4;
  if ((barIndex + 1) % phrase !== 0) return null;
  const cur = barChords[barIndex];
  const prev = barIndex > 0 ? barChords[barIndex - 1] : null;
  return cadenceAt(prev, cur) ?? (cur?.fn === 'D' ? 'half' : null);
}

/** 整曲扫描：[{ bar, type }]，只含乐句末小节。脏输入返回 []。 */
export function pieceCadences(barChords, meterNum, barsPerPhrase) {
  if (!Array.isArray(barChords)) return [];
  const out = [];
  for (let i = 0; i < barChords.length; i++) {
    const t = cadenceIntoBar(barChords, meterNum, barsPerPhrase, i);
    if (t) out.push({ bar: i, type: t });
  }
  return out;
}
