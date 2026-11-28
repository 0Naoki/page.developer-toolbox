import { expect, it } from 'vitest';
import { parseBusinessOffset, parseMonthOrdinal, yearChoices } from './numericInput';

it('年の選択肢は今年の前後10年で、範囲があれば今年もその範囲に収める', () => {
  const plain = yearChoices(2026);
  expect(plain.current).toBe(2026);
  expect([plain.years[0], plain.years.at(-1), plain.years.length]).toEqual([2016, 2036, 21]);
  expect([plain.isYear(2016), plain.isYear(2037), plain.isYear('2026')]).toEqual([true, false, false]);
  const bounded = yearChoices(2095, { min: 1980, max: 2099 });
  expect([bounded.current, bounded.years[0], bounded.years.at(-1)]).toEqual([2095, 2085, 2099]);
  const after = yearChoices(2150, { min: 1980, max: 2099 });
  expect([after.current, after.years[0], after.years.at(-1)]).toEqual([2099, 2089, 2099]);
});

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
