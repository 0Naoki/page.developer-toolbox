/**
 * 進数変換・ビット演算。
 * 64ビットを超える値も正確に扱えるよう、整数はすべて BigInt で計算する。
 */
import { formatNumber } from '../../lib/number';

export type Base = 2 | 8 | 10 | 16;
/** ビット幅。0 は制限なし（2の補数やバイト順は扱わない） */
export type Width = 0 | 8 | 16 | 32 | 64;

export const BASES: Base[] = [2, 8, 10, 16];
export const BASE_NAMES: Record<Base, string> = { 2: '2進数', 8: '8進数', 10: '10進数', 16: '16進数' };

/** これを超える桁数は、変換や表示に時間がかかるため受け付けない */
export const MAX_DIGITS = 4096;

const PREFIX_BASE: Record<string, Base> = { '0b': 2, '0o': 8, '0x': 16 };
/** BigInt() に渡すときの接頭辞 */
const BASE_PREFIX: Record<Exclude<Base, 10>, string> = { 2: '0b', 8: '0o', 16: '0x' };
const DIGITS: Record<Base, RegExp> = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/i };

/**
 * 整数の文字列を読む。0x・0b・0o の接頭辞があればその進数として読み、なければ base で読む。
 * 区切りの空白と _（10進数ではカンマも）は無視する。
 */
export function parseInteger(input: string, base: Base): { value: bigint; base: Base } {
  let s = input.trim().replace(base === 10 ? /[\s_,]/g : /[\s_]/g, '');
  if (s === '') throw new Error('数値を入力してください');
  let negative = false;
  if (s[0] === '-' || s[0] === '+') {
    negative = s[0] === '-';
    s = s.slice(1);
  }
  let actual = base;
  const prefix = PREFIX_BASE[s.slice(0, 2).toLowerCase()];
  /** 16進数では「0B12」の B も数字なので、0b を2進数の接頭辞として読まない（0x だけを受け付ける） */
  if (prefix && !(base === 16 && prefix === 2)) {
    actual = prefix;
    s = s.slice(2);
  }
  if (s === '') throw new Error('数値を入力してください');
  if (!DIGITS[actual].test(s)) {
    const bad = [...s].find((c) => !DIGITS[actual].test(c))!;
    throw new Error(`${BASE_NAMES[actual]}に使えない文字「${bad}」があります`);
  }
  if (s.length > MAX_DIGITS) throw new Error(`桁数が多すぎます（${formatNumber(MAX_DIGITS)}桁まで）`);
  const abs = BigInt(actual === 10 ? s : `${BASE_PREFIX[actual]}${s}`);
  return { value: negative ? -abs : abs, base: actual };
}

/** 2の整数乗（BigInt）。浮動小数点の内部表現（float.ts）のビット列の組み立てでも使う */
export const pow2 = (n: number) => 1n << BigInt(n);

/** ビット幅に収まる範囲（符号付きの最小値 〜 符号なしの最大値） */
function rangeOf(width: Exclude<Width, 0>): { min: bigint; max: bigint } {
  return { min: -pow2(width - 1), max: pow2(width) - 1n };
}

/**
 * 値をビット幅の符号なしの値（ビット列そのもの）にする。負の値は2の補数として扱う。
 * 幅が 0（制限なし）のときはそのまま返す
 */
export function toUnsigned(value: bigint, width: Width): bigint {
  if (width === 0) return value;
  const { min, max } = rangeOf(width);
  if (value < min || value > max) throw new Error(`${width}ビットに収まりません（${min} 〜 ${max}）`);
  return value < 0n ? value + pow2(width) : value;
}

/** ビット列を符号付き（2の補数）として読んだ値 */
export function toSigned(unsigned: bigint, width: Exclude<Width, 0>): bigint {
  return unsigned >= pow2(width - 1) ? unsigned - pow2(width) : unsigned;
}

/** 右から size 桁ずつ空白で区切る */
function groupDigits(digits: string, size: number): string {
  const out: string[] = [];
  for (let end = digits.length; end > 0; end -= size) out.unshift(digits.slice(Math.max(0, end - size), end));
  return out.join(' ');
}

/**
 * 表示用の文字列。ビット幅があれば、2進数は幅いっぱいに、16進数は幅の 1/4 桁に0で埋める。
 * 2進数・16進数は4桁、8進数は3桁ごとに空白で、10進数は3桁ごとにカンマで区切る
 */
export function formatInteger(value: bigint, base: Base, width: Width): string {
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString(base);
  if (width > 0 && base === 2) digits = digits.padStart(width, '0');
  if (width > 0 && base === 16) digits = digits.padStart(width / 4, '0');
  if (base === 16) digits = digits.toUpperCase();
  const size = base === 10 || base === 8 ? 3 : 4;
  const grouped = base === 10 ? groupDigits(digits, size).replace(/ /g, ',') : groupDigits(digits, size);
  return (negative ? '-' : '') + grouped;
}

/** 入力欄に戻すときの文字列（区切りなし。読み直しても同じ値になる） */
export const plainInteger = (value: bigint, base: Base): string =>
  (value < 0n ? '-' : '') + (value < 0n ? -value : value).toString(base).toUpperCase();

/** バイト列（16進数2桁ずつ）。ビッグエンディアン（上位バイトが先） */
export function bytesOf(unsigned: bigint, width: Exclude<Width, 0>): string[] {
  const bytes: string[] = [];
  for (let i = width / 8 - 1; i >= 0; i--) {
    bytes.push(Number((unsigned >> BigInt(i * 8)) & 0xffn).toString(16).toUpperCase().padStart(2, '0'));
  }
  return bytes;
}

/** i 番目のビット（0 が最下位）を反転する */
export const toggleBit = (unsigned: bigint, i: number): bigint => unsigned ^ pow2(i);

/** ビット演算 */

export type BitOp = 'and' | 'or' | 'xor' | 'not' | 'shl' | 'shr' | 'ushr';

export const OP_LABELS: Record<BitOp, string> = {
  and: 'AND',
  or: 'OR',
  xor: 'XOR',
  not: 'NOT',
  shl: '<<',
  shr: '>>',
  ushr: '>>>',
};

/** シフト量の上限（BigInt は大きなシフトでもそのまま計算するため、画面が固まらないよう制限する） */
export const MAX_SHIFT = 4096;

/**
 * ビット演算の結果。ビット幅があれば、結果は幅の符号なしの値（ビット列）にする。
 * - \<\< は上位にあふれたビットを捨てる
 * - \>\> は算術シフト（符号を保つ）、\>\>\> は論理シフト（上位を0で埋める。幅の指定が必要）
 * - 幅が 0（制限なし）のときは、BigInt と同じく無限に続く2の補数として計算する（NOT x = -x - 1）
 */
export function bitOp(op: BitOp, a: bigint, b: bigint, width: Width): bigint {
  const A = toUnsigned(a, width);
  const isShift = op === 'shl' || op === 'shr' || op === 'ushr';
  if (isShift && (b < 0n || b > BigInt(MAX_SHIFT))) throw new Error(`シフト量は 0 〜 ${formatNumber(MAX_SHIFT)} で指定してください`);
  const B = isShift ? b : op === 'not' ? 0n : toUnsigned(b, width);
  const mask = width === 0 ? null : pow2(width) - 1n;
  const fit = (v: bigint) => (mask === null ? v : v & mask);
  switch (op) {
    case 'and':
      return A & B;
    case 'or':
      return A | B;
    case 'xor':
      return A ^ B;
    case 'not':
      return fit(~A);
    case 'shl':
      return fit(A << B);
    case 'shr':
      return width === 0 ? A >> B : toUnsigned(toSigned(A, width) >> B, width);
    case 'ushr':
      if (width === 0) throw new Error('>>> はビット幅を指定したときだけ使えます');
      return A >> B;
  }
}
