import { expect, it } from 'vitest';
import { parseBusinessOffset, parseMonthOrdinal } from './numericInput';

it('数値の表記を丸めず、整数・安全な範囲・用途の境界を確認する', () => {
  for (const text of ['9007199254740993', '9'.repeat(400), '1e1', '1.0', '0x10', 'NaN']) {
    expect(() => parseMonthOrdinal(text), text).toThrow();
    expect(() => parseBusinessOffset(text), text).toThrow();
  }
  expect(parseMonthOrdinal('')).toBeNull();
  expect(parseMonthOrdinal('00031')).toBe(31);
  for (const text of ['0', '32', '-1']) expect(() => parseMonthOrdinal(text)).toThrow();
  expect(parseBusinessOffset('-3000')).toBe(-3000);
  expect(parseBusinessOffset('+3000')).toBe(3000);
  for (const text of ['', '-3001', '3001']) expect(() => parseBusinessOffset(text)).toThrow();
});
