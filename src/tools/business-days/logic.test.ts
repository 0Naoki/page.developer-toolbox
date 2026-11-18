/**
 * 検査の対象：logic.ts・holidays.ts（専用のテストファイルを置かないファイルも、ここでまとめて検査する）
 *
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 独自休日の診断：読めない項目を件数と1件の長さで制限し、行番号・総件数・元の長さを返すこと。CRLF・LF・CR とその混在を行の区切りにし、行番号を元の行に合わせること
 */
import { describe, expect, it } from 'vitest';
import { formatYmd } from '../../lib/time/date';
import { LINE_BREAK_CASES, withValues } from '../../lib/text/lines.fixtures';
import { holidaysOfYear } from './holidays';
import {
  DEFAULT_CALENDAR,
  addBusinessDays,
  countBusinessDays,
  summarizeBusinessRange,
  dayInfo,
  lastBusinessDayOfMonth,
  nthBusinessDayOfMonth,
  parseExtraHolidays,
  MAX_INVALID_PREVIEW,
  MAX_INVALID_SHOWN,
  yearSummary,
} from './logic';

const dates = (y: number) => holidaysOfYear(y).map((h) => formatYmd(h.date).slice(5));

describe('期間の営業日と休日の内訳', () => {
  it('逆順の期間も両端を含み、休日の理由の優先順位を保つ', () => {
    const cal = { ...DEFAULT_CALENDAR, yearEnd: true, extra: ['2026-01-01'] };
    const from = { y: 2026, m: 1, d: 1 };
    const to = { y: 2026, m: 1, d: 5 };
    const expected = {
      business: 1, calendar: 5,
      offDays: [
        { date: from, reason: '独自休日' },
        { date: { y: 2026, m: 1, d: 2 }, reason: '年末年始' },
        { date: { y: 2026, m: 1, d: 3 }, reason: '年末年始' },
      ],
    };
    expect(summarizeBusinessRange(from, to, cal)).toEqual(expected);
    expect(summarizeBusinessRange(to, from, cal)).toEqual(expected);
    expect(countBusinessDays(from, to, cal)).toEqual({ business: 1, calendar: 5 });
  });

  it('祝日を内訳に残し、週末だけの休みは載せない', () => {
    expect(summarizeBusinessRange({ y: 2026, m: 1, d: 10 }, { y: 2026, m: 1, d: 12 }, DEFAULT_CALENDAR)).toEqual({
      business: 0, calendar: 3,
      offDays: [{ date: { y: 2026, m: 1, d: 12 }, reason: '成人の日' }],
    });
  });

  it('集計でも期間と祝日の計算範囲を制限する', () => {
    expect(() => summarizeBusinessRange({ y: 2026, m: 1, d: 1 }, { y: 2057, m: 1, d: 1 }, DEFAULT_CALENDAR)).toThrow('30年');
    expect(() => summarizeBusinessRange({ y: 2100, m: 1, d: 1 }, { y: 2100, m: 1, d: 1 }, DEFAULT_CALENDAR)).toThrow('1980〜2099');
  });
});

describe('holidaysOfYear', () => {
  it('2026年：内閣府の公表どおり', () => {
    expect(dates(2026)).toEqual([
      '01-01', '01-12', '02-11', '02-23', '03-20', '04-29', '05-03', '05-04', '05-05', '05-06',
      '07-20', '08-11', '09-21', '09-22', '09-23', '10-12', '11-03', '11-23',
    ]);
  });

  it('2027年：内閣府の公表どおり（春分の日の振替休日あり）', () => {
    expect(dates(2027)).toEqual([
      '01-01', '01-11', '02-11', '02-23', '03-21', '03-22', '04-29', '05-03', '05-04', '05-05',
      '07-19', '08-11', '09-20', '09-23', '10-11', '11-03', '11-23',
    ]);
  });

  it('2019年：改元に伴う10連休と即位礼正殿の儀', () => {
    expect(dates(2019)).toEqual([
      '01-01', '01-14', '02-11', '03-21', '04-29', '04-30', '05-01', '05-02', '05-03', '05-04', '05-05', '05-06',
      '07-15', '08-11', '08-12', '09-16', '09-23', '10-14', '10-22', '11-03', '11-04', '11-23',
    ]);
  });

  it('2020・2021年：東京オリンピックによる移動', () => {
    expect(dates(2020)).toEqual([
      '01-01', '01-13', '02-11', '02-23', '02-24', '03-20', '04-29', '05-03', '05-04', '05-05', '05-06',
      '07-23', '07-24', '08-10', '09-21', '09-22', '11-03', '11-23',
    ]);
    expect(dates(2021)).toEqual([
      '01-01', '01-11', '02-11', '02-23', '03-20', '04-29', '05-03', '05-04', '05-05',
      '07-22', '07-23', '08-08', '08-09', '09-20', '09-23', '11-03', '11-23',
    ]);
  });

  it('国民の休日は1986年以降だけ', () => {
    /** 1985年12月施行。それ以前の5月4日は平日（日曜・振替休日の年を除く） */
    expect(dates(1982).includes('05-04')).toBe(false);
    expect(dates(1984).includes('05-04')).toBe(false);
    expect(dates(1988).includes('05-04')).toBe(true);
    expect(holidaysOfYear(1988).find((h) => h.date.m === 5 && h.date.d === 4)?.name).toBe('休日（国民の休日）');
  });

  it('名称', () => {
    const h2026 = holidaysOfYear(2026);
    expect(h2026.find((h) => h.date.m === 5 && h.date.d === 6)?.name).toBe('休日（振替休日）');
    expect(h2026.find((h) => h.date.m === 9 && h.date.d === 22)?.name).toBe('休日（国民の休日）');
  });

  it('対応範囲外はエラー', () => {
    expect(() => holidaysOfYear(1979)).toThrow();
  });
});

describe('独自休日の入力', () => {
  it('改行・カンマ区切りの日付を「2026-10-26」の形にそろえ、読めない行は知らせる', () => {
    expect(parseExtraHolidays('2026/10/26\r\n 20261027 ,2026年10月28日\n\n明日\n2026-02-30')).toEqual({
      dates: ['2026-10-26', '2026-10-27', '2026-10-28'],
      invalid: [{ line: 4, text: '明日', length: 2 }, { line: 5, text: '2026-02-30', length: 10 }],
      invalidCount: 2,
    });
    expect(parseExtraHolidays('')).toEqual({ dates: [], invalid: [], invalidCount: 0 });
  });

  it('CR だけの改行と、CRLF・LF・CR の混在も行の区切りにし、行番号を元の行に合わせる', () => {
    expect(parseExtraHolidays('2026-01-01\r2026-01-02')).toEqual({ dates: ['2026-01-01', '2026-01-02'], invalid: [], invalidCount: 0 });
    expect(parseExtraHolidays('2026-01-01\r\n2026-01-02\r明日\n2026-01-03\r\r2026-02-30')).toEqual({
      dates: ['2026-01-01', '2026-01-02', '2026-01-03'],
      invalid: [{ line: 3, text: '明日', length: 2 }, { line: 6, text: '2026-02-30', length: 10 }],
      invalidCount: 2,
    });
  });

  it('読めない項目の診断は、件数と1件の長さを制限し、総件数と元の長さを返す', () => {
    const long = parseExtraHolidays('x'.repeat(1_000_000));
    expect(long.invalid).toEqual([{ line: 1, text: 'x'.repeat(MAX_INVALID_PREVIEW), length: 1_000_000 }]);
    const exact = parseExtraHolidays('y'.repeat(MAX_INVALID_PREVIEW));
    expect(exact.invalid[0]).toEqual({ line: 1, text: 'y'.repeat(MAX_INVALID_PREVIEW), length: MAX_INVALID_PREVIEW });
    /** サロゲートペアの途中で切らない */
    const emoji = parseExtraHolidays('a'.repeat(MAX_INVALID_PREVIEW - 1) + '😀');
    expect(emoji.invalid[0]?.text).toBe('a'.repeat(MAX_INVALID_PREVIEW - 1));
    /** 入力のたびに画面の側で読むため、読めない項目が多くても止まらない（項目ごとに例外を作ると約1秒かかっていた） */
    const manyText = Array.from({ length: 100_000 }, (_, i) => `bad${i}`).join('\n');
    const started = performance.now();
    const many = parseExtraHolidays(manyText);
    expect(performance.now() - started).toBeLessThan(500);
    expect(many.invalidCount).toBe(100_000);
    expect(many.invalid).toHaveLength(MAX_INVALID_SHOWN);
    expect(many.invalid.at(-1)).toEqual({ line: MAX_INVALID_SHOWN, text: `bad${MAX_INVALID_SHOWN - 1}`, length: `bad${MAX_INVALID_SHOWN - 1}`.length });
  });
});

describe('営業日計算', () => {
  it('独自休日が大量にあっても、日数と件数の積に比例する時間にならない', () => {
    const cal = { ...DEFAULT_CALENDAR, holidays: false, extra: [...Array(100_000).fill('2099-12-31'), '2000-01-04'] };
    const start = performance.now();
    const r = countBusinessDays({ y: 1980, m: 1, d: 1 }, { y: 2009, m: 12, d: 31 }, cal);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(r.calendar).toBe(10958);
    expect(dayInfo({ y: 2000, m: 1, d: 4 }, cal)).toEqual({ business: false, reason: '独自休日' });
    expect(dayInfo({ y: 2000, m: 1, d: 5 }, cal).business).toBe(true);
  });

  const cal = DEFAULT_CALENDAR;

  it('休みの理由を返す', () => {
    expect(dayInfo({ y: 2026, m: 9, d: 22 }, cal)).toEqual({ business: false, reason: '休日（国民の休日）' });
    expect(dayInfo({ y: 2026, m: 10, d: 24 }, cal)).toEqual({ business: false, reason: '週末' });
    expect(dayInfo({ y: 2026, m: 10, d: 26 }, cal)).toEqual({ business: true, reason: null });
  });

  it('期間内の営業日数（両端を含む）', () => {
    /** 2026年9月：30日 - 土日8日 - 祝休日3日（21,22,23） */
    expect(countBusinessDays({ y: 2026, m: 9, d: 1 }, { y: 2026, m: 9, d: 30 }, cal)).toEqual({ business: 19, calendar: 30 });
    /** 順序が逆でも同じ */
    expect(countBusinessDays({ y: 2026, m: 9, d: 30 }, { y: 2026, m: 9, d: 1 }, cal).business).toBe(19);
  });

  it('n営業日後・前', () => {
    /** 2026/9/18(金) の 1営業日後は シルバーウィーク明けの 9/24(木) */
    expect(addBusinessDays({ y: 2026, m: 9, d: 18 }, 1, cal)).toEqual({ y: 2026, m: 9, d: 24 });
    expect(addBusinessDays({ y: 2026, m: 9, d: 24 }, -1, cal)).toEqual({ y: 2026, m: 9, d: 18 });
    /** 0 は「休みなら翌営業日」 */
    expect(addBusinessDays({ y: 2026, m: 5, d: 2 }, 0, cal)).toEqual({ y: 2026, m: 5, d: 7 });
  });

  it('前後移動は4桁の年の両端を含み、範囲外へ進むと止まる', () => {
    const everyDay = { ...cal, weekend: [], holidays: false, yearEnd: false, extra: [] };
    const first = { y: 0, m: 1, d: 1 };
    const last = { y: 9999, m: 12, d: 31 };
    expect(addBusinessDays({ ...first, d: 2 }, -1, everyDay)).toEqual(first);
    expect(addBusinessDays({ ...last, d: 30 }, 1, everyDay)).toEqual(last);
    for (const date of [first, last]) expect(addBusinessDays(date, 0, everyDay)).toEqual(date);
    const message = '営業日の前後移動は0000〜9999年の範囲で計算してください';
    expect(() => addBusinessDays(first, -1, everyDay)).toThrow(message);
    expect(() => addBusinessDays(last, 1, everyDay)).toThrow(message);
    expect(() => addBusinessDays(last, 0, { ...everyDay, extra: ['9999-12-31'] })).toThrow(message);
    expect(() => addBusinessDays({ ...last, d: 30 }, 1, { ...everyDay, extra: ['9999-12-31'] })).toThrow(message);
    for (const y of [-1, 10000]) expect(() => addBusinessDays({ y, m: 1, d: 1 }, 0, everyDay)).toThrow(message);
  });

  it('すべての曜日が休みなら、0営業日後でも止まってエラーにする', () => {
    const allOff = { ...cal, weekend: [0, 1, 2, 3, 4, 5, 6], holidays: false };
    for (const n of [0, 1, -1]) {
      expect(() => addBusinessDays({ y: 2026, m: 10, d: 30 }, n, allOff), String(n)).toThrow('営業日が見つかりません');
    }
  });

  it('週に1日しか営業日がなくても、範囲内の日数を計算する', () => {
    const saturdayOnly = { ...cal, weekend: [0, 1, 2, 3, 4, 5], holidays: false };
    const after = addBusinessDays({ y: 2026, m: 1, d: 1 }, 3000, saturdayOnly);
    expect(after.y).toBe(2083);
    expect(dayInfo(after, saturdayOnly).business).toBe(true);
  });

  it('年末年始と独自休日', () => {
    const custom = { ...cal, yearEnd: true, extra: ['2026-12-28'] };
    /** 12/25(金) の翌営業日は 1/4(月) */
    expect(addBusinessDays({ y: 2026, m: 12, d: 25 }, 1, custom)).toEqual({ y: 2027, m: 1, d: 4 });
  });

  it('第n営業日と最終営業日', () => {
    /** 2026年5月：1日(金)が第1営業日、GW明けの7日(木)が第2営業日 */
    expect(nthBusinessDayOfMonth(2026, 5, 2, cal)).toEqual({ y: 2026, m: 5, d: 7 });
    expect(lastBusinessDayOfMonth(2026, 1, cal)).toEqual({ y: 2026, m: 1, d: 30 });
    expect(nthBusinessDayOfMonth(2026, 2, 30, cal)).toBe(null);
  });

  it('年間サマリー', () => {
    const total = yearSummary(2026, cal).reduce((s, m) => s + m.business, 0);
    /** 365日 - 土日104日 - 平日にあたる祝休日 */
    expect(total).toBe(365 - 104 - holidaysOfYear(2026).filter((h) => ![0, 6].includes(new Date(Date.UTC(2026, h.date.m - 1, h.date.d)).getUTCDay())).length);
  });
});

describe('独自休日の改行の形式', () => {
  it.each(LINE_BREAK_CASES)('$name を行の区切りにし、読めない日付の行番号を元の行に合わせる', ({ text, lines }) => {
    const badLine = lines.indexOf('b') + 1;
    const result = parseExtraHolidays(withValues(text, { a: '2026-01-01', b: '明日', c: '2026-01-03', d: '2026-01-04' }));
    expect(result.invalid.map((item) => item.line)).toEqual(badLine > 0 ? [badLine] : []);
    expect(result.dates).toHaveLength(lines.filter((l) => l !== '' && l !== 'b').length);
  });
});
