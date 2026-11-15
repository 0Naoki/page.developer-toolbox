import { formatNumber } from '../../lib/number';
/** IEEE754 の丸め・四則演算・内部表現。整数の進数変換とは独立して扱う。 */


/** ビット列の組み立てで使う2の整数乗。 */
const pow2 = (n: number) => 1n << BigInt(n);

export type Precision = 32 | 64;

const FORMAT: Record<Precision, { exp: number; mant: number; bias: number }> = {
  32: { exp: 8, mant: 23, bias: 127 },
  64: { exp: 11, mant: 52, bias: 1023 },
};

export type FloatKind = '正規化数' | '非正規化数' | 'ゼロ' | '無限大' | 'NaN';

export type FloatParts = {
  /** この精度に丸めた値 */
  value: number;
  sign: 0 | 1;
  exponentBits: string;
  mantissaBits: string;
  hex: string;
  kind: FloatKind;
  /** 指数（バイアスを引いた値）。ゼロ・無限大・NaN は null */
  exponent: number | null;
  /** 実際に格納されている値を10進数で正確に表したもの（NaN・無限大は null） */
  exact: string | null;
};

/** 値をこの精度の浮動小数点数に丸める */
const roundTo = (x: number, precision: Precision) => (precision === 32 ? Math.fround(x) : x);

/** N × 2^pow を10進数で正確に書く（2のべき乗で割った値は、必ず有限桁の10進数になる） */
function exactDecimal(n: bigint, pow: number): string {
  if (pow >= 0) return (n << BigInt(pow)).toString();
  const k = -pow;
  const digits = (n * 5n ** BigInt(k)).toString().padStart(k + 1, '0');
  const int = digits.slice(0, -k);
  const frac = digits.slice(-k).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** 浮動小数点数を、符号部・指数部・仮数部に分ける */
export function floatParts(x: number, precision: Precision): FloatParts {
  const { exp, mant, bias } = FORMAT[precision];
  const view = new DataView(new ArrayBuffer(8));
  let bits: bigint;
  if (precision === 32) {
    view.setFloat32(0, x);
    bits = BigInt(view.getUint32(0));
  } else {
    view.setFloat64(0, x);
    bits = view.getBigUint64(0);
  }
  const total = 1 + exp + mant;
  const binary = bits.toString(2).padStart(total, '0');
  const sign = binary[0] === '1' ? 1 : 0;
  const e = Number((bits >> BigInt(mant)) & (pow2(exp) - 1n));
  const m = bits & (pow2(mant) - 1n);
  const maxExp = 2 ** exp - 1;

  let kind: FloatKind;
  let exponent: number | null = null;
  let exact: string | null = null;
  if (e === maxExp) {
    kind = m === 0n ? '無限大' : 'NaN';
  } else if (e === 0) {
    kind = m === 0n ? 'ゼロ' : '非正規化数';
    if (m !== 0n) exponent = 1 - bias;
    exact = exactDecimal(m, 1 - bias - mant);
  } else {
    kind = '正規化数';
    exponent = e - bias;
    exact = exactDecimal(m + pow2(mant), e - bias - mant);
  }
  if (exact !== null && sign) exact = `-${exact}`;

  return {
    value: precision === 32 ? view.getFloat32(0) : view.getFloat64(0),
    sign,
    exponentBits: binary.slice(1, 1 + exp),
    mantissaBits: binary.slice(1 + exp),
    hex: bits.toString(16).toUpperCase().padStart(total / 4, '0'),
    kind,
    exponent,
    exact,
  };
}

/**
 * 数の書き方。整数部と小数部の分け方が1通りに決まる形にする（\\d+\\.?\\d* だと「1111」の分け方が桁数だけあり、
 * 照合に失敗したときに分け方をすべて試し直すため、桁数の2乗の時間がかかる）
 */
const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|[-+]?(?:infinity|inf)|nan`;
/** 浮動小数点の欄の入力の上限（倍精度の値を書くには十分な長さ） */
export const MAX_FLOAT_INPUT = 1000;
const EXPRESSION = new RegExp(`^(${NUMBER})(?:\\s*([-+*/])\\s*(${NUMBER}))?$`, 'i');

function readNumber(s: string): number {
  const t = s.toLowerCase().replace(/^\+/, '');
  if (t === 'nan') return NaN;
  if (/^-?inf(inity)?$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  return Number(t);
}

/** 単精度・倍精度の値とビット列を変換する作業用の領域 */
const bitsView = new DataView(new ArrayBuffer(8));

/** 正の単精度の値の、すぐ上（step = 1）・すぐ下（step = -1）の単精度の値 */
function adjacentFloat32(x: number, step: 1 | -1): number {
  bitsView.setFloat32(0, x);
  bitsView.setUint32(0, bitsView.getUint32(0) + step);
  return bitsView.getFloat32(0);
}

/** 正の有限の倍精度の値を、M × 2^P（M・P は整数）の形で正確に表す */
function exactBinary(x: number): { m: bigint; p: number } {
  bitsView.setFloat64(0, x);
  const bits = bitsView.getBigUint64(0);
  const e = Number(bits >> 52n);
  const m = bits & ((1n << 52n) - 1n);
  return e === 0 ? { m, p: -1074 } : { m: m | (1n << 52n), p: e - 1075 };
}

/** 10進数の文字列（符号なし）と、正の倍精度の値 x を正確に比べる。文字列の方が大きければ 1 */
function compareDecimal(digits: string, x: number): -1 | 0 | 1 {
  const [mantissa = '', exp = '0'] = digits.split(/e/i);
  const [int, frac = ''] = mantissa.split('.');
  const d = BigInt(int + frac || '0');
  const e = Number(exp) - frac.length;
  const { m, p } = exactBinary(x);
  /** d × 10^e と m × 2^p を、両辺に分母を掛けて整数どうしで比べる */
  const left = d * (e > 0 ? 10n ** BigInt(e) : 1n) * (p < 0 ? 2n ** BigInt(-p) : 1n);
  const right = m * (p > 0 ? 2n ** BigInt(p) : 1n) * (e < 0 ? 10n ** BigInt(-e) : 1n);
  return left > right ? 1 : left < right ? -1 : 0;
}

/**
 * 10進数の文字列を、単精度に正しく丸める（最も近い値。ちょうど中間なら偶数の側）。
 * 倍精度に丸めてから Math.fround で丸めると、倍精度にした時点で単精度の2つの値のちょうど中間になった場合に、
 * 元の値が中間より大きいか小さいかの情報が失われ、偶数の側に丸まってしまう（1.00000017881393432617187499 など）。
 * 倍精度は 2×24+2 ビット以上あるため、ずれるのはこの場合だけ。そのときだけ元の10進数と正確に比べる
 */
function readFloat32(s: string): number {
  const d = readNumber(s);
  const f = Math.fround(d);
  if (f === d || !Number.isFinite(d)) return f;
  const a = Math.abs(d);
  const rounded = Math.abs(f);
  const [lower, upper] = rounded > a ? [adjacentFloat32(rounded, -1), rounded] : [rounded, adjacentFloat32(rounded, 1)];
  /** 単精度の最大値の次は無限大になるが、中間の値は 2^128 との中間で考える */
  const mid = lower / 2 + (upper === Infinity ? 2 ** 127 : upper / 2);
  if (a !== mid) return f;
  const order = compareDecimal(s.replace(/^[-+]/, ''), a);
  if (order === 0) return f;
  const magnitude = order > 0 ? upper : lower;
  return d < 0 ? -magnitude : magnitude;
}

/** 数をこの精度で読む */
const readAs = (s: string, precision: Precision) => (precision === 32 ? readFloat32(s) : readNumber(s));

/**
 * 小数、または「0.1 + 0.2」のような2つの数の四則演算を、この精度で計算する
 * （式を実行する機能は使わず、2つの数と演算子だけを読む）。
 * 計算の途中も結果も、この精度に丸める（float なら float 同士の計算）。
 * 単精度の2つの値の四則演算は、倍精度で計算してから丸めても正しく丸めた結果と一致する
 */
export function evaluateFloat(input: string, precision: Precision): number {
  if (input.length > MAX_FLOAT_INPUT) throw new Error(`入力は${formatNumber(MAX_FLOAT_INPUT)}文字までです`);
  const m = EXPRESSION.exec(input.trim());
  if (!m) throw new Error('「0.1」や「0.1 + 0.2」のように、数か、2つの数の四則演算を入力してください');
  /** 左の数は正規表現で必ず一致し、右の数は演算子があるときだけ一致する（既定値は型のためだけ） */
  const [, left = '', op, right = ''] = m;
  const a = readAs(left, precision);
  if (op === undefined) return a;
  const b = readAs(right, precision);
  const r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
  return roundTo(r, precision);
}
