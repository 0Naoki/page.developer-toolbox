import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, daysInMonth, formatYmd, isValidYmd, msUntilNextJstDay, parseYmd, readYmd, todayJst, toDayNumber } from './date';

describe('date', () => {
  it('Date の範囲外の暦日でも、曜日と日付の加減算を求める', () => {
    const lower = { y: -271821, m: 4, d: 20 };
    const upper = { y: 275760, m: 9, d: 13 };
    expect(dayOfWeek(addDays(lower, -1))).toBe(1);
    expect(dayOfWeek(addDays(upper, 1))).toBe(0);
    expect(toDayNumber(addDays(lower, -1))).toBe(-100000001);
    expect(addDays({ y: 0, m: 2, d: 28 }, 1)).toEqual({ y: 0, m: 2, d: 29 });
    expect(todayJst(-9 * 3600000 - 1)).toEqual({ y: 1969, m: 12, d: 31 });
  });
  it('日付を解釈する', () => {
    expect(parseYmd('2026/10/26')).toEqual({ y: 2026, m: 10, d: 26 });
    expect(parseYmd('20261026')).toEqual({ y: 2026, m: 10, d: 26 });
    expect(parseYmd('２０２６年１０月２６日')).toEqual({ y: 2026, m: 10, d: 26 });
  });

  it('存在しない日付はエラー', () => {
    expect(() => parseYmd('2026-02-29')).toThrow();
    expect(isValidYmd({ y: 2024, m: 2, d: 29 })).toBe(true);
  });

  it('readYmd は例外を投げず、形式の違いと存在しない日付を区別する', () => {
    expect(readYmd('2026-10-26')).toEqual({ y: 2026, m: 10, d: 26 });
    expect(readYmd('2026-02-29')).toBe('invalid');
    expect(readYmd('abc')).toBe('format');
    expect(readYmd('')).toBe('format');
    /** parseYmd は同じ判定に文言を付けて投げる */
    expect(() => parseYmd('abc')).toThrow('の形式で入力してください');
    expect(() => parseYmd('2026-02-29')).toThrow('存在しない日付です');
  });

  it('日付の加算と曜日', () => {
    expect(formatYmd(addDays({ y: 2026, m: 12, d: 31 }, 1))).toBe('2027-01-01');
    expect(dayOfWeek({ y: 2026, m: 10, d: 26 })).toBe(1);
    expect(toDayNumber({ y: 1970, m: 1, d: 2 })).toBe(1);
  });

  it('月の日数（うるう年）。0〜99年も、1900年代と取り違えない', () => {
    expect([daysInMonth(2024, 2), daysInMonth(2023, 2), daysInMonth(2000, 2), daysInMonth(1900, 2)]).toEqual([29, 28, 29, 28]);
    /** Date.UTC は0年を1900年として扱うため、それに頼ると0年（うるう年）の2月が28日になる */
    expect(daysInMonth(0, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('JSTの今日', () => {
    expect(todayJst(Date.parse('2026-10-25T15:30:00Z'))).toEqual({ y: 2026, m: 10, d: 26 });
  });

  /** useTodayJst が、日付の変わり目に今日の日付を更新するタイマーの長さ */
  it('JSTで次に日付が変わるまでの時間。変わり目の直前・ちょうど・直後と、1970年より前', () => {
    const day = 86_400_000;
    /** JST の 2026-10-26 0:00 は UTC の 2026-10-25 15:00 */
    const midnight = Date.parse('2026-10-25T15:00:00Z');
    expect(msUntilNextJstDay(midnight - 1)).toBe(1);
    expect(msUntilNextJstDay(midnight)).toBe(day);
    expect(msUntilNextJstDay(midnight + 1)).toBe(day - 1);
    expect(msUntilNextJstDay(midnight + 30 * 60_000)).toBe(day - 30 * 60_000);
    /** タイマーが切れた時刻の todayJst は、次の日になっている */
    expect(todayJst(midnight - 1 + msUntilNextJstDay(midnight - 1))).toEqual({ y: 2026, m: 10, d: 26 });
    /** 負の時刻でも、剰余が負にならず境目を返す（JST の 1970-01-01 0:00 は -9時間） */
    const epochMidnightJst = -9 * 3_600_000;
    expect(msUntilNextJstDay(epochMidnightJst - 1)).toBe(1);
    expect(msUntilNextJstDay(epochMidnightJst)).toBe(day);
    expect(msUntilNextJstDay(-day * 365 + epochMidnightJst + 5)).toBe(day - 5);
  });
});
