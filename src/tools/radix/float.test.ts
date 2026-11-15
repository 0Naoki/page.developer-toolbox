import { describe, expect, it } from 'vitest';
import { evaluateFloat, floatParts, MAX_FLOAT_INPUT } from './float';

describe('floatParts', () => {
  it('double の 0.1 は、最も近い2進数の値に丸めて格納される', () => {
    const p = floatParts(0.1, 64);
    expect(p.kind).toBe('正規化数');
    expect(p.sign).toBe(0);
    expect(p.hex).toBe('3FB999999999999A');
    expect(p.exponent).toBe(-4);
    expect(p.exponentBits).toBe('01111111011');
    expect(p.mantissaBits).toBe('1001100110011001100110011001100110011001100110011010');
    expect(p.exact).toBe('0.1000000000000000055511151231257827021181583404541015625');
  });

  it('float の 0.1 は double より粗い', () => {
    const p = floatParts(0.1, 32);
    expect(p.hex).toBe('3DCCCCCD');
    expect(p.exact).toBe('0.100000001490116119384765625');
    expect(p.value).toBe(Math.fround(0.1));
  });

  it('整数・負の値・-0', () => {
    expect(floatParts(-2, 64).exact).toBe('-2');
    expect(floatParts(-2, 64).sign).toBe(1);
    expect(floatParts(2 ** 60, 64).exact).toBe('1152921504606846976');
    const negZero = floatParts(-0, 64);
    expect(negZero.kind).toBe('ゼロ');
    expect(negZero.exact).toBe('-0');
  });

  it('非正規化数・無限大・NaN', () => {
    const sub = floatParts(5e-324, 64);
    expect(sub.kind).toBe('非正規化数');
    expect(sub.exponent).toBe(-1022);
    expect(sub.hex).toBe('0000000000000001');
    expect(sub.exact?.startsWith('0.000000000000000000000000000000000000')).toBe(true);
    expect(floatParts(Infinity, 32)).toMatchObject({ kind: '無限大', exact: null, hex: '7F800000' });
    expect(floatParts(NaN, 64)).toMatchObject({ kind: 'NaN', exact: null });
  });
});

describe('evaluateFloat', () => {
  it('0.1 + 0.2 は 0.3 にならない', () => {
    expect(evaluateFloat('0.1 + 0.2', 64)).toBe(0.30000000000000004);
    expect(evaluateFloat('0.1+0.2', 64)).not.toBe(0.3);
  });

  it('float では float 同士で計算して丸める', () => {
    expect(evaluateFloat('0.1 + 0.2', 32)).toBe(Math.fround(Math.fround(0.1) + Math.fround(0.2)));
  });

  it('数・指数表記・無限大・NaN を読む', () => {
    expect(evaluateFloat('1e-3', 64)).toBe(0.001);
    expect(evaluateFloat('-Infinity', 64)).toBe(-Infinity);
    expect(evaluateFloat('inf', 64)).toBe(Infinity);
    expect(Number.isNaN(evaluateFloat('NaN', 64))).toBe(true);
    expect(evaluateFloat('1 / 0', 64)).toBe(Infinity);
    expect(evaluateFloat('3 * -2', 64)).toBe(-6);
  });

  it('float では、倍精度に丸めてから丸め直さず、元の10進数を単精度に正しく丸める', () => {
    const hex = (s: string) => floatParts(evaluateFloat(s, 32), 32).hex;
    /** 3F800001 と 3F800002 のちょうど中間は 1.000000178813934326171875 */
    expect(hex('1.00000017881393432617187499')).toBe('3F800001');
    expect(hex('1.00000017881393432617187501')).toBe('3F800002');
    expect(hex('1.000000178813934326171875')).toBe('3F800002'); /** ちょうど中間は偶数の側 */
    expect(hex('-1.00000017881393432617187499')).toBe('BF800001');
    expect(hex('+0.00000000100000017881393432617187499e9')).toBe('3F800001');
    /** 単精度の最大値と 2^128 の中間（2^128 - 2^103）。それより小さければ最大値、ちょうど中間なら無限大 */
    expect(hex('340282356779733661637539395458142568447')).toBe('7F7FFFFF');
    expect(hex('340282356779733661637539395458142568448')).toBe('7F800000');
    /** 0 と最小の非正規化数（2^-149）の中間（2^-150）より少しだけ大きい値は、0 ではなく最小の非正規化数 */
    const half = `0.${(5n ** 150n).toString().padStart(150, '0')}`;
    expect(hex(`${half}1`)).toBe('00000001');
    expect(hex(half)).toBe('00000000');
    /** 倍精度では、これまでどおり Number() と同じ値 */
    expect(evaluateFloat('1.00000017881393432617187499', 64)).toBe(Number('1.00000017881393432617187499'));
  });

  it('数と四則演算以外は受け付けない', () => {
    for (const s of ['', 'abc', '1 + 2 + 3', 'Math.PI', '0x10', '1 % 2']) {
      expect(() => evaluateFloat(s, 64), s).toThrow('四則演算');
    }
  });
});

describe('evaluateFloat：長い不正な入力', () => {
  it('上限を超える入力は読まずにエラーにする', () => {
    expect(() => evaluateFloat('1'.repeat(MAX_FLOAT_INPUT + 1), 64)).toThrow(`入力は${MAX_FLOAT_INPUT.toLocaleString()}文字までです`);
  });

  it('上限までの不正な入力も、すぐにエラーにする（以前は桁数の2乗の時間がかかった）', () => {
    const started = performance.now();
    for (const s of ['1'.repeat(MAX_FLOAT_INPUT - 1) + 'x', `${'1'.repeat(MAX_FLOAT_INPUT - 6)} + 1x`, `${'1'.repeat(500)}.${'1'.repeat(498)}x`]) {
      expect(() => evaluateFloat(s, 64)).toThrow('四則演算');
    }
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('整数・小数点で終わる数・小数点で始まる数は、これまでどおり読む', () => {
    expect(evaluateFloat('12', 64)).toBe(12);
    expect(evaluateFloat('1.', 64)).toBe(1);
    expect(evaluateFloat('.5 + 1.25e1', 64)).toBe(13);
  });
});
