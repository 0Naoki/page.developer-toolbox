/**
 * 列（行・文字）の差分の計算（Myers 法）。テキストに依存しない。
 * 行・文字の差分を作る処理は logic.ts、画面に並べる行の処理は rows.ts にある。
 */

export type DiffOp =
  | { type: 'equal'; a: number; b: number }
  | { type: 'delete'; a: number }
  | { type: 'insert'; b: number };

export type DiffLimit = {
  /** この時間（ミリ秒）を超えたら、残りは「まとめて削除→追加」にして打ち切る（結果は正しいが最短とは限らない） */
  timeoutMs?: number;
};

type Budget = { deadline: number; timedOut: boolean };

/**
 * Myers の差分アルゴリズムで、最短の編集手順を求める。
 *
 * 線形メモリ版（論文 4b 節の「middle snake」で問題を二分する方式）を使う。
 * 計算量は O((N+M)D) のまま、メモリは O(N+M) で済むため、大きく異なる長いテキストでもブラウザが落ちない。
 * 比較を速くするため、要素は先に整数のIDに置き換える。
 */
export function diffSequencesWithStatus<T>(
  a: readonly T[],
  b: readonly T[],
  limit: DiffLimit = {},
): { ops: DiffOp[]; timedOut: boolean } {
  const budget: Budget = { deadline: performance.now() + (limit.timeoutMs ?? Infinity), timedOut: false };
  const ids = new Map<T, number>();
  const toId = (x: T) => {
    let v = ids.get(x);
    if (v === undefined) {
      v = ids.size;
      ids.set(x, v);
    }
    return v;
  };
  const A = Int32Array.from(a, toId);
  const B = Int32Array.from(b, toId);

  /**
   * 片方にしかない要素は必ず削除か追加になるため、除いてから比べても最短の手順は変わらない。
   * 変更行が多いテキストでも探索が短くなり、時間切れで全行が「変更」になるのを防ぐ。
   */
  const inA = new Uint8Array(ids.size);
  const inB = new Uint8Array(ids.size);
  for (const x of A) inA[x] = 1;
  for (const x of B) inB[x] = 1;
  const keptA: number[] = [];
  const keptB: number[] = [];
  /**
   * 以下の添字（i・j・keptA・keptB の値）は、どれも配列の範囲内。数十万行で呼ぶため、?? の分岐を足さずに ! で示す
   */
  for (let i = 0; i < A.length; i++) if (inB[A[i]!] === 1) keptA.push(i);
  for (let j = 0; j < B.length; j++) if (inA[B[j]!] === 1) keptB.push(j);
  const matched: DiffOp[] = [];
  diffRange(Int32Array.from(keptA, (i) => A[i]!), 0, keptA.length, Int32Array.from(keptB, (j) => B[j]!), 0, keptB.length, matched, budget);

  /** 一致した組を元の位置に戻す。その間の要素は、すべて削除か追加になる。 */
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const fillUntil = (aEnd: number, bEnd: number) => {
    while (i < aEnd) ops.push({ type: 'delete', a: i++ });
    while (j < bEnd) ops.push({ type: 'insert', b: j++ });
  };
  for (const op of matched) {
    if (op.type !== 'equal') continue;
    fillUntil(keptA[op.a]!, keptB[op.b]!);
    ops.push({ type: 'equal', a: i++, b: j++ });
  }
  fillUntil(A.length, B.length);
  return { ops, timedOut: budget.timedOut };
}

function diffRange(
  A: Int32Array,
  aLo: number,
  aHi: number,
  B: Int32Array,
  bLo: number,
  bHi: number,
  ops: DiffOp[],
  budget: Budget,
) {
  /** 先頭と末尾の共通部分は先に取り除く */
  while (aLo < aHi && bLo < bHi && A[aLo] === B[bLo]) ops.push({ type: 'equal', a: aLo++, b: bLo++ });
  let suffix = 0;
  while (aHi - suffix > aLo && bHi - suffix > bLo && A[aHi - 1 - suffix] === B[bHi - 1 - suffix]) suffix++;
  const aEnd = aHi - suffix;
  const bEnd = bHi - suffix;

  const replaceAll = () => {
    for (let i = aLo; i < aEnd; i++) ops.push({ type: 'delete', a: i });
    for (let j = bLo; j < bEnd; j++) ops.push({ type: 'insert', b: j });
  };

  if (aLo === aEnd || bLo === bEnd) {
    replaceAll();
  } else {
    const mid = middleSnake(A, aLo, aEnd, B, bLo, bEnd, budget);
    const stuck = mid === null || (mid.x === aLo && mid.y === bLo) || (mid.x === aEnd && mid.y === bEnd);
    if (stuck) {
      replaceAll();
    } else {
      diffRange(A, aLo, mid.x, B, bLo, mid.y, ops, budget);
      diffRange(A, mid.x, aEnd, B, mid.y, bEnd, ops, budget);
    }
  }
  for (let i = 0; i < suffix; i++) ops.push({ type: 'equal', a: aEnd + i, b: bEnd + i });
}

/**
 * 前からと後ろからの探索が重なる点（middle snake）を求め、そこで問題を二分する。
 * diff-match-patch の bisect と同じ手順。
 */
function middleSnake(
  A: Int32Array,
  aLo: number,
  aHi: number,
  B: Int32Array,
  bLo: number,
  bHi: number,
  budget: Budget,
): { x: number; y: number } | null {
  if (budget.timedOut) return null;
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const off = maxD;
  const size = 2 * maxD + 2;
  /**
   * v1・v2 の添字（k1o・k2o とその前後）は、Myers 法で 0〜size-1 に収まる。最も重いループなので、
   * ?? の分岐を足さずに ! で示す
   */
  const v1 = new Int32Array(size).fill(-1);
  const v2 = new Int32Array(size).fill(-1);
  v1[off + 1] = 0;
  v2[off + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;

  for (let d = 0; d < maxD; d++) {
    if ((d & 31) === 0 && performance.now() > budget.deadline) {
      budget.timedOut = true;
      return null;
    }
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1o = off + k1;
      let x1 = k1 === -d || (k1 !== d && v1[k1o - 1]! < v1[k1o + 1]!) ? v1[k1o + 1]! : v1[k1o - 1]! + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && A[aLo + x1] === B[bLo + y1]) {
        x1++;
        y1++;
      }
      v1[k1o] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2o = off + delta - k1;
        if (k2o >= 0 && k2o < size && v2[k2o] !== -1 && x1 >= n - v2[k2o]!) return { x: aLo + x1, y: bLo + y1 };
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2o = off + k2;
      let x2 = k2 === -d || (k2 !== d && v2[k2o - 1]! < v2[k2o + 1]!) ? v2[k2o + 1]! : v2[k2o - 1]! + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && A[aHi - x2 - 1] === B[bHi - y2 - 1]) {
        x2++;
        y2++;
      }
      v2[k2o] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1o = off + delta - k2;
        if (k1o >= 0 && k1o < size && v1[k1o] !== -1) {
          const x1 = v1[k1o]!;
          const y1 = off + x1 - k1o;
          if (x1 >= n - x2) return { x: aLo + x1, y: bLo + y1 };
        }
      }
    }
  }
  return null;
}
