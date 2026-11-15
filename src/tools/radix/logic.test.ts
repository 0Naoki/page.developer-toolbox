/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 整数演算とIEEE754の分離：整数の桁・符号・シフトと、浮動小数点の丸め・非正規化数・特殊値を別のテストで検査する（あわせて `src/tools/radix/float.test.ts`）
 */
import { describe, expect, it } from 'vitest';
import {
  bitOp,
  bytesOf,
  formatInteger,
  MAX_DIGITS,
  parseInteger,
  plainInteger,
  toggleBit,
  toSigned,
  toUnsigned,
} from './logic';

describe('parseInteger', () => {
  it('入力欄の進数で読む', () => {
    expect(parseInteger('255', 10)).toEqual({ value: 255n, base: 10 });
    expect(parseInteger('ff', 16)).toEqual({ value: 255n, base: 16 });
    expect(parseInteger('377', 8)).toEqual({ value: 255n, base: 8 });
    expect(parseInteger('1111 1111', 2)).toEqual({ value: 255n, base: 2 });
  });

  it('0x・0b・0o の接頭辞があれば、その進数として読む', () => {
    expect(parseInteger('0xFF', 10)).toEqual({ value: 255n, base: 16 });
    expect(parseInteger('0b1010', 8)).toEqual({ value: 10n, base: 2 });
    expect(parseInteger('0O17', 10)).toEqual({ value: 15n, base: 8 });
    expect(parseInteger('-0x80', 10)).toEqual({ value: -128n, base: 16 });
  });

  it('16進数の欄では、先頭の 0B を2進数の接頭辞ではなく16進数の数字として読む', () => {
    /** 16ビットの 0xB12 は、16進数の欄に「0B12」と表示される。これを読み直してもエラーにしない */
    expect(formatInteger(0xb12n, 16, 16)).toBe('0B12');
    expect(parseInteger('0B12', 16)).toEqual({ value: 0xb12n, base: 16 });
    expect(parseInteger('0B1', 16)).toEqual({ value: 0xb1n, base: 16 });
    expect(parseInteger('0b', 16)).toEqual({ value: 0xbn, base: 16 });
    expect(parseInteger('0x0B12', 16)).toEqual({ value: 0xb12n, base: 16 });
    /** ほかの欄では、0b を2進数の接頭辞として読む */
    expect(parseInteger('0b101', 10)).toEqual({ value: 5n, base: 2 });
  });

  it('区切りの空白・_、10進数のカンマを無視する', () => {
    expect(parseInteger('1,000,000', 10).value).toBe(1000000n);
    expect(parseInteger('DEAD_BEEF', 16).value).toBe(0xdeadbeefn);
    expect(parseInteger('DE AD BE EF', 16).value).toBe(0xdeadbeefn);
  });

  it('64ビットを超える値も丸めずに読む', () => {
    expect(parseInteger('123456789012345678901234567890', 10).value).toBe(123456789012345678901234567890n);
  });

  it('使えない文字・空・桁数の多すぎる入力はエラー', () => {
    expect(() => parseInteger('12a', 10)).toThrow('10進数に使えない文字「a」があります');
    expect(() => parseInteger('102', 2)).toThrow('2進数に使えない文字「2」があります');
    expect(() => parseInteger('0x', 10)).toThrow('数値を入力してください');
    expect(() => parseInteger('  ', 10)).toThrow('数値を入力してください');
    expect(() => parseInteger('1.5', 10)).toThrow('「.」');
    expect(() => parseInteger('1'.repeat(MAX_DIGITS + 1), 10)).toThrow('桁数が多すぎます');
  });
});

describe('2の補数', () => {
  it('負の値を幅のビット列にし、符号付きに戻す', () => {
    expect(toUnsigned(-1n, 8)).toBe(255n);
    expect(toUnsigned(-128n, 8)).toBe(128n);
    expect(toSigned(255n, 8)).toBe(-1n);
    expect(toSigned(127n, 8)).toBe(127n);
    expect(toSigned(0x8000000000000000n, 64)).toBe(-9223372036854775808n);
  });

  it('幅に収まらない値はエラー（符号付きの最小値 〜 符号なしの最大値まで）', () => {
    expect(toUnsigned(255n, 8)).toBe(255n);
    expect(() => toUnsigned(256n, 8)).toThrow('8ビットに収まりません（-128 〜 255）');
    expect(() => toUnsigned(-129n, 8)).toThrow('8ビットに収まりません');
  });

  it('幅が 0（制限なし）のときはそのまま', () => {
    expect(toUnsigned(-5n, 0)).toBe(-5n);
  });
});

describe('formatInteger', () => {
  it('幅に合わせて0で埋め、区切る', () => {
    expect(formatInteger(5n, 2, 8)).toBe('0000 0101');
    expect(formatInteger(255n, 16, 32)).toBe('0000 00FF');
    expect(formatInteger(1234567n, 10, 32)).toBe('1,234,567');
    expect(formatInteger(8n, 8, 8)).toBe('10');
  });

  it('幅が 0 のときは埋めず、負の値に - を付ける', () => {
    expect(formatInteger(-255n, 16, 0)).toBe('-FF');
    expect(formatInteger(5n, 2, 0)).toBe('101');
  });

  it('入力欄に戻す文字列は、読み直すと同じ値になる', () => {
    for (const base of [2, 8, 10, 16] as const) {
      expect(parseInteger(plainInteger(-123456789n, base), base).value).toBe(-123456789n);
    }
  });
});

describe('bytesOf', () => {
  it('ビッグエンディアンのバイト列', () => {
    expect(bytesOf(0x12345678n, 32)).toEqual(['12', '34', '56', '78']);
    expect(bytesOf(1n, 16)).toEqual(['00', '01']);
  });
});

describe('toggleBit', () => {
  it('指定したビットを反転する', () => {
    expect(toggleBit(0n, 7)).toBe(128n);
    expect(toggleBit(255n, 0)).toBe(254n);
    expect(toggleBit(0n, 63)).toBe(0x8000000000000000n);
  });
});

describe('bitOp', () => {
  it('AND・OR・XOR', () => {
    expect(bitOp('and', 0b1100n, 0b1010n, 8)).toBe(0b1000n);
    expect(bitOp('or', 0b1100n, 0b1010n, 8)).toBe(0b1110n);
    expect(bitOp('xor', 0b1100n, 0b1010n, 8)).toBe(0b0110n);
  });

  it('負の値は2の補数のビット列として計算する', () => {
    expect(bitOp('and', -1n, 0x0fn, 8)).toBe(0x0fn);
  });

  it('NOT は幅の中で反転する。幅が 0 なら -x - 1', () => {
    expect(bitOp('not', 0n, 0n, 8)).toBe(255n);
    expect(bitOp('not', 0x0fn, 0n, 16)).toBe(0xfff0n);
    expect(bitOp('not', 5n, 0n, 0)).toBe(-6n);
  });

  it('<< は幅からあふれたビットを捨てる', () => {
    expect(bitOp('shl', 0b1100_0001n, 1n, 8)).toBe(0b1000_0010n);
    expect(bitOp('shl', 1n, 8n, 8)).toBe(0n);
    expect(bitOp('shl', 1n, 100n, 0)).toBe(1n << 100n);
  });

  it('>> は符号を保ち、>>> は上位を0で埋める', () => {
    expect(bitOp('shr', 0b1000_0000n, 1n, 8)).toBe(0b1100_0000n); /** -128 \>\> 1 = -64 */
    expect(bitOp('ushr', 0b1000_0000n, 1n, 8)).toBe(0b0100_0000n);
    expect(bitOp('shr', -8n, 1n, 0)).toBe(-4n);
    expect(bitOp('ushr', -1n, 28n, 32)).toBe(0xfn);
  });

  it('シフト量の範囲外と、幅なしの >>> はエラー', () => {
    expect(() => bitOp('shl', 1n, -1n, 8)).toThrow('シフト量は 0 〜');
    expect(() => bitOp('shl', 1n, 5000n, 0)).toThrow('シフト量は 0 〜');
    expect(() => bitOp('ushr', 1n, 1n, 0)).toThrow('>>> はビット幅を指定したときだけ使えます');
  });

  it('幅に収まらない値はエラー', () => {
    expect(() => bitOp('and', 300n, 1n, 8)).toThrow('8ビットに収まりません');
  });
});
