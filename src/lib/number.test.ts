import { describe, expect, it } from 'vitest';
import { formatNumber } from './number';

describe('formatNumber', () => {
  it('3桁ごとにカンマで区切る', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(8_000_000)).toBe('8,000,000');
    expect(formatNumber(-1234)).toBe('-1,234');
  });

  it('安全な整数を超える bigint も、桁を丸めずに書く', () => {
    expect(formatNumber(2n ** 64n)).toBe('18,446,744,073,709,551,616');
  });

  /** 実行環境の既定のロケールに左右されないこと（ロケールを省いた toLocaleString() はブラウザの言語設定に従う） */
  it('書式は実行環境の言語設定に依らず ja-JP', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString('ja-JP'));
    expect((1234567).toLocaleString('de-DE')).not.toBe(formatNumber(1234567));
  });
});
