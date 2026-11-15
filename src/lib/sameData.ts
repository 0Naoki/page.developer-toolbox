/** 比べる入れ子の深さの上限。これより深い値は「違う」とする（計算し直すだけで、古い結果は返さない） */
const MAX_DEPTH = 32;

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * 2つの値が、同じ計算の入力として同じかを確かめる（計算の要求・非同期の計算の key を、作り直されても同じ値として扱うため）。
 *
 * @remarks
 * 配列と普通のオブジェクト（`{}` で作ったもの）は中身を比べ、それ以外（文字列・数・Uint8Array・クラスのインスタンスなど）は
 * `Object.is` で比べる。中身を比べない値は、参照が違えば「違う」とするので、同じとみなすのは、末端の値がすべて同じときだけ
 * （同じ入力に対する計算だと確かに言えるときだけ）。間違えて「違う」とするのは計算をやり直すだけで、古い結果は返さない。
 * 文字列は参照が同じなら長さに依らずすぐに比べ終わる。
 */
export function sameData(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || depth >= MAX_DEPTH) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i], depth + 1)) return false;
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1)) return false;
  }
  return true;
}
