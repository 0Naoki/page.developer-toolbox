import { describe, expect, it } from 'vitest';
import { ageOn, erasOfYear, eto, parseDateAny, parseWareki, toWareki } from './logic';

describe('toWareki', () => {
  it('改元日の前後', () => {
    expect(toWareki({ y: 2019, m: 4, d: 30 }).text).toBe('平成31年4月30日');
    expect(toWareki({ y: 2019, m: 5, d: 1 }).text).toBe('令和元年5月1日');
    expect(toWareki({ y: 1989, m: 1, d: 7 }).text).toBe('昭和64年1月7日');
    expect(toWareki({ y: 1989, m: 1, d: 8 }).text).toBe('平成元年1月8日');
    expect(toWareki({ y: 1926, m: 12, d: 25 }).text).toBe('昭和元年12月25日');
    expect(toWareki({ y: 1912, m: 7, d: 30 }).text).toBe('大正元年7月30日');
  });

  it('略記とゼロ埋め', () => {
    const w = toWareki({ y: 2026, m: 10, d: 26 });
    expect(w.short).toBe('R8.10.26');
    expect(w.padded).toBe('令和08年10月26日');
  });

  it('改暦前はエラー', () => {
    expect(() => toWareki({ y: 1872, m: 12, d: 31 })).toThrow();
    expect(toWareki({ y: 1873, m: 1, d: 1 }).text).toBe('明治6年1月1日');
  });
});

describe('parseWareki', () => {
  it.each([2117, 2118, 9999])('西暦%d年を和暦から読み戻す', (y) => {
    const date = { y, m: 1, d: 1 };
    expect(parseWareki(toWareki(date).text).date).toEqual(date);
  });

  it('さまざまな書き方を解釈する', () => {
    expect(parseWareki('令和8年10月26日').date).toEqual({ y: 2026, m: 10, d: 26 });
    expect(parseWareki('令和元年5月1日').date).toEqual({ y: 2019, m: 5, d: 1 });
    expect(parseWareki('R8.10.26').date).toEqual({ y: 2026, m: 10, d: 26 });
    expect(parseWareki('h1/1/8').date).toEqual({ y: 1989, m: 1, d: 8 });
    expect(parseWareki('Ｓ６４．１．７').date).toEqual({ y: 1989, m: 1, d: 7 });
    expect(parseWareki('㍻31年4月30日').date).toEqual({ y: 2019, m: 4, d: 30 });
    expect(parseWareki('令 8 年 1 月 5 日').date).toEqual({ y: 2026, m: 1, d: 5 });
  });

  it('元号の範囲外は西暦に変換しつつ注意を出す', () => {
    const r = parseWareki('平成31年5月1日');
    expect(r.date).toEqual({ y: 2019, m: 5, d: 1 });
    expect(r.warning).toBe('平成31年5月1日は、正しくは令和元年5月1日です');
    expect(parseWareki('令和8年1月1日').warning).toBe(undefined);
  });

  it('不正な入力はエラー', () => {
    expect(() => parseWareki('令和8年2月30日')).toThrow();
    expect(() => parseWareki('2026年10月26日')).toThrow();
  });
});

describe('erasOfYear / eto / ageOn', () => {
  it('改元の年は2つ', () => {
    expect(erasOfYear(2019)).toEqual(['平成31年', '令和元年']);
    expect(erasOfYear(1989)).toEqual(['昭和64年', '平成元年']);
    expect(erasOfYear(2026)).toEqual(['令和8年']);
  });

  it('干支', () => {
    expect(eto(2026)).toEqual({ kanshi: '丙午', animal: 'うま' });
    expect(eto(1984).kanshi).toBe('甲子');
  });

  it('満年齢', () => {
    const birth = { y: 1993, m: 10, d: 27 };
    expect(ageOn(birth, { y: 2026, m: 10, d: 26 })).toBe(32);
    expect(ageOn(birth, { y: 2026, m: 10, d: 27 })).toBe(33);
  });
});

describe('parseDateAny', () => {
  it('西暦・和暦どちらも読める', () => {
    expect(parseDateAny('1993-04-01').date).toEqual({ y: 1993, m: 4, d: 1 });
    expect(parseDateAny('H5.4.1').date).toEqual({ y: 1993, m: 4, d: 1 });
  });

  it('存在しない西暦の日付には西暦のエラーを返す（和暦の形式エラーにしない）', () => {
    let message = '';
    try {
      parseDateAny('1993-02-30');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('存在しない日付です');
  });
});
